import { A, useParams } from "@solidjs/router"
import { TicketId } from "@theia/domain"
import { DateTime, Schema } from "effect"
import { ArrowLeft } from "lucide-solid"
import { type Component, For, type JSX, Show, createResource } from "solid-js"
import { getClients, run } from "#lib/rpc"

/**
 * Ticket detail — editorial reading layout.
 *
 * The page is built around a ~65ch reading column so the description sets
 * like body copy. The title is large serif italic; metadata runs in
 * mono micro-caps with hairline dot separators; the activity log lives in
 * the margin like footnotes.
 */
const TicketDetail: Component = () => {
  const params = useParams()
  const [ticket] = createResource(
    () => params.id,
    async (id) => {
      // Validate the URL segment matches the `TicketId` brand (UUID) before
      // hitting the server. Bypassing this turns a malformed URL into a
      // generic decode error from the RPC layer instead of a clean null.
      let ticketId: TicketId
      try {
        ticketId = Schema.decodeUnknownSync(TicketId)(id)
      } catch {
        return null
      }
      const c = await getClients()
      return run(c.ticket["ticket.get"]({ id: ticketId }))
    },
  )

  return (
    <div class="mx-auto max-w-5xl px-12 py-16">
      <BackLink />
      <Show
        when={ticket()}
        fallback={
          <p class="mt-24 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-ink-4">
            Loading entry…
          </p>
        }
      >
        {(t) => (
          <article class="mt-10 space-y-12">
            <Heading ticket={t()} />
            <Body ticket={t()} />
            <Marginalia ticket={t()} />
          </article>
        )}
      </Show>
    </div>
  )
}

const BackLink: Component = () => (
  <A
    href="/"
    class="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-3 transition-colors hover:text-ink"
    data-reveal
    style={{ "--i": "0" }}
  >
    <ArrowLeft size={12} strokeWidth={1.5} />
    Ledger
  </A>
)

const Heading: Component<{ ticket: TicketLike }> = (p) => (
  <header class="space-y-6 border-b border-rule pb-10" data-reveal style={{ "--i": "1" }}>
    <MetaRow>
      <span class="font-mono uppercase tracking-[0.14em] text-ink-2">
        № {String(p.ticket.id).slice(0, 8)}
      </span>
      <Dot />
      <span class="pill" data-tone={p.ticket.status}>
        {p.ticket.status}
      </span>
      <Dot />
      <span class="pill" data-tone={p.ticket.priority}>
        {p.ticket.priority}
      </span>
    </MetaRow>

    <h1 class="font-serif text-[3.75rem] italic leading-[0.98] tracking-[-0.01em] text-ink">
      {p.ticket.title}
    </h1>

    <MetaRow>
      <span>Opened {formatLong(p.ticket.createdAt)}</span>
      <Dot />
      <span>Updated {formatLong(p.ticket.updatedAt)}</span>
      <Show when={p.ticket.assigneeId}>
        <Dot />
        <span>
          Assignee <span class="text-ink-2">{String(p.ticket.assigneeId).slice(0, 8)}</span>
        </span>
      </Show>
    </MetaRow>
  </header>
)

const Body: Component<{ ticket: TicketLike }> = (p) => (
  <section
    class="grid grid-cols-[1fr_minmax(0,640px)_1fr] gap-12"
    data-reveal
    style={{ "--i": "2" }}
  >
    <aside class="hidden md:block">
      <p class="micro-caps">Letter</p>
    </aside>

    <div class="space-y-8">
      <Show
        when={p.ticket.description}
        fallback={
          <p class="font-serif text-[1.25rem] italic leading-relaxed text-ink-3">
            No description was provided. The author has chosen silence.
          </p>
        }
      >
        <p class="font-serif text-[1.4rem] italic leading-[1.45] text-ink first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-[4.5rem] first-letter:not-italic first-letter:leading-[0.85] first-letter:text-ember">
          {p.ticket.description}
        </p>
      </Show>

      <div class="flex gap-3 pt-2">
        <button type="button" class="btn-ink">
          Resolve
          <span aria-hidden="true">→</span>
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 border border-rule px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-2 transition-colors hover:border-ink hover:text-ink"
        >
          Assign
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 px-3 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3 transition-colors hover:text-ember"
        >
          Discard
        </button>
      </div>
    </div>

    <aside class="hidden md:block">
      <p class="micro-caps">Tags</p>
      <ul class="mt-2 space-y-1 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">
        <Show when={p.ticket.tags?.length} fallback={<li>— none —</li>}>
          <For each={p.ticket.tags as ReadonlyArray<string>}>{(t) => <li>· {t}</li>}</For>
        </Show>
      </ul>
    </aside>
  </section>
)

/**
 * Marginalia — keeps the raw payload available without ever screaming. Sits
 * inside a `<details>` so it's collapsed by default; the open state styles
 * the chevron with a serif italic flourish.
 */
const Marginalia: Component<{ ticket: TicketLike }> = (p) => (
  <details
    class="group border-t border-rule pt-8 [&_summary::-webkit-details-marker]:hidden"
    data-reveal
    style={{ "--i": "3" }}
  >
    <summary class="flex cursor-pointer items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3 transition-colors hover:text-ink">
      <span>Marginalia · raw record</span>
      <span class="font-serif text-[1.25rem] italic text-ink-3 transition-transform duration-300 group-open:rotate-45">
        +
      </span>
    </summary>
    <pre class="mt-6 overflow-x-auto rounded-[2px] border border-rule bg-paper-2/60 p-5 font-mono text-[11px] leading-relaxed text-ink-2">
      {JSON.stringify(p.ticket, null, 2)}
    </pre>
  </details>
)

const MetaRow: Component<{ children: JSX.Element }> = (p) => (
  <div class="flex flex-wrap items-center gap-y-1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
    {p.children}
  </div>
)

const Dot: Component = () => <span class="dot-sep" aria-hidden="true" />

const formatLong = (v: DateTime.Utc | Date | string | undefined): string => {
  if (!v) return "—"
  const d = typeof v === "string" ? new Date(v) : v instanceof Date ? v : DateTime.toDate(v)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

interface TicketLike {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly description?: string | null
  readonly createdAt?: DateTime.Utc | Date | string
  readonly updatedAt?: DateTime.Utc | Date | string
  readonly assigneeId?: string | null
  readonly tags?: ReadonlyArray<string>
}

export default TicketDetail
