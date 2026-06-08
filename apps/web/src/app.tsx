import { A, Route, useLocation, useNavigate } from "@solidjs/router"
import { Bell, Inbox, LogOut, Settings, Ticket } from "lucide-solid"
import { type Component, type JSX, Match, Show, Switch, createMemo, lazy } from "solid-js"
import { authClient } from "#auth/client"
import { useSession } from "#auth/session"
import { TenantSwitcher } from "#components/TenantSwitcher"

const TicketsPage = lazy(() => import("#routes/tickets"))
const TicketDetailPage = lazy(() => import("#routes/ticket-detail"))
const LoginPage = lazy(() => import("#routes/login"))
const SignupPage = lazy(() => import("#routes/signup"))
const SettingsPage = lazy(() => import("#routes/settings"))
const InboxPage = lazy(() => import("#routes/inbox"))
const NotificationsPage = lazy(() => import("#routes/notifications"))
const NewTicketPage = lazy(() => import("#routes/new-ticket"))
const NewTenantPage = lazy(() => import("#routes/new-tenant"))
const OnboardingPage = lazy(() => import("#routes/onboarding"))
const SettingsMembersPage = lazy(() => import("#routes/settings-members"))
const SettingsRolesPage = lazy(() => import("#routes/settings-roles"))
const InvitePage = lazy(() => import("#routes/invite"))

/**
 * Route tree. Auth-gated routes nest under `<Shell>` which mounts an
 * `<AuthGuard>` that redirects to `/login` when no session is present.
 * Public routes (`/login`, `/signup`) sit alongside the Shell.
 */
