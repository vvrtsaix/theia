import { lazy, type Component } from "solid-js"
import { Route, A } from "@solidjs/router"
import { Bell, Inbox, Settings, Ticket } from "lucide-solid"

const TicketsPage = lazy(() => import("#routes/tickets"))
const TicketDetailPage = lazy(() => import("#routes/ticket-detail"))
const LoginPage = lazy(() => import("#routes/login"))
const SettingsPage = lazy(() => import("#routes/settings"))

/**
 * Route tree. v0.15 `@solidjs/router` uses `<Router>` (mounted in `entry.tsx`)
 * with children that are `<Route>` declarations. Auth-gated routes wrap their
 * components inline via the layout pattern.
 */
export const App: Component = () => (
  <>
    <Route path="/login" component={LoginPage} />
    <Route path="/" component={Shell}>
      <Route path="/" component={TicketsPage} />
      <Route path="/tickets/:id" component={TicketDetailPage} />
      <Route path="/settings/*" component={SettingsPage} />
    </Route>
  </>
)

const Shell: Component<{ children?: unknown }> = (props) => (
  <div class="flex h-screen">
    <Sidebar />
    <main class="flex-1 overflow-y-auto bg-neutral-900">{props.children as never}</main>
  </div>
)

const Sidebar: Component = () => (
  <aside class="flex w-56 flex-col gap-1 border-r border-neutral-800 bg-neutral-950 p-3 text-sm">
    <h1 class="mb-4 px-2 text-lg font-semibold text-neutral-200">Theia</h1>
    <NavItem href="/" icon={<Ticket size={16} />} label="Tickets" />
    <NavItem href="/inbox" icon={<Inbox size={16} />} label="Inbox" />
    <NavItem href="/notifications" icon={<Bell size={16} />} label="Notifications" />
    <NavItem href="/settings" icon={<Settings size={16} />} label="Settings" />
  </aside>
)

const NavItem: Component<{ href: string; icon: unknown; label: string }> = (p) => (
  <A
    href={p.href}
    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
    activeClass="bg-neutral-900 text-neutral-100"
    end={p.href === "/"}
  >
    <span class="text-neutral-500">{p.icon as never}</span>
    {p.label}
  </A>
)
