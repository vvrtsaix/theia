import { makeClients, type TheiaClients } from "@theia/rpc-client"
import { Effect, Fiber, Stream } from "effect"
import type { Accessor } from "solid-js"
import { createSignal, onCleanup } from "solid-js"

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
export const run = <A, E>(effect: Effect.Effect<A, E>) => getBundle().runtime.runPromise(effect)

/** Call on app teardown (`window.beforeunload`). */
export const disposeClients = () => bundle?.dispose()

/**
 * Subscribe to a stream RPC and surface it as a Solid signal.
 *
 *   - `stream` — the `Stream.Stream` returned by a stream RPC method.
 *   - `reducer` — folds each incoming element into the current state.
 *   - `initial` — starting state before the first element arrives.
 *
 * Returns the current accessor. The underlying fiber is interrupted on
 * `onCleanup`, which fires when the calling component (or the enclosing
 * `createRoot`) is disposed.
 *
 * Errors are forwarded to `onError` if provided; otherwise logged.
 */
export const subscribeStream = <A, B, E>(
  stream: Stream.Stream<A, E>,
  reducer: (acc: B, value: A) => B,
  initial: B,
  options?: { onError?: (error: E) => void },
): Accessor<B> => {
  const [state, setState] = createSignal(initial)

  // Disposed flag guards against late-arriving stream values that race
  // with the cleanup fiber — Fiber.interrupt is async, so an in-flight
  // Effect.sync may still try to setState after the component unmounts.
  let disposed = false

  const fiber = getBundle().runtime.runFork(
    stream.pipe(
      Stream.runForEach((value: A) =>
        Effect.sync(() => {
          if (disposed) return
          setState(() => reducer(state() as B, value))
        }),
      ),
      Effect.catch((e: E) =>
        Effect.sync(() => {
          if (disposed) return
          if (options?.onError) options.onError(e)
          else console.warn("[stream] error", e)
        }),
      ),
    ),
  )

  onCleanup(() => {
    disposed = true
    // Fire interrupt; runtime tears down the fiber and any acquired
    // resources (HTTP chunked decode, retry timers). We don't await it —
    // Solid's onCleanup is sync — but the disposed flag above blocks any
    // late setState calls from leaking past unmount.
    getBundle().runtime.runFork(Fiber.interrupt(fiber))
  })

  return state
}
