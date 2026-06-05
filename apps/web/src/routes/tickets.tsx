import { createMemo, createResource, For, Show, type Component } from "solid-js"
import {
  createSolidTable,
  flexRender,
  getCoreRowModel,
  type ColumnDef,
} from "@tanstack/solid-table"
import { A } from "@solidjs/router"
import type { Entities } from "@theia/domain"
import { getClients, run } from "#lib/rpc"

type Row = Entities.TicketSummary

const columns: Array<ColumnDef<Row>> = [
  {
    accessorKey: "title",
    header: "Title",
    cell: (info) => (
      <A href={`/tickets/${info.row.original.id}`} class="text-neutral-100 hover:underline">
        {info.getValue() as string}
      </A>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (info) => <Badge value={info.getValue() as string} />,
  },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: (info) => <Badge value={info.getValue() as string} />,
  },
  {
    accessorKey: "assigneeId",
    header: "Assignee",
    cell: (info) => (
      <span class="text-neutral-400">{(info.getValue() as string | null) ?? "—"}</span>
    ),
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    cell: (info) => {
      const v = info.getValue() as Date | string
      return (
        <span class="text-neutral-500">
          {typeof v === "string" ? v : v.toISOString().slice(0, 16).replace("T", " ")}
        </span>
      )
    },
  },
]

const Tickets: Component = () => {
  const [data] = createResource(async () => {
    const c = await getClients()
    return run(c.ticket["ticket.list"]({}))
  })

  const rows = createMemo<ReadonlyArray<Row>>(() => data()?.items ?? [])
  const table = createSolidTable({
    get data() {
      return rows() as Array<Row>
    },
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div class="p-6">
      <h1 class="mb-4 text-lg font-semibold text-neutral-200">Tickets</h1>
      <Show
        when={!data.loading}
        fallback={<p class="text-sm text-neutral-500">Loading…</p>}
      >
        <table class="w-full border-collapse text-sm">
          <thead>
            <For each={table.getHeaderGroups()}>
              {(headerGroup) => (
                <tr class="border-b border-neutral-800">
                  <For each={headerGroup.headers}>
                    {(header) => (
                      <th class="px-3 py-2 text-left font-medium text-neutral-400">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </thead>
          <tbody>
            <For each={table.getRowModel().rows}>
              {(row) => (
                <tr class="border-b border-neutral-900 hover:bg-neutral-900">
                  <For each={row.getVisibleCells()}>
                    {(cell) => (
                      <td class="px-3 py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  )
}

const Badge: Component<{ value: string }> = (p) => (
  <span class="rounded-md bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{p.value}</span>
)

export default Tickets
