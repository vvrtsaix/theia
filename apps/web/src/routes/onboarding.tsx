import { A, useNavigate } from "@solidjs/router"
import { type Component, createResource, Show } from "solid-js"
import { authClient } from "#auth/client"

/**
 * Onboarding — landing for users with no organizations.
 *
 * The Shell redirects here whenever the session has no `activeOrganizationId`
 * AND the user has no memberships. Two paths forward:
 *
 *   - Open a new tenant (navigates to `/tenants/new`)
 *   - Accept a pending invitation (links the user has been emailed)
 *
 * If the user already has a membership, this page auto-redirects to `/`
 * after setting the first org active — guards against accidental visits
 * after a successful invite acceptance.
 */
const Onboarding: Component = () => {
  const nav = useNavigate()
  const [orgs] = createResource(() => authClient.organization.list())

  // Auto-resolve when memberships exist — set the first as active and exit.
  const checkAndRedirect = async (): Promise<void> => {
    const list = orgs()?.data
    if (!list || list.length === 0) return
    await authClient.organization.setActive({ organizationId: list[0]?.id })
    nav("/", { replace: true })
  }
  if (typeof window !== "undefined") {
    void checkAndRedirect()
  }

  return (
    <div class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-12 py-16">
      <header class="space-y-4" data-reveal style={{ "--i": "0" }}>
        <p class="micro-caps">Volume I · First entry</p>
        <h1 class="font-serif text-[3.5rem] italic leading-[0.98] tracking-tight text-ink">
          A blank ledger.
        </h1>
        <p class="max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
          You have not joined a tenant yet. Open your own, or accept an invitation that's already
          waiting in your inbox.
        </p>
      </header>

      <Show
        when={!orgs.loading}
        fallback={
          <p class="mt-16 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-4">
            Checking memberships…
          </p>
        }
      >
        <div class="mt-14 flex flex-wrap items-center gap-4" data-reveal style={{ "--i": "1" }}>
          <A href="/tenants/new" class="btn-ink">
            <span>Open a tenant</span>
            <span aria-hidden="true">＋</span>
          </A>
          <button
            type="button"
            class="inline-flex items-center gap-2 border border-rule px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-2 transition-colors hover:border-ink hover:text-ink"
            onClick={() => authClient.signOut().then(() => nav("/login", { replace: true }))}
          >
            Sign out
          </button>
        </div>

        <p
          class="mt-12 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
          data-reveal
          style={{ "--i": "2" }}
        >
          Got an invitation link? Open the URL from your email — accepting it will land you back
          here.
        </p>
      </Show>
    </div>
  )
}

export default Onboarding
