import { Schema } from "effect"

/**
 * Auth-layer errors. Higher than `Unauthorized` from `@theia/domain` — those
 * are for missing permissions; these are for missing/invalid sessions before
 * we get that far.
 */

export class SessionInvalid extends Schema.TaggedErrorClass<SessionInvalid>()("SessionInvalid", {
  reason: Schema.String,
}) {}

export class NoActiveOrganization extends Schema.TaggedErrorClass<NoActiveOrganization>()(
  "NoActiveOrganization",
  {
    userId: Schema.String,
  },
) {}
