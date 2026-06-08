import { A } from "@solidjs/router"
import type { Stream } from "effect"
import { type Component, createResource, For, onMount, Show } from "solid-js"
import { getClients, run, subscribeStream } from "#lib/rpc"

/**
 * Notifications — minimal, read-only feed.
 *
 * Pulls from `notification.list` for the initial page; subscribes to
 * `notification.stream` to refetch on each new notice (server stays the
 * source of truth for ordering + read state, so we trigger a refetch
 * rather than client-side prepending).
 */
const Notifications: Component = () => {
  const [data, { refetch }] = createResource(async () => {
    const c = await getClients()
    return run(c.notification["notification.list"]({}))
  })

  onMount(() => {
    getClients()
      .then((c) => {
        const stream = c.notification["notification.stream"]() as unknown as Stream.Stream<
          unknown,
          unknown
        >
        subscribeStream(
          stream,
          (count: number) => {
            void refetch()
            return count + 1
          },
          0,
        )
      })
      .catch((err) => {
        console.warn("[notifications] failed to attach stream:", err)
      })
  })

  return (
    <div class="mx-auto max-w-4xl px-12 py-16">
      <Header unread={() => data()?.unreadCount ?? 0} loading={() => data.loading} />

      <Show
        when={!data.loading}
        fallback={
          <p class="mt-16 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-4">Loading…</p>
        }
      >
        <Show when={(data()?.items.length ?? 0) > 0} fallback={<EmptyState />}>
          <ul class="mt-10 border-t border-rule">
            <For each={data()?.items ?? []}>
              {(n, i) => (
                <li data-reveal style={{ "--i": String(i() + 1) }} class="border-b border-rule/60">
                  <NotificationRow item={n} />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  )
}

const Header: Component<{ unread: () => number; loading: () => boolean }> = (p) => (
  <header
    class="flex items-end justify-between border-b border-rule pb-6"
    data-reveal
    style={{ "--i": "0" }}
  >
    <div class="space-y-2">
      <p class="micro-caps">Volume I · Bulletins</p>
      <h1 class="font-serif text-[3rem] italic leading-[0.95] tracking-tight text-ink">
        Notifications
      </h1>
    </div>
    <dl class="text-right">
      <dt class="micro-caps">Unread</dt>
      <dd class="font-mono text-[1.5rem] tabular-nums leading-none text-ink">
        {p.loading() ? "—" : String(p.unread()).padStart(2, "0")}
      </dd>
    </dl>
  </header>
)

interface NotificationItem {
  readonly id: string
  readonly kind?: string
  readonly title?: string
  readonly body?: string | null
  readonly ticketId?: string | null
  readonly readAt?: unknown
  readonly createdAt: unknown
}

const NotificationRow: Component<{ item: NotificationItem }> = (p) => {
  const unread = () => p.item.readAt == null
  const href = p.item.ticketId ? `/tickets/${p.item.ticketId}` : "/notifications"
  return (
    <A
      href={href}
      class="ledger-row grid grid-cols-[12px_minmax(0,1fr)_140px] items-baseline gap-4 px-2 py-5"
    >
      <span
        role="status"
        aria-label={unread() ? "unread" : "read"}
        class="mt-2 size-1.5 rounded-full"
        classList={{
          "bg-ember": unread(),
          "bg-transparent border border-rule": !unread(),
        }}
      />
      <div class="space-y-1">
        <p class="font-serif text-[1.125rem] leading-snug text-ink">
          {p.item.title ?? p.item.kind ?? "—"}
        </p>
        <Show when={p.item.body}>
          <p class="line-clamp-2 text-[13px] leading-relaxed text-ink-2">{p.item.body}</p>
        </Show>
        <Show when={p.item.kind}>
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-4">{p.item.kind}</p>
        </Show>
      </div>
      <span class="text-right font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3 tabular-nums">
        {formatRelative(p.item.createdAt)}
      </span>
    </A>
  )
}

const EmptyState: Component = () => (
  <div class="mx-auto mt-24 max-w-[52ch] space-y-6 text-center" data-reveal style={{ "--i": "1" }}>
    <p class="micro-caps">— silence —</p>
    <p class="font-serif text-[2rem] italic leading-tight text-ink">
      Nothing to report. <span class="text-ember">All clear.</span>
    </p>
    <p class="text-[14px] leading-relaxed text-ink-2">
      Bulletins arrive here when a ticket changes status, when you are mentioned, or when an SLA is
      at risk.
    </p>
  </div>
)

/**
 * Best-effort relative formatter. `createdAt` shape varies between
 * `Effect.DateTime.Utc`, `Date`, and ISO `string` — normalize to ms then
 * bucket into "just now / minutes / hours / days / date".
 */
const formatRelative = (v: unknown): string => {
  const ms = toMs(v)
  if (ms == null) return "—"
  const delta = Date.now() - ms
  if (delta < 60_000) return "now"
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d`
  const d = new Date(ms)
  const month = d.toLocaleString("en-US", { month: "short" })
  return `${month} ${String(d.getDate()).padStart(2, "0")}`
}

const toMs = (v: unknown): number | null => {
  if (v == null) return null
  if (v instanceof Date) return v.getTime()
  if (typeof v === "string") {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  if (typeof v === "object" && "epochMilliseconds" in v) {
    return (v as { epochMilliseconds: number }).epochMilliseconds
  }
  return null
}

export default Notifications
