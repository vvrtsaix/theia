import { Schema } from "effect"

/**
 * Effect Schema → modular-forms `validate` adapter.
 *
 * Lets the SPA reuse the SAME Schemas the backend uses for RPC payload
 * validation — no parallel valibot/zod schemas to keep in sync.
 *
 * Usage:
 *   const LoginSchema = Schema.Struct({
 *     email:    Schema.NonEmptyString,
 *     password: Schema.NonEmptyString.check(Schema.isMinLength(8)),
 *   })
 *
 *   const [form, { Form, Field }] = createForm<typeof LoginSchema.Type>({
 *     validate: effectSchema(LoginSchema),
 *   })
 *
 * Returns top-level field errors only — fine for flat form objects.
 * Nested-path support can be added by extending `walkIssue` when the first
 * nested form arrives.
 */
export const effectSchema =
  <S extends Schema.Top>(schema: S) =>
  (values: unknown): Record<string, string> => {
    try {
      Schema.decodeUnknownSync(schema as never)(values)
      return {}
    } catch (e) {
      const errors: Record<string, string> = {}
      // `decodeUnknownSync` throws an Error whose `.cause` is the SchemaError;
      // walk it to project per-field issues.
      walkIssue((e as { cause?: unknown }).cause ?? e, errors)
      return errors
    }
  }

const walkIssue = (issue: unknown, out: Record<string, string>): void => {
  if (issue == null || typeof issue !== "object") return
  const i = issue as {
    path?: ReadonlyArray<PropertyKey>
    issues?: ReadonlyArray<unknown>
    issue?: unknown
    message?: string
  }
  if (Array.isArray(i.issues)) {
    for (const child of i.issues) walkIssue(child, out)
    return
  }
  if (i.issue) {
    walkIssue(i.issue, out)
    return
  }
  if (i.path && i.path.length > 0) {
    const key = String(i.path[0])
    if (!(key in out)) out[key] = i.message ?? `invalid ${key}`
  }
}
