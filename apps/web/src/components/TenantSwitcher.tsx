import { A, useNavigate } from "@solidjs/router"
import { Check, ChevronsUpDown, LogOut, Plus } from "lucide-solid"
import {
  type Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js"
import { authClient } from "#auth/client"
import { useSession } from "#auth/session"

/**
 * Switch between tenants the current user belongs to.
 *
 * Reads org memberships via `authClient.organization.list`, picks the active
 * one from `session.session.activeOrganizationId`. On select, calls
 * `setActive` and reloads — full reload (vs targeted refetch) is intentional
 * for v0: it guarantees every cached RPC / SolidJS resource picks up the new
 * tenant context without a custom invalidation pass.
 *
 * Also exposes `+ New tenant` and `Leave current tenant` actions in the
 * dropdown menu so the affordance lives next to the active-tenant selector.
 */
export const TenantSwitcher: Component = () => {
  const nav = useNavigate()
  const session = useSession()
  const [orgs, { refetch }] = createResource(() => authClient.organization.list())
  const [open, setOpen] = createSignal(false)
  const [leaving, setLeaving] = createSignal(false)

  const list = createMemo(() => orgs()?.data ?? [])
  const activeId = createMemo(() => session()?.data?.session?.activeOrganizationId)
  const active = createMemo(() => list().find((o) => o.id === activeId()) ?? list()[0])

  // Close the menu on outside-click + Escape.
  let rootEl: HTMLDivElement | undefined
  const handleDocClick = (e: MouseEvent): void => {
    if (!rootEl || rootEl.contains(e.target as Node)) return
    setOpen(false)
  }
  const handleEsc = (e: KeyboardEvent): void => {
    if (e.key === "Escape") setOpen(false)
  }
  createEffect(() => {
    if (!open()) return
    document.addEventListener("mousedown", handleDocClick)
    document.addEventListener("keydown", handleEsc)
    onCleanup(() => {
      document.removeEventListener("mousedown", handleDocClick)
      document.removeEventListener("keydown", handleEsc)
    })
  })

  const handleSwitch = async (orgId: string): Promise<void> => {
    if (orgId === activeId()) {
      setOpen(false)
      return
    }
    await authClient.organization.setActive({ organizationId: orgId })
    window.location.reload()
  }

  const handleLeave = async (): Promise<void> => {
    const id = activeId()
    if (!id) return
    const ok = window.confirm("Leave this tenant? You will lose access until reinvited.")
    if (!ok) return
    setLeaving(true)
    try {
      await authClient.organization.leave({ organizationId: id })
      const after = await refetch()
      const next = after?.data?.[0]
      if (next) {
        await authClient.organization.setActive({ organizationId: next.id })
        window.location.reload()
      } else {
        nav("/onboarding", { replace: true })
      }
    } finally {
      setLeaving(false)
    }
  }

  return (
    <div ref={rootEl} class="relative">
      <p class="micro-caps mb-2">Tenant</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="group flex w-full items-center justify-between gap-2 border border-rule px-3 py-2 text-left transition-colors hover:border-ink"
        aria-expanded={open()}
      >
        <div class="flex min-w-0 flex-col leading-tight">
          <span class="truncate font-serif text-[1rem] italic text-ink">
            {active()?.name ?? "No tenant"}
          </span>
          <span class="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            {active()?.slug ?? "—"}
          </span>
        </div>
        <ChevronsUpDown size={13} strokeWidth={1.5} class="text-ink-3 group-hover:text-ink" />
      </button>

      <Show when={open()}>
        <div class="absolute left-0 right-0 z-20 mt-1 border border-rule bg-paper shadow-lifted">
          <ul class="max-h-64 overflow-y-auto">
            <For each={list()}>
              {(org) => {
                const isActive = createMemo(() => org.id === activeId())
                return (
                  <li>
                    <button
                      type="button"
                      onClick={() => handleSwitch(org.id)}
                      class="flex w-full items-center justify-between gap-3 border-b border-rule/60 px-3 py-2 text-left text-[13px] transition-colors hover:bg-rule-soft"
                    >
                      <div class="flex min-w-0 flex-col leading-tight">
                        <span class="truncate font-serif italic text-ink">{org.name}</span>
                        <span class="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
                          {org.slug}
                        </span>
                      </div>
                      <Show when={isActive()}>
                        <Check size={13} strokeWidth={1.5} class="text-ember" />
                      </Show>
                    </button>
                  </li>
                )
              }}
            </For>
          </ul>

          <div class="border-t border-rule">
            <A
              href="/tenants/new"
              onClick={() => setOpen(false)}
              class="flex items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-2 transition-colors hover:bg-rule-soft hover:text-ink"
            >
              <Plus size={12} strokeWidth={1.5} />
              New tenant
            </A>
            <Show when={active()}>
              <button
                type="button"
                onClick={handleLeave}
                disabled={leaving()}
                class="flex w-full items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3 transition-colors hover:bg-rule-soft hover:text-ember disabled:opacity-50"
              >
                <LogOut size={12} strokeWidth={1.5} />
                {leaving() ? "Leaving…" : "Leave tenant"}
              </button>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
