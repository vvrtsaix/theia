import { type Component, createResource, For, Show } from "solid-js"
import { getClients, run } from "#lib/rpc"

/**
 * Workflow editor — admin-only.
 *
 * Sections: Statuses, Priorities, Types, Tags. Each lists the current
 * keys and exposes an inline add form. Per-row remove buttons trigger the
 * matching `workflow.remove*` RPC.
 *
 * Transitions matrix not yet exposed — needs a graph UI (or grid editor
 * with from/to dropdowns). Hits `workflow.setTransitions` when wired.
 *
 * Errors surface via `alert()` for now; toast UX TBD when the design
 * system gets a notification primitive.
 */
const SettingsWorkflow: Component = () => {
  const [workflow, { refetch }] = createResource(async () => {
    const c = await getClients()
    return run(c.workflow["workflow.get"]())
  })

  const reload = () => void refetch()

  return (
    <div class="mx-auto max-w-4xl px-12 py-16">
      <header class="space-y-4">
        <p class="micro-caps">Settings · Workflow</p>
        <h1 class="font-serif text-[2.5rem] italic leading-[1] tracking-tight text-ink">
          Statuses, priorities, types, and tags.
        </h1>
        <p class="max-w-prose text-[14px] text-ink-3">
          Define the vocabulary every ticket in this tenant uses. Edits apply on the next mutation
          handled by the entity actor.
        </p>
      </header>

      <Show
        when={workflow()}
        fallback={
          <p class="mt-16 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-4">Loading…</p>
        }
      >
        {(w) => (
          <div class="mt-16 space-y-16">
            <Section
              title="Statuses"
              items={() => w().statuses.map((s) => ({ key: s.key, label: s.label }))}
              add={async (key) => {
                const c = await getClients()
                await run(
                  c.workflow["workflow.addStatus"]({
                    status: { key, label: key, terminal: false },
                  }),
                )
                reload()
              }}
              remove={async (key) => {
                const c = await getClients()
                await run(c.workflow["workflow.removeStatus"]({ key }))
                reload()
              }}
            />
            <Section
              title="Priorities"
              items={() => w().priorities.map((p) => ({ key: p.key, label: p.label }))}
              add={async (key) => {
                const c = await getClients()
                await run(
                  c.workflow["workflow.addPriority"]({
                    priority: { key, label: key, rank: w().priorities.length },
                  }),
                )
                reload()
              }}
              remove={async (key) => {
                const c = await getClients()
                await run(c.workflow["workflow.removePriority"]({ key }))
                reload()
              }}
            />
            <Section
              title="Types"
              items={() => w().types.map((t) => ({ key: t.key, label: t.label }))}
              add={async (key) => {
                const c = await getClients()
                await run(c.workflow["workflow.addType"]({ type: { key, label: key } }))
                reload()
              }}
              remove={async (key) => {
                const c = await getClients()
                await run(c.workflow["workflow.removeType"]({ key }))
                reload()
              }}
            />
            <Section
              title="Tags"
              items={() => w().tags.map((t) => ({ key: t.key, label: t.label }))}
              add={async (key) => {
                const c = await getClients()
                await run(c.workflow["workflow.addTag"]({ tag: { key, label: key } }))
                reload()
              }}
              remove={async (key) => {
                const c = await getClients()
                await run(c.workflow["workflow.removeTag"]({ key }))
                reload()
              }}
            />
          </div>
        )}
      </Show>
    </div>
  )
}

const Section: Component<{
  title: string
  items: () => ReadonlyArray<{ key: string; label: string }>
  add: (key: string) => Promise<void>
  remove: (key: string) => Promise<void>
}> = (p) => {
  let input!: HTMLInputElement

  const onAdd = async (e: Event) => {
    e.preventDefault()
    const key = input.value.trim()
    if (!key) return
    try {
      await p.add(key)
      input.value = ""
    } catch (err) {
      alert(`Failed to add: ${(err as Error).message}`)
    }
  }

  const onRemove = async (key: string) => {
    if (!confirm(`Remove "${key}"?`)) return
    try {
      await p.remove(key)
    } catch (err) {
      alert(`Failed to remove: ${(err as Error).message}`)
    }
  }

  return (
    <section class="space-y-4">
      <h2 class="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">{p.title}</h2>
      <ul class="border-t border-rule">
        <For
          each={p.items()}
          fallback={
            <li class="border-b border-rule/60 py-4 text-[13px] italic text-ink-4">— none —</li>
          }
        >
          {(item) => (
            <li class="flex items-center justify-between border-b border-rule/60 py-3">
              <span class="font-mono text-[13px] text-ink-2">{item.key}</span>
              <button
                type="button"
                onClick={() => void onRemove(item.key)}
                class="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-4 transition-colors hover:text-ember"
              >
                Remove
              </button>
            </li>
          )}
        </For>
      </ul>
      <form onSubmit={(e) => void onAdd(e)} class="flex items-center gap-2 pt-2">
        <input
          ref={input}
          type="text"
          placeholder={`Add ${p.title.toLowerCase().replace(/s$/, "")} key…`}
          class="flex-1 border-b border-rule bg-transparent py-2 font-mono text-[13px] text-ink placeholder:text-ink-4 focus:border-ember focus:outline-none"
        />
        <button
          type="submit"
          class="border border-rule px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2 transition-colors hover:border-ember hover:text-ember"
        >
          Add
        </button>
      </form>
    </section>
  )
}

export default SettingsWorkflow
