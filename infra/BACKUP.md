# Postgres backup strategy

Theia stores **everything** in one Postgres database: tenants, users, sessions, tickets, the event log, and the workflow config seeded from `system_config`. Losing the DB = losing the product.

This document covers the minimum viable backup pattern for the single-node MVP. Multi-region replication + managed PITR is the upgrade path; the principles below carry over.

## What to back up

| Object | Critical? | Recoverable from elsewhere? |
| --- | --- | --- |
| All schemas (`public`) | ✅ yes | No. |
| `system_config` row(s) | ✅ yes | No — admin-mutated. |
| Roles + RLS policies (`infra/00-bootstrap.sql`) | ✅ yes | Yes (recreate via bootstrap), but back up anyway. |
| Migrations journal (`packages/db/drizzle/meta/`) | — | Yes (git). |

## Schedule

| Tier | Frequency | Retention | Tool |
| --- | --- | --- | --- |
| WAL archive (PITR) | continuous | 7 days | `pgbackrest` / managed |
| Full base backup | nightly 02:00 UTC | 14 days | `pg_dump` → S3 |
| Weekly snapshot | Sunday 04:00 UTC | 90 days | `pg_dump` → S3 (separate prefix) |
| Pre-migration | before every `db:migrate:prod` | 7 days | manual `pg_dump` |

WAL archiving is the only way to recover to a specific point in time (mid-day data loss). Nightly dumps cover "we lost the cluster, restore yesterday." Pre-migration dumps cover "the migration corrupted state."

## Nightly script (sample)

Drop in any host with the `pg_dump` binary + AWS CLI. Set as a cron job or k8s CronJob.

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET required}"
PREFIX="${BACKUP_PREFIX:-theia}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="/tmp/${PREFIX}-${STAMP}.sql.gz"

# `--format=custom` + gzip is more compact than plain SQL and supports
# parallel restore. `--no-owner --no-privileges` lets the dump apply to a
# fresh cluster with a different role layout.
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --compress=9 \
  --dbname="$DATABASE_URL" \
  --file="$FILE"

# Encrypt at rest using SSE-KMS; lifecycle on the bucket handles deletion.
aws s3 cp "$FILE" "s3://${BACKUP_BUCKET}/${PREFIX}/nightly/${STAMP}.dump" \
  --sse aws:kms

rm -f "$FILE"
echo "backup uploaded: s3://${BACKUP_BUCKET}/${PREFIX}/nightly/${STAMP}.dump"
```

## Restore drill (sample)

Run quarterly. A backup you've never restored isn't a backup.

```bash
# 1. Pull the most recent dump.
aws s3 cp "s3://${BACKUP_BUCKET}/theia/nightly/$(date -u +%Y%m%d)*.dump" /tmp/restore.dump

# 2. Provision a fresh Postgres instance + run bootstrap.
psql "$RESTORE_URL" -f infra/00-bootstrap.sql

# 3. Restore into it.
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$RESTORE_URL" /tmp/restore.dump

# 4. Smoke: row count parity + a known query.
psql "$RESTORE_URL" -c "SELECT count(*) FROM ticket;"
```

## Migration safety

Always snapshot **before** `pnpm db:migrate:prod`. `infra/docker-compose.prod.yaml` runs migrations as a one-shot container; gate it on a successful backup in your pipeline:

```yaml
# Pseudo-code for any orchestrator (GitHub Actions, Argo, etc.).
- step: backup-pre-migrate
  run: ./infra/scripts/backup.sh
- step: migrate
  run: pnpm db:migrate:prod
  needs: backup-pre-migrate
- step: smoke
  run: ./infra/scripts/smoke.sh
```

## Encryption + access

- **At rest:** S3 server-side encryption with KMS (separate key per environment).
- **In transit:** SSL-only Pg connections (`sslmode=require` in `DATABASE_URL`).
- **Access:** dedicated IAM principal for the backup job. Restore principal is separate, lives in break-glass storage, **never** issued to humans by default.

## What this does NOT cover

- Tenant-specific data export (GDPR right-to-portability). Build per-tenant dumps via filtered `pg_dump` once that lands.
- Cross-region failover. Use a managed offering (RDS multi-AZ, Cloud SQL HA) for SLA-grade durability.
- Application-level deletes (a backup is a snapshot, not an undo log). RLS does not prevent a malicious admin from running `DELETE FROM ticket`; PITR + audit trail covers that case.
