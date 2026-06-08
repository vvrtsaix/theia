import { Entities } from "@theia/domain"
import { Trash2 } from "lucide-solid"
import { type Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { authClient } from "#auth/client"
import { useSession } from "#auth/session"
import { usePermission } from "#lib/permissions"

/**
 * Roles + permissions admin for the active tenant.
 *
 * Two panels:
 *
 *   1. Built-in roles (owner / admin / agent / customer) — read-only. Their
 *      statements live in `packages/auth/src/access-control.ts` and ship with
 *      the code base; they cannot be deleted or edited at runtime.
 *
 *   2. Custom roles — stored in `organization_role` via better-auth's
 *      `dynamicAccessControl`. Tenant admins create them by picking a name
 *      and ticking resource × action checkboxes. The domain
 *      `PermissionStatement` (in `@theia/domain/entities/Permission.ts`) is
 *      the source of truth for which keys are addressable.
 */

const STATEMENT = Entities.PermissionStatement
const RESOURCES = Object.keys(STATEMENT) as ReadonlyArray<keyof typeof STATEMENT>

const BUILTIN: ReadonlyArray<{
  name: string
  blurb: string
}> = [
  { name: "owner", blurb: "Full control over the tenant + every domain resource." },
  { name: "admin", blurb: "Everything except deleting the tenant." },
  { name: "agent", blurb: "Triages and handles tickets; cannot configure." },
  { name: "customer", blurb: "Opens and comments on their own tickets only." },
]

interface CustomRole {
  readonly id?: string
  readonly role: string
  readonly permission?: Record<string, ReadonlyArray<string>>
}

const SettingsRoles: Component = () => {
  const session = useSession()
  const activeOrg = createMemo(() => session()?.data?.session?.activeOrganizationId ?? null)
  const canCreate = usePermission("role", "create")
  const canDelete = usePermission("role", "delete")

  const [roles, rolesCtl] = createResource(activeOrg, async (orgId) => {
    if (!orgId) return null
    const res = await authClient.organization.listRoles({ query: { organizationId: orgId } })
    return res
  })

  return (
    <div class="mx-auto max-w-4xl px-12 py-16">
      <header class="space-y-3 border-b border-rule pb-6" data-reveal style={{ "--i": "0" }}>
        <p class="micro-caps">Volume I · Roles</p>
        <h1 class="font-serif text-[3rem] italic leading-[0.95] tracking-tight text-ink">
          Who can do what
        </h1>
        <p class="max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
          Built-in roles are baked into the binary. Custom roles live in this tenant only — admins
          author them by ticking a permission grid.
        </p>
      </header>

      <section class="mt-14 space-y-4" data-reveal style={{ "--i": "1" }}>
        <h2 class="micro-caps">Built-in roles</h2>
        <ul class="border-t border-rule">
          <For each={BUILTIN}>
            {(r) => (
              <li class="grid grid-cols-[140px_minmax(0,1fr)_80px] items-baseline gap-4 border-b border-rule/60 px-2 py-4">
                <span class="font-serif text-[1.25rem] italic text-ink">{r.name}</span>
                <span class="text-[13px] leading-relaxed text-ink-2">{r.blurb}</span>
                <span class="justify-self-end font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
                  built-in
                </span>
              </li>
            )}
          </For>
        </ul>
      </section>

      <Show when={canCreate()}>
        <CreateRolePanel
          onCreated={() => {
            rolesCtl.refetch()
          }}
        />
      </Show>

      <section class="mt-14 space-y-4" data-reveal style={{ "--i": "3" }}>
        <h2 class="micro-caps">Custom roles</h2>
        <Show
          when={!roles.loading}
          fallback={
            <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-4">Loading…</p>
          }
        >
          {(() => {
            const list = (roles()?.data ?? []) as ReadonlyArray<CustomRole>
            return (
              <Show
                when={list.length > 0}
                fallback={
                  <p class="font-serif text-[1.25rem] italic text-ink-3">
                    None yet — create one above.
                  </p>
                }
              >
                <ul class="border-t border-rule">
                  <For each={list}>
                    {(r) => (
                      <CustomRoleRow
                        role={r}
                        canDelete={canDelete()}
                        onDeleted={() => rolesCtl.refetch()}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            )
          })()}
        </Show>
      </section>
    </div>
  )
}

const CustomRoleRow: Component<{
  role: CustomRole
  canDelete: boolean
  onDeleted: () => void
}> = (p) => {
  const [busy, setBusy] = createSignal(false)
  const handleDelete = async (): Promise<void> => {
    const ok = window.confirm(`Delete role "${p.role.role}"?`)
    if (!ok) return
    setBusy(true)
    try {
      await authClient.organization.deleteRole({ roleName: p.role.role as never })
      p.onDeleted()
    } finally {
      setBusy(false)
    }
  }

  const summary = createMemo(() => {
    const perm = p.role.permission ?? {}
    return Object.entries(perm)
      .map(([res, actions]) => `${res}:${(actions as ReadonlyArray<string>).join("/")}`)
      .join(" · ")
  })

  return (
    <li class="grid grid-cols-[180px_minmax(0,1fr)_56px] items-baseline gap-4 border-b border-rule/60 px-2 py-4">
      <span class="font-serif text-[1.25rem] italic text-ink">{p.role.role}</span>
      <span class="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
        {summary() || "no permissions"}
      </span>
      <Show when={p.canDelete} fallback={<span class="font-mono text-[10px] text-ink-4">—</span>}>
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy()}
          aria-label="Delete role"
          class="justify-self-end p-1.5 text-ink-3 transition-colors hover:text-ember disabled:opacity-50"
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </Show>
    </li>
  )
}

const CreateRolePanel: Component<{ onCreated: () => void }> = (p) => {
  const [name, setName] = createSignal("")
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [ok, setOk] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  // Reactive permission grid; one Set per resource for O(1) toggle.
  const [grid, setGrid] = createSignal<Record<string, ReadonlySet<string>>>({})

  const toggle = (resource: string, action: string): void => {
    setGrid((prev) => {
      const next = { ...prev }
      const curr = new Set(next[resource] ?? [])
      if (curr.has(action)) curr.delete(action)
      else curr.add(action)
      next[resource] = curr
      return next
    })
  }

  const handleSubmit = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault()
    setServerError(null)
    setOk(null)
    if (!name().trim()) {
      setServerError("name required")
      return
    }
    const permission: Record<string, ReadonlyArray<string>> = {}
    for (const [res, set] of Object.entries(grid())) {
      const arr = Array.from(set)
      if (arr.length > 0) permission[res] = arr
    }
    setBusy(true)
    try {
      const res = await authClient.organization.createRole({
        role: name().trim(),
        permission: permission as never,
      })
      if (res.error) {
        setServerError(res.error.message ?? "create failed")
        return
      }
      setOk(`Role "${name().trim()}" created`)
      setName("")
      setGrid({})
      p.onCreated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="mt-14 space-y-4" data-reveal style={{ "--i": "2" }}>
      <h2 class="micro-caps">Create a custom role</h2>
      <form onSubmit={handleSubmit} class="space-y-8 border-t border-rule pt-6">
        <label class="block space-y-2 max-w-md">
          <span class="micro-caps">Role name</span>
          <input
            type="text"
            placeholder="auditor"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            class="field font-mono"
          />
        </label>

        <div class="space-y-3">
          <p class="micro-caps">Permissions</p>
          <div class="space-y-3 border-t border-rule pt-3">
            <For each={RESOURCES}>
              {(resource) => (
                <fieldset class="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-4 border-b border-rule/60 pb-3">
                  <legend class="font-serif text-[1.125rem] italic text-ink">{resource}</legend>
                  <div class="flex flex-wrap gap-2">
                    <For each={STATEMENT[resource] as ReadonlyArray<string>}>
                      {(action) => {
                        const isOn = createMemo(() => grid()[resource]?.has(action) ?? false)
                        return (
                          <label class="cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isOn()}
                              onChange={() => toggle(resource, action)}
                              class="peer sr-only"
                            />
                            <span class="pill cursor-pointer transition-colors peer-checked:border-ink peer-checked:text-ink peer-checked:[box-shadow:inset_0_-1px_0_0_var(--color-ember)]">
                              {action}
                            </span>
                          </label>
                        )
                      }}
                    </For>
                  </div>
                </fieldset>
              )}
            </For>
          </div>
        </div>

        <Show when={ok()}>
          <p class="border-l-2 border-moss bg-paper-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
            {ok()}
          </p>
        </Show>
        <Show when={serverError()}>
          <p class="border-l-2 border-ember bg-ember-soft/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ember">
            {serverError()}
          </p>
        </Show>

        <button type="submit" disabled={busy()} class="btn-ink">
          <span>{busy() ? "Creating" : "Create role"}</span>
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </section>
  )
}

export default SettingsRoles
