import { Schema } from "effect"
import { TenantId } from "#ids"

export class Tenant extends Schema.Class<Tenant>("Tenant")({
  id: TenantId,
  slug: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
}) {}
