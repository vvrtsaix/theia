import { A } from "@solidjs/router"
import type { Component } from "solid-js"

/**
 * Settings hub — index of admin surfaces. Each row links to a sub-route;
 * unbuilt sections render as a pill instead of a link.
 */
const Settings: Component = () => (
  <div class="mx-auto max-w-3xl px-12 py-16">
    <header class="space-y-3 border-b border-rule pb-6" data-reveal style={{ "--i": "0" }}>
      <p class="micro-caps">Volume I · Settings</p>
      <h1 class="font-serif text-[3rem] italic leading-[0.95] tracking-tight text-ink">
        House style
      </h1>
    </header>

    <ul class="mt-12 space-y-8">
      <SettingsRow index="01" title="Members & invitations" href="/settings/members" />
      <SettingsRow index="02" title="Roles & permissions" href="/settings/roles" />
      <SettingsRow index="03" title="Workflow" status="Later" />
      <SettingsRow index="04" title="Tenant" status="Later" />
    </ul>
  </div>
)

const SettingsRow: Component<{
  index: string
  title: string
  href?: string
  status?: string
}> = (p) => {
  const inner = (
    <>
      <span class="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-4">{p.index}</span>
      <span class="font-serif text-[1.5rem] text-ink">{p.title}</span>
      {p.href ? (
        <span class="justify-self-end font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3 transition-colors group-hover:text-ember">
          Open →
        </span>
      ) : (
        <span class="pill justify-self-end">{p.status}</span>
      )}
    </>
  )
  return (
    <li
      data-reveal
      style={{ "--i": p.index }}
      class="border-b border-rule/60 pb-4 transition-colors"
    >
      {p.href ? (
        <A
          href={p.href}
          class="group grid grid-cols-[48px_1fr_120px] items-baseline gap-4 transition-colors hover:text-ember"
        >
          {inner}
        </A>
      ) : (
        <div class="grid grid-cols-[48px_1fr_120px] items-baseline gap-4">{inner}</div>
      )}
    </li>
  )
}

export default Settings