export const App: Component = () => (
  <>
    <Route path="/login" component={LoginPage} />
    <Route path="/signup" component={SignupPage} />
    <Route path="/onboarding" component={OnboardingPage} />
    <Route path="/invite/:id" component={InvitePage} />
    <Route path="/" component={Shell}>
      <Route path="/" component={TicketsPage} />
      <Route path="/tickets/new" component={NewTicketPage} />
      <Route path="/tickets/:id" component={TicketDetailPage} />
      <Route path="/tenants/new" component={NewTenantPage} />
      <Route path="/inbox" component={InboxPage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/settings/members" component={SettingsMembersPage} />
      <Route path="/settings/roles" component={SettingsRolesPage} />
      <Route path="/settings/*" component={SettingsPage} />
    </Route>
  </>
)

/**
 * Authenticated frame. While the session resource loads we render a quiet
 * placeholder; on null we redirect to `/login`; on a valid session we mount
 * the sidebar + main panel.
 */
const Shell: Component<{ children?: unknown }> = (props) => {
  const nav = useNavigate()
  const session = useSession()
  const status = () => {
    if (session.loading) return "loading" as const
    const data = session()?.data
    if (!data?.user) return "anon" as const
    if (!data.session?.activeOrganizationId) return "no-org" as const
    return "ready" as const
  }
  return (
    <Switch>
      <Match when={status() === "loading"}>
        <PageMuted message="Loading…" />
      </Match>
      <Match when={status() === "anon"}>
        {(() => {
          nav("/login", { replace: true })
          return <PageMuted message="Redirecting…" />
        })()}
      </Match>
      <Match when={status() === "no-org"}>
        {(() => {
          nav("/onboarding", { replace: true })
          return <PageMuted message="Loading tenants…" />
        })()}
      </Match>
      <Match when={status() === "ready"}>
        <div class="flex min-h-screen bg-paper text-ink">
          <Sidebar />
          <main class="flex-1 overflow-y-auto">{props.children as never}</main>
        </div>
      </Match>
    </Switch>
  )
}

const PageMuted: Component<{ message: string }> = (p) => (
  <div class="flex min-h-screen items-center justify-center bg-paper">
    <p class="micro-caps">{p.message}</p>
  </div>
)

const Sidebar: Component = () => (
  <aside class="sticky top-0 flex h-screen w-60 flex-col border-r border-rule px-6 py-8">
    <Wordmark />
    <nav class="mt-12 flex flex-col gap-px">
      <NavItem href="/" icon={<Ticket size={14} strokeWidth={1.5} />} label="Tickets" end />
      <NavItem href="/inbox" icon={<Inbox size={14} strokeWidth={1.5} />} label="Inbox" />
      <NavItem
        href="/notifications"
        icon={<Bell size={14} strokeWidth={1.5} />}
        label="Notifications"
      />
      <NavItem href="/settings" icon={<Settings size={14} strokeWidth={1.5} />} label="Settings" />
    </nav>
    <div class="mt-auto space-y-4 pt-12">
      <TenantSwitcher />
      <Divider />
      <Identity />
    </div>
  </aside>
)

/**
 * Wordmark — Instrument Serif italic, with a single ember diacritic that
 * doubles as the "ticket open" indicator across the app. Memorable enough to
 * read as a logo without ever needing an asset file.
 */
const Wordmark: Component = () => (
  <A href="/" class="group block">
    <span class="relative inline-flex items-baseline gap-1.5">
      <span class="font-serif text-[2rem] italic leading-none tracking-tight text-ink">Theia</span>
      <span
        aria-hidden="true"
        class="inline-block size-1.5 -translate-y-3 rounded-full bg-ember transition-transform duration-300 group-hover:-translate-y-3.5"
      />
    </span>
    <span class="micro-caps mt-2 block">Ticket Ledger</span>
  </A>
)

const NavItem: Component<{ href: string; icon: JSX.Element; label: string; end?: boolean }> = (
  p,
) => {
  const loc = useLocation()
  const active = createMemo(() =>
    p.end ? loc.pathname === p.href : loc.pathname.startsWith(p.href),
  )
  return (
    <A
      href={p.href}
      end={p.end}
      class="group relative flex items-center gap-3 py-2 pl-1 pr-2 text-[13px] text-ink-3 transition-colors duration-200 hover:text-ink"
      activeClass="text-ink"
    >
      <span class="absolute left-[-24px] top-1/2 h-3 w-[2px] -translate-y-1/2 origin-center scale-y-0 bg-ember transition-transform duration-300 group-hover:scale-y-100" />
      <span
        class="text-ink-4 transition-colors duration-200 group-hover:text-ink-2"
        classList={{ "text-ink-2": active() }}
      >
        {p.icon}
      </span>
      <span
        class="relative font-sans tracking-[-0.005em]"
        classList={{
          "after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-full after:bg-ink after:content-['']":
            active(),
        }}
      >
        {p.label}
      </span>
    </A>
  )
}

const Divider: Component = () => (
  <div class="relative flex items-center">
    <span class="h-px flex-1 bg-rule" />
    <span class="px-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-4">·</span>
    <span class="h-px flex-1 bg-rule" />
  </div>
)

/**
 * Identity card — name + tenant role, with a logout affordance. Reads from
 * the same session resource the AuthGuard uses, so it always reflects the
 * current user without separate fetches.
 */
const Identity: Component = () => {
  const nav = useNavigate()
  const session = useSession()
  const user = () => session()?.data?.user
  const role = () => session()?.data?.session?.activeOrganizationId ?? "—"

  const initials = () => {
    const name = user()?.name ?? user()?.email ?? "?"
    return name
      .split(/\s+/)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("")
  }

  const handleSignOut = async (): Promise<void> => {
    await authClient.signOut()
    nav("/login", { replace: true })
  }

  return (
    <div class="space-y-2">
      <p class="micro-caps">Signed in</p>
      <Show when={user()} fallback={<p class="font-mono text-[10px] text-ink-4">—</p>}>
        <div class="flex items-center gap-3">
          <span class="grid size-7 place-items-center rounded-full border border-rule bg-paper-2 font-mono text-[11px] text-ink-2">
            {initials()}
          </span>
          <div class="flex min-w-0 flex-col leading-tight">
            <span class="truncate text-[13px] text-ink">{user()?.name ?? user()?.email}</span>
            <span class="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
              {String(role()).slice(0, 8)}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Sign out"
            class="ml-auto rounded-full p-1.5 text-ink-3 transition-colors hover:bg-rule-soft hover:text-ember"
          >
            <LogOut size={13} strokeWidth={1.5} />
          </button>
        </div>
      </Show>
    </div>
  )
}
