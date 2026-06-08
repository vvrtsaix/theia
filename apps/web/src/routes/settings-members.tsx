import { createForm } from "@modular-forms/solid"
import { Schema } from "effect"
import { Trash2, X } from "lucide-solid"
import {
  type Component,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  Show,
} from "solid-js"
import { authClient } from "#auth/client"
import { useSession } from "#auth/session"
import { effectSchema } from "#lib/effect-form"
import { usePermission } from "#lib/permissions"

/**
 * Members + Invitations admin for the active tenant.
 *
 * Three panels on one editorial page:
 *
 *   1. Active members — name + email + role + remove button (current user
 *      cannot remove themselves; only owners see the remove affordance).
 *   2. Pending invitations — email + role + cancel button. Cancel deletes
 *      the invitation row; the recipient's link 404s afterwards.
 *   3. Invite form — email + role select. On submit, server emits an
 *      invitation row + (in dev) logs the accept URL to the API console.
 *
 * All mutations go through `authClient.organization.*`. The page refetches
 * its resources on every successful mutation so the lists stay in sync.
 */

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const InviteSchema = Schema.Struct({
  email: Schema.NonEmptyString.check(Schema.isPattern(emailPattern)),
  role: Schema.NonEmptyString,
})

interface InviteInput {
  email: string
  role: string
}

const ROLES = ["admin", "member", "guest"] as const

const SettingsMembers: Component = () => {
  const session = useSession()
  const activeOrg = createMemo(() => session()?.data?.session?.activeOrganizationId ?? null)
  const myUserId = createMemo(() => session()?.data?.user?.id ?? null)
  const canInvite = usePermission("member", "invite")
  const canRemoveMember = usePermission("member", "delete")
  const canUpdateRole = usePermission("member", "update")
  const canSeeInvitations = usePermission("member", "list")

  const [members, membersCtl] = createResource(activeOrg, async (orgId) =>
    orgId ? authClient.organization.listMembers({ query: { organizationId: orgId } }) : null,
  )
  const [invites, invitesCtl] = createResource(activeOrg, async (orgId) =>
    orgId ? authClient.organization.listInvitations({ query: { organizationId: orgId } }) : null,
  )

  return (
    <div class="mx-auto max-w-4xl px-12 py-16">
      <header class="space-y-3 border-b border-rule pb-6" data-reveal style={{ "--i": "0" }}>
        <p class="micro-caps">Volume I · Members</p>
        <h1 class="font-serif text-[3rem] italic leading-[0.95] tracking-tight text-ink">
          Who has access
        </h1>
        <p class="max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
          Manage who can read and write this tenant's ledger. Invitations land in the recipient's
          email; the accept URL appears in the API console during local development.
        </p>
      </header>

      <Show when={canInvite()}>
        <InvitePanel
          onInvited={() => {
            invitesCtl.refetch()
          }}
        />
      </Show>

      <Section
        title="Active members"
        empty="No members yet."
        loading={members.loading}
        items={(members()?.data?.members ?? []) as ReadonlyArray<Member>}
        index="2"
        render={(m) => (
          <MemberRow
            member={m}
            canRemove={canRemoveMember() && m.userId !== myUserId()}
            canEditRole={canUpdateRole() && m.userId !== myUserId()}
            onRemoved={() => membersCtl.refetch()}
            onRoleChanged={() => membersCtl.refetch()}
          />
        )}
      />

      <Show when={canSeeInvitations()}>
        <Section
          title="Pending invitations"
          empty="No pending invitations."
          loading={invites.loading}
          items={(invites()?.data ?? []) as ReadonlyArray<Invitation>}
          index="3"
          render={(i) => <InviteRow invitation={i} onCancelled={() => invitesCtl.refetch()} />}
        />
      </Show>
    </div>
  )
}

const Section = <T,>(props: {
  title: string
  empty: string
  loading: boolean
  items: ReadonlyArray<T>
  index: string
  render: (item: T) => JSX.Element
}): JSX.Element => (
  <section class="mt-14 space-y-4" data-reveal style={{ "--i": props.index }}>
    <h2 class="micro-caps">{props.title}</h2>
    <Show
      when={!props.loading}
      fallback={
        <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-4">Loading…</p>
      }
    >
      <Show
        when={props.items.length > 0}
        fallback={<p class="font-serif text-[1.25rem] italic text-ink-3">{props.empty}</p>}
      >
        <ul class="border-t border-rule">
          <For each={props.items}>
            {(item) => <li class="border-b border-rule/60">{props.render(item) as never}</li>}
          </For>
        </ul>
      </Show>
    </Show>
  </section>
)

interface Member {
  readonly id: string
  readonly userId: string
  readonly role: string
  readonly createdAt?: Date | string
  readonly user?: { name?: string; email?: string }
}

