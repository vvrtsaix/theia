import { A, useNavigate, useParams } from "@solidjs/router"
import { type Component, createResource, Show } from "solid-js"
import { authClient } from "#auth/client"

/**
 * Accept invitation route — `/invite/:id`.
 *
 * The recipient lands here via the URL emitted by `sendInvitationEmail`.
 * Flow:
 *
 *   1. Ensure the user is signed in. If not, send them through `/signup`
 *      (with a hint to use the same email as the invitation). Real flow
 *      would carry a `next` param; for v0 we just hand the link.
 *   2. Call `authClient.organization.acceptInvitation({ invitationId })`.
 *      better-auth validates ownership of the email and adds the user as a
 *      member of the org with the invited role.
 *   3. Set the new org as the active tenant + redirect to `/`.
 */
const InviteAccept: Component = () => {
  const params = useParams()
  const nav = useNavigate()

  const [state] = createResource(
    () => params.id,
    async (invitationId) => {
      const session = await authClient.getSession()
      if (!session.data?.user) {
        return { kind: "anon" as const, invitationId }
      }
      const res = await authClient.organization.acceptInvitation({ invitationId })
      if (res.error) {
        return { kind: "error" as const, message: res.error.message ?? "accept failed" }
      }
      const orgId = res.data?.invitation?.organizationId ?? res.data?.member?.organizationId
      if (orgId) {
        await authClient.organization.setActive({ organizationId: orgId })
      }
      nav("/", { replace: true })
      return { kind: "ok" as const }
    },
  )

  return (
    <div class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-12 py-16">
      <header class="space-y-3" data-reveal style={{ "--i": "0" }}>
        <p class="micro-caps">Invitation</p>
        <h1 class="font-serif text-[3rem] italic leading-[0.98] tracking-tight text-ink">
          Accepting your invitation
        </h1>
      </header>

      <div class="mt-10" data-reveal style={{ "--i": "1" }}>
        <Show
          when={!state.loading}
          fallback={
            <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-4">Working…</p>
          }
        >
          <Show
            when={state()?.kind === "anon"}
            fallback={
              <Show
                when={state()?.kind === "error"}
                fallback={
                  <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                    Joined. Redirecting…
                  </p>
                }
              >
                <p class="border-l-2 border-ember bg-ember-soft/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ember">
                  {state()?.kind === "error" && "message" in state()!
                    ? (state() as { kind: "error"; message: string }).message
                    : ""}
                </p>
              </Show>
            }
          >
            <p class="max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
              You must be signed in to accept this invitation. Open an account with the email it was
              sent to, then return to this URL.
            </p>
            <div class="mt-8 flex items-center gap-4">
              <A href="/signup" class="btn-ink">
                <span>Create account</span>
                <span aria-hidden="true">→</span>
              </A>
              <A
                href="/login"
                class="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3 transition-colors hover:text-ink"
              >
                I already have one
              </A>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}

export default InviteAccept
