import { A } from "@solidjs/router"
import type { Entities } from "@theia/domain"
import { DateTime } from "effect"
import { type Component, createMemo, createResource, For, Show } from "solid-js"
import { usePermission } from "#lib/permissions"
import { getClients, run } from "#lib/rpc"

type Row = Entities.TicketSummary

/**
 * Tickets list — rendered as a quiet ledger.
 *
 * Decisions worth noting:
 *   - No tanstack-table. The schema is small and stable; a manual table reads
 *     cleaner and lets us style each column with its own typographic intent
 *     (mono IDs, serif titles, micro-caps metadata).
 *   - Status / priority are hairline `.pill` elements with a coloured dot. The
 *     fill-badge would shout; the dot whispers.
 *   - Rows reveal in a 38ms stagger on first paint so the table reads like a
 *     page being typed out rather than dumped to the screen.
 */
const Tickets: Component = () => {
  const [data] = createResource(async () => {
    const c = await getClients()
    return run(c.ticket["ticket.list"]({}))
  })

  const rows = createMemo<ReadonlyArray<Row>>(() => data()?.items ?? [])
  const canCreate = usePermission("ticket", "create")

  return (
    <div class="mx-auto max-w-6xl px-12 py-16">
      <Header count={() => rows().length} loading={() => data.loading} canCreate={canCreate} />

      <Show
        when={!data.loading}
        fallback={
          <div class="mt-16 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-4">
            Loading ledger…
          </div>
        }
      >
        <Show when={rows().length > 0} fallback={<EmptyState />}>
          <Ledger rows={rows()} />
        </Show>
      </Show>
    </div>
  )
}

const Header: Component<{
  count: () => number
  loading: () => boolean
  canCreate: () => boolean
}> = (p) => (
  <header
    class="flex items-end justify-between border-b border-rule pb-6"
    data-reveal
    style={{ "--i": "0" }}
  >
    <div class="space-y-2">
      <p class="micro-caps">Volume I · Open queue</p>
      <h1 class="font-serif text-[3rem] italic leading-[0.95] tracking-tight text-ink">Tickets</h1>
    </div>
    <div class="flex items-end gap-10">
      <dl class="flex items-end gap-8 text-right">
        <div>
          <dt class="micro-caps">Count</dt>
          <dd class="font-mono text-[1.5rem] tabular-nums leading-none text-ink">
            {p.loading() ? "—" : String(p.count()).padStart(2, "0")}
          </dd>
        </div>
        <div>
          <dt class="micro-caps">Updated</dt>
          <dd class="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
            {new Date().toISOString().slice(0, 10)}
          </dd>
        </div>
      </dl>
      <Show when={p.canCreate()}>
        <A href="/tickets/new" class="btn-ink">
          <span>New entry</span>
          <span aria-hidden="true">＋</span>
        </A>
      </Show>
    </div>
  </header>
)

/**
 * The ledger itself. Built as a CSS grid so column widths align across the
 * header rule and every row without relying on a `<table>` layout (cleaner
 * borders, easier hover states).
 */
const Ledger: Component<{ rows: ReadonlyArray<Row> }> = (p) => (
  <div class="mt-10">
    <div
      class="grid grid-cols-[64px_minmax(0,1fr)_120px_120px_120px_140px] items-end border-b border-rule pb-3"
      data-reveal
      style={{ "--i": "1" }}
    >
      <ColumnLabel>№</ColumnLabel>
      <ColumnLabel>Title</ColumnLabel>
      <ColumnLabel>Status</ColumnLabel>
      <ColumnLabel>Priority</ColumnLabel>
      <ColumnLabel>Assignee</ColumnLabel>
      <ColumnLabel class="text-right">Updated</ColumnLabel>
    </div>

    <ul>
      <For each={p.rows}>
        {(row, i) => (
          <li
            data-reveal
            style={{ "--i": String(i() + 2) }}
            class="border-b border-rule/60 last:border-b-0"
          >
            <A
              href={`/tickets/${row.id}`}
              class="ledger-row grid grid-cols-[64px_minmax(0,1fr)_120px_120px_120px_140px] items-baseline px-2 py-4 transition-colors"
            >
              <span class="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-4 tabular-nums">
                {String(i() + 1).padStart(3, "0")}
              </span>
              <span class="font-serif text-[1.125rem] leading-snug text-ink">{row.title}</span>
              <span>
                <span class="pill" data-tone={row.status}>
                  {row.status}
                </span>
              </span>
              <span>
                <span class="pill" data-tone={row.priority}>
                  {row.priority}
                </span>
              </span>
              <span class="truncate font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                {row.assigneeId ? row.assigneeId.slice(0, 8) : "—"}
              </span>
              <span class="text-right font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3 tabular-nums">
                {formatStamp(row.updatedAt)}
              </span>
            </A>
          </li>
        )}
      </For>
    </ul>
  </div>
)

const ColumnLabel: Component<{ children: unknown; class?: string }> = (p) => (
  <span class={`micro-caps ${p.class ?? ""}`}>{p.children as never}</span>
)

const EmptyState: Component = () => (
  <div class="mx-auto mt-24 max-w-[52ch] space-y-6 text-center" data-reveal style={{ "--i": "1" }}>
    <p class="micro-caps">— no entries —</p>
    <p class="font-serif text-[2rem] italic leading-tight text-ink">
      The ledger is empty. <span class="text-ember">A good silence.</span>
    </p>
    <p class="text-[14px] leading-relaxed text-ink-2">
      Tickets will appear here as they arrive. Until then, this page is deliberately quiet — paper
      waiting for a pen.
    </p>
  </div>
)

/**
 * Render an `Effect.DateTime.Utc` (or Date / ISO string) as `Mar 14 · 09:42`.
 * Keeps tabular numerals so the right column aligns vertically.
 */
const formatStamp = (v: DateTime.Utc | Date | string | null | undefined): string => {
  if (v == null) return "—"
  const d = typeof v === "string" ? new Date(v) : v instanceof Date ? v : DateTime.toDate(v)
  if (Number.isNaN(d.getTime())) return "—"
  const month = d.toLocaleString("en-US", { month: "short" })
  const day = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${month} ${day} · ${hh}:${mm}`
}

export default Tickets