const MemberRow: Component<{
  member: Member
  canRemove: boolean
  canEditRole: boolean
  onRemoved: () => void
  onRoleChanged: () => void
}> = (p) => {
  const [busy, setBusy] = createSignal(false)
  const handleRemove = async (): Promise<void> => {
    const ok = window.confirm(`Remove ${p.member.user?.email ?? p.member.userId}?`)
    if (!ok) return
    setBusy(true)
    try {
      await authClient.organization.removeMember({ memberIdOrEmail: p.member.id })
      p.onRemoved()
    } finally {
      setBusy(false)
    }
  }
  const handleRoleChange = async (next: string): Promise<void> => {
    if (next === p.member.role) return
    setBusy(true)
    try {
      await authClient.organization.updateMemberRole({
        memberId: p.member.id,
        role: next as "admin" | "member" | "guest",
      })
      p.onRoleChanged()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="grid grid-cols-[minmax(0,1fr)_140px_56px] items-baseline gap-4 px-2 py-4">
      <div class="space-y-0.5">
        <p class="font-serif text-[1.125rem] text-ink">
          {p.member.user?.name ?? p.member.user?.email ?? p.member.userId}
        </p>
        <p class="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          {p.member.user?.email ?? "—"}
        </p>
      </div>
      <Show when={p.canEditRole} fallback={<span class="pill">{p.member.role}</span>}>
        <select
          value={p.member.role}
          disabled={busy()}
          onChange={(e) => handleRoleChange(e.currentTarget.value)}
          class="border border-rule bg-paper px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2 transition-colors hover:border-ink disabled:opacity-50"
        >
          <For each={ROLES}>{(r) => <option value={r}>{r}</option>}</For>
        </select>
      </Show>
      <Show when={p.canRemove} fallback={<span class="font-mono text-[10px] text-ink-4">—</span>}>
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy()}
          aria-label="Remove member"
          class="justify-self-end p-1.5 text-ink-3 transition-colors hover:text-ember disabled:opacity-50"
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </Show>
    </div>
  )
}

interface Invitation {
  readonly id: string
  readonly email: string
  readonly role: string | null
  readonly status: string
  readonly expiresAt?: Date | string
}

const InviteRow: Component<{
  invitation: Invitation
  onCancelled: () => void
}> = (p) => {
  const [busy, setBusy] = createSignal(false)
  const handleCancel = async (): Promise<void> => {
    setBusy(true)
    try {
      await authClient.organization.cancelInvitation({ invitationId: p.invitation.id })
      p.onCancelled()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="grid grid-cols-[minmax(0,1fr)_120px_120px_56px] items-baseline gap-4 px-2 py-4">
      <p class="font-serif text-[1.125rem] text-ink">{p.invitation.email}</p>
      <span class="pill">{p.invitation.role ?? "member"}</span>
      <span class="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
        {p.invitation.status}
      </span>
      <button
        type="button"
        onClick={handleCancel}
        disabled={busy()}
        aria-label="Cancel invitation"
        class="justify-self-end p-1.5 text-ink-3 transition-colors hover:text-ember disabled:opacity-50"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}

const InvitePanel: Component<{ onInvited: () => void }> = (p) => {
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [serverOk, setServerOk] = createSignal<string | null>(null)
  const [form, { Form, Field }] = createForm<InviteInput>({
    initialValues: { email: "", role: "member" },
    validate: effectSchema(InviteSchema),
    validateOn: "blur",
    revalidateOn: "input",
  })

  const handleSubmit = async (values: InviteInput): Promise<void> => {
    setServerError(null)
    setServerOk(null)
    const res = await authClient.organization.inviteMember({
      email: values.email,
      role: values.role as "admin" | "member" | "guest",
    })
    if (res.error) {
      setServerError(res.error.message ?? "invite failed")
      return
    }
    setServerOk(`Invitation sent to ${values.email}`)
    p.onInvited()
  }

  return (
    <section class="mt-14 space-y-4" data-reveal style={{ "--i": "1" }}>
      <h2 class="micro-caps">Invite a member</h2>
      <Form
        onSubmit={handleSubmit}
        class="grid grid-cols-[minmax(0,1fr)_140px_160px] items-end gap-4 border-t border-rule pt-6"
      >
        <Field name="email">
          {(
            field: { value: string | undefined; error: string },
            props: Record<string, unknown>,
          ) => (
            <label class="block space-y-2">
              <span class="micro-caps">Email</span>
              <input
                {...props}
                type="email"
                autocomplete="email"
                placeholder="name@andsystems.tech"
                value={field.value ?? ""}
                aria-invalid={field.error ? true : undefined}
                class="field"
              />
              <Show when={field.error}>
                <span class="block font-mono text-[11px] uppercase tracking-[0.08em] text-ember">
                  ↳ {field.error}
                </span>
              </Show>
            </label>
          )}
        </Field>

        <Field name="role">
          {(
            field: { value: string | undefined; error: string },
            props: Record<string, unknown>,
          ) => (
            <label class="block space-y-2">
              <span class="micro-caps">Role</span>
              <select
                {...props}
                value={field.value ?? "member"}
                class="field font-mono text-[12px] uppercase tracking-[0.06em]"
              >
                <For each={ROLES}>{(r) => <option value={r}>{r}</option>}</For>
              </select>
            </label>
          )}
        </Field>

        <button type="submit" disabled={form.submitting} class="btn-ink justify-self-end">
          <span>{form.submitting ? "Sending" : "Send invite"}</span>
          <span aria-hidden="true">→</span>
        </button>
      </Form>

      <Show when={serverOk()}>
        <p class="border-l-2 border-moss bg-paper-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
          {serverOk()}
        </p>
      </Show>
      <Show when={serverError()}>
        <p class="border-l-2 border-ember bg-ember-soft/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ember">
          {serverError()}
        </p>
      </Show>
    </section>
  )
}

export default SettingsMembers
