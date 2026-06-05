import { createResource, Show, type Component } from "solid-js"
import { useParams } from "@solidjs/router"
import { getClients, run } from "#lib/rpc"

const TicketDetail: Component = () => {
  const params = useParams()
  const [ticket] = createResource(
    () => params.id,
    async (id) => {
      const c = await getClients()
      return run(c.ticket["ticket.get"]({ id: id as never }))
    },
  )

  return (
    <div class="p-6">
      <Show when={ticket()} fallback={<p class="text-sm text-neutral-500">Loading…</p>}>
        {(t) => (
          <div class="space-y-2">
            <h1 class="text-lg font-semibold text-neutral-100">{t().title}</h1>
            <p class="text-sm text-neutral-400">{t().description}</p>
            <pre class="rounded-md bg-neutral-900 p-3 text-xs text-neutral-500">
              {JSON.stringify(t(), null, 2)}
            </pre>
          </div>
        )}
      </Show>
    </div>
  )
}

export default TicketDetail
