import { Effect } from "effect"
import { makeClients, type TheiaClients } from "@theia/rpc-client"

/**
 * Module-scoped RPC client singleton. Methods on each client return Effect
 * values; we wrap with `Effect.runPromise` at the call site so Solid
 * components see Promises (works with `createResource` out of the box).
 */
let bundle: ReturnType<typeof makeClients> | null = null
let clientsPromise: Promise<TheiaClients> | null = null

const getBundle = () => {
  if (!bundle) bundle = makeClients("")
  return bundle
}

export const getClients = () => {
  if (!clientsPromise) clientsPromise = getBundle().clients
  return clientsPromise
}

/** Run an Effect from the RPC client through this app's runtime. */
export const run = <A, E>(effect: Effect.Effect<A, E>) =>
  getBundle().runtime.runPromise(effect)

/** Call on app teardown (`window.beforeunload`). */
export const disposeClients = () => bundle?.dispose()
