import { createSignal, type Component } from "solid-js"
import { authClient } from "#auth/client"

/**
 * Email/password login. Plain controlled form for v0 — modular-forms +
 * domain Schema integration lands in Phase 6.x.
 */
const Login: Component = () => {
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal(false)

  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await authClient.signIn.email({
        email: email(),
        password: password(),
      })
      if (res.error) setError(res.error.message ?? "sign in failed")
    } finally {
      setPending(false)
    }
  }

  return (
    <div class="flex h-screen items-center justify-center bg-neutral-950">
      <form onSubmit={submit} class="w-80 space-y-4">
        <h1 class="text-xl font-semibold text-neutral-100">Sign in</h1>
        <label class="block space-y-1">
          <span class="text-xs text-neutral-400">Email</span>
          <input
            type="email"
            required
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            class="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
          />
        </label>
        <label class="block space-y-1">
          <span class="text-xs text-neutral-400">Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            class="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
          />
        </label>
        {error() ? <p class="text-sm text-red-400">{error()}</p> : null}
        <button
          type="submit"
          disabled={pending()}
          class="w-full rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {pending() ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  )
}

export default Login
