import { createForm } from "@modular-forms/solid"
import { A, useNavigate } from "@solidjs/router"
import { Entities } from "@theia/domain"
import { Schema } from "effect"
import { ArrowLeft } from "lucide-solid"
import { type Component, For, Show, createSignal } from "solid-js"
import { effectSchema } from "#lib/effect-form"
import { getClients, run } from "#lib/rpc"

/**
 * Compose a new ticket.
 *
 * Renders as a long-form page, not a modal — the act of opening a ticket is
 * editorial work, not a quick prompt. Validation uses the same Effect Schema
 * style as the rest of the app via the `effectSchema` modular-forms adapter.
 *
 * On success, the RPC returns the created `Ticket`; we then navigate to that
 * ticket's detail page rather than back to the ledger so the user sees their
 * own letter rendered in the editorial layout.
 */

const NewTicketSchema = Schema.Struct({
  title: Schema.NonEmptyString.check(Schema.isMinLength(3)),
  description: Schema.String,
  priority: Entities.TicketPriority,
  typeKey: Schema.NullOr(Entities.TicketType),
  tagsRaw: Schema.String,
})

interface NewTicketInput {
  title: string
  description: string
  priority: string
  typeKey: string | null
  tagsRaw: string
}

const PRIORITIES = ["low", "normal", "high", "urgent"] as const
const TYPES = ["question", "bug", "feature_request", "incident"] as const

const NewTicket: Component = () => {
  const nav = useNavigate()
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [form, { Form, Field }] = createForm<NewTicketInput>({
    initialValues: {
      title: "",
      description: "",
      priority: "normal",
      typeKey: "bug",
      tagsRaw: "",
    },
    validate: effectSchema(NewTicketSchema),
    validateOn: "blur",
    revalidateOn: "input",
  })

  const handleSubmit = async (values: NewTicketInput): Promise<void> => {
    setServerError(null)
    const tags = values.tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    try {
      const c = await getClients()
      // Branded `TicketPriority`/`TicketType`/`TicketTag` are validated server-
      // side against the tenant workflow. Casting here keeps the boundary
      // narrow without re-implementing Schema decoding for free-form select.
      const ticket = await run(
        c.ticket["ticket.open"]({
          title: values.title,
          description: values.description,
          priority: values.priority as Entities.TicketPriority,
          typeKey: values.typeKey as Entities.TicketType | null,
          tags: tags as Array<Entities.TicketTag>,
        }),
      )
      nav(`/tickets/${ticket.id}`)
    } catch (e) {
      const tag = (e as { _tag?: string })?._tag
      const message = (e as { message?: string })?.message ?? String(e)
      setServerError(tag ? `${tag}: ${message}` : message)
    }
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
        <p class="micro-caps">Compose · 001</p>
        <h1 class="font-serif text-[3.5rem] italic leading-[0.98] tracking-tight text-ink">
          New entry
        </h1>
        <p class="max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
          Write a brief letter for the future. Keep the title sharp; the description can wander if
          it needs to.
        </p>
      </header>

      <Form onSubmit={handleSubmit} class="mt-12 space-y-12">
        <Field name="title">
          {(
            field: { value: string | undefined; error: string },
            props: Record<string, unknown>,
          ) => (
            <label class="block space-y-2" data-reveal style={{ "--i": "2" }}>
              <span class="micro-caps">Title</span>
              <input
                {...props}
                type="text"
                value={field.value ?? ""}
                aria-invalid={field.error ? true : undefined}
                placeholder="Customer cannot resend invitation"
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

        <Field name="description">
          {(
            field: { value: string | undefined; error: string },
            props: Record<string, unknown>,
          ) => (
            <label class="block space-y-2" data-reveal style={{ "--i": "3" }}>
              <span class="micro-caps">Description</span>
              <textarea
                {...props}
                value={field.value ?? ""}
                rows={6}
                aria-invalid={field.error ? true : undefined}
                placeholder="What happened. What you expected. What you tried."
                class="field resize-y leading-relaxed text-ink"
              />
              <Show when={field.error}>
                <span class="block font-mono text-[11px] uppercase tracking-[0.08em] text-ember">
                  ↳ {field.error}
                </span>
              </Show>
            </label>
          )}
        </Field>

        <Field name="priority">
          {(
            field: { value: string | undefined; error: string },
            props: Record<string, unknown>,
          ) => (
            <fieldset class="space-y-3" data-reveal style={{ "--i": "4" }}>
              <legend class="micro-caps">Priority</legend>
              <div class="flex flex-wrap gap-2">
                <For each={PRIORITIES}>
                  {(p) => (
                    <label class="cursor-pointer">
                      <input
                        {...props}
                        type="radio"
                        value={p}
                        checked={field.value === p}
                        class="peer sr-only"
                      />
                      <span
                        class="pill cursor-pointer transition-colors peer-checked:border-ink peer-checked:text-ink peer-checked:[box-shadow:inset_0_-1px_0_0_var(--color-ember)]"
                        data-tone={p}
                      >
                        {p}
                      </span>
                    </label>
                  )}
                </For>
              </div>
            </fieldset>
          )}
        </Field>

        <Field name="typeKey">
          {(
            field: { value: string | undefined; error: string },
            props: Record<string, unknown>,
          ) => (
            <fieldset class="space-y-3" data-reveal style={{ "--i": "5" }}>
              <legend class="micro-caps">Type</legend>
              <div class="flex flex-wrap gap-2">
                <For each={TYPES}>
                  {(t) => (
                    <label class="cursor-pointer">
                      <input
                        {...props}
                        type="radio"
                        value={t}
                        checked={field.value === t}
                        class="peer sr-only"
                      />
                      <span class="pill cursor-pointer transition-colors peer-checked:border-ink peer-checked:text-ink peer-checked:[box-shadow:inset_0_-1px_0_0_var(--color-ember)]">
                        {t.replace(/_/g, " ")}
                      </span>
                    </label>
                  )}
                </For>
              </div>
            </fieldset>
          )}
        </Field>

        <Field name="tagsRaw">
          {(
            field: { value: string | undefined; error: string },
            props: Record<string, unknown>,
          ) => (
            <label class="block space-y-2" data-reveal style={{ "--i": "6" }}>
              <span class="micro-caps">Tags (comma-separated, optional)</span>
              <input
                {...props}
                type="text"
                value={field.value ?? ""}
                placeholder="billing, regression"
                class="field font-mono text-[13px]"
              />
            </label>
          )}
        </Field>

        <div class="space-y-4" data-reveal style={{ "--i": "7" }}>
          <Show when={serverError()}>
            <p class="border-l-2 border-ember bg-ember-soft/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ember">
              {serverError()}
            </p>
          </Show>

          <div class="flex items-center gap-4 pt-2">
            <button type="submit" disabled={form.submitting} class="btn-ink">
              <span>{form.submitting ? "Opening" : "Open ticket"}</span>
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

export default NewTicket
