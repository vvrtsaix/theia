import { Layer } from "effect"
import { NotificationHandlers } from "#handlers/notification"
import { SystemConfigHandlers } from "#handlers/system"
import { TicketHandlers } from "#handlers/ticket"
import { WorkflowHandlers } from "#handlers/workflow"

export { NotificationHandlers, SystemConfigHandlers, TicketHandlers, WorkflowHandlers }

/**
 * Bundle of every handler layer. Caller still has to provide:
 *   - `Database` + `SqlClient.SqlClient` (Phase 2, `@theia/db`)
 *   - `CurrentSession` (Phase 3, `@theia/auth` middleware)
 *   - `TicketEntity` cluster client (Phase 5)
 */
export const AllHandlers = Layer.mergeAll(
  WorkflowHandlers,
  NotificationHandlers,
  SystemConfigHandlers,
  TicketHandlers,
)
