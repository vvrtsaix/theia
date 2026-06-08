import { createForm } from "@modular-forms/solid"
import { A, useNavigate } from "@solidjs/router"
import { Schema } from "effect"
import { ArrowLeft } from "lucide-solid"
import { type Component, Show, createSignal } from "solid-js"
import { authClient } from "#auth/client"
import { effectSchema } from "#lib/effect-form"

/**
 * Create a new tenant (better-auth Organization).
 *
 * On success the new org is set as the active organization for the current
 * session, so the next RPC call hits its (initially empty) ledger. Slug must
 * be globally unique because better-auth enforces it at the table level;
 * surface that error verbatim from the server.
 *
 * Renders both as a first-time onboarding page and from the switcher's
 * `+ New tenant` shortcut. The `redirect` query param controls the
 * post-create destination (`/` by default, `/onboarding` when the user
 * arrived from a no-org state).
 */

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

const NewTenantSchema = Schema.Struct({
  name: Schema.NonEmptyString.check(Schema.isMinLength(2)),
  slug: Schema.NonEmptyString.check(Schema.isPattern(slugPattern)),
})

interface NewTenantInput {
  name: string
  slug: string
}

const NewTenant: Component = () => {
  const nav = useNavigate()
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [form, { Form, Field }] = createForm<NewTenantInput>({
    initialValues: { name: "", slug: "" },
    validate: effectSchema(NewTenantSchema),
    validateOn: "blur",
    revalidateOn: "input",
  })

  const handleSubmit = async (values: NewTenantInput): Promise<void> => {
    setServerError(null)
    const created = await authClient.organization.create({
      name: values.name,
      slug: values.slug,
    })
    if (created.error) {
      setServerError(created.error.message ?? "create failed")
      return
    }
    const orgId = created.data?.id
    if (orgId) {
      const activate = await authClient.organization.setActive({ organizationId: orgId })
      if (activate.error) {
        setServerError(activate.error.message ?? "set-active failed")
        return
      }
    }
    nav("/", { replace: true })
  }

  return (
    <div class="mx-auto max-w-3xl px-12 py-16">
      <A
        href="/"
        class="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-3 transition-colors hover:text-ink"
        data-reveal
        style={{ "--i": "0" }}
      >
        <ArrowLeft size={12} strokeWidth={1.5} />
        Ledger
      </A>

      <header class="mt-10 space-y-3" data-reveal style={{ "--i": "1" }}>
        <p class="micro-caps">Compose · Tenant</p>
        <h1 class="font-serif text-[3rem] italic leading-[0.98] tracking-tight text-ink">
          Open a new ledger
        </h1>
        <p class="max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
          A tenant is a private workspace — its tickets, members, workflows, and roles never cross
          into another tenant.
        </p>
      </header>

      <Form onSubmit={handleSubmit} class="mt-12 space-y-12" aria-label="create tenant">
        <Field name="name">
          {(
            field: { value: string | undefined; error: string },
            props: Record<string, unknown>,
          ) => (
            <label class="block space-y-2" data-reveal style={{ "--i": "2" }}>
              <span class="micro-caps">Tenant name</span>
              <input
                {...props}
                type="text"
                autocomplete="organization"
                placeholder="AndSystems"
                value={field.value ?? ""}
                aria-invalid={field.error ? true : undefined}
                class="field font-serif text-[1.5rem] italic text-ink"
              />
              <Show when={field.error}>
                <span class="block font-mono text-[11px] uppercase tracking-[0.08em] text-ember">
                  ↳ {field.error}
                </span>
              </Show>
            </label>
          )}
        </Field>

        <Field name="slug">
          {(
            field: { value: string | undefined; error: string },
            props: Record<string, unknown>,
          ) => (
            <label class="block space-y-2" data-reveal style={{ "--i": "3" }}>
              <span class="micro-caps">URL slug</span>
              <input
                {...props}
                type="text"
                placeholder="andsystems"
                value={field.value ?? ""}
                aria-invalid={field.error ? true : undefined}
                class="field font-mono"
              />
              <p class="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">
                Lowercase letters, digits, and dashes. 2–32 characters. Unique globally.
              </p>
              <Show when={field.error}>
                <span class="block font-mono text-[11px] uppercase tracking-[0.08em] text-ember">
                  ↳ {field.error}
                </span>
              </Show>
            </label>
          )}
        </Field>

        <div class="space-y-4" data-reveal style={{ "--i": "4" }}>
          <Show when={serverError()}>
            <p class="border-l-2 border-ember bg-ember-soft/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ember">
              {serverError()}
            </p>
          </Show>

          <div class="flex items-center gap-4 pt-2">
            <button type="submit" disabled={form.submitting} class="btn-ink">
              <span>{form.submitting ? "Opening" : "Open tenant"}</span>
              <span aria-hidden="true">→</span>
            </button>
            <A
              href="/"
              class="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3 transition-colors hover:text-ink"
            >
              Cancel
            </A>
          </div>
        </div>
      </Form>
    </div>
  )
}

export default NewTenant
