import { createSignal, Show, type Component } from "solid-js"
import { createForm } from "@modular-forms/solid"
import { Schema } from "effect"
import { authClient } from "#auth/client"
import { effectSchema } from "#lib/effect-form"

/**
 * Email/password login.
 *
 * Validation lives in an **Effect Schema** — the same Schema layer the
 * backend uses for RPC payload validation. The `effectSchema` adapter
 * (`#lib/effect-form`) projects Schema decode failures into the field-error
 * shape modular-forms expects.
 */

/**
 * Same shape constraint better-auth uses server-side: `local@domain.tld`. Keeps
 * client + server validation in sync so the user gets an inline error instead
 * of a roundtrip rejection.
 */
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const LoginSchema = Schema.Struct({
  email: Schema.NonEmptyString.check(Schema.isPattern(emailPattern)),
  password: Schema.NonEmptyString.check(Schema.isMinLength(8)),
})

interface LoginInput {
  email: string
  password: string
}

const Login: Component = () => {
  const [authError, setAuthError] = createSignal<string | null>(null)
  const [loginForm, { Form, Field }] = createForm<LoginInput>({
    validate: effectSchema(LoginSchema),
    validateOn: "blur",
    revalidateOn: "input",
  })

  const handleSubmit = async (values: LoginInput): Promise<void> => {
    setAuthError(null)
    const res = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    })
    if (res.error) {
      setAuthError(res.error.message ?? "sign in failed")
    }
  }

  return (
    <div class="flex h-screen items-center justify-center bg-neutral-950">
      <Form onSubmit={handleSubmit} class="w-80 space-y-4">
        <h1 class="text-xl font-semibold text-neutral-100">Sign in</h1>

        <Field name="email">
          {(field: { value: string | undefined; error: string }, props: Record<string, unknown>) => (
            <label class="block space-y-1">
              <span class="text-xs text-neutral-400">Email</span>
              <input
                {...props}
                type="email"
                autocomplete="email"
                value={field.value ?? ""}
                aria-invalid={field.error ? true : undefined}
                class="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600 aria-[invalid=true]:border-red-500"
              />
              <Show when={field.error}>
                <span class="text-xs text-red-400">{field.error}</span>
              </Show>
            </label>
          )}
        </Field>

        <Field name="password">
          {(field: { value: string | undefined; error: string }, props: Record<string, unknown>) => (
            <label class="block space-y-1">
              <span class="text-xs text-neutral-400">Password</span>
              <input
                {...props}
                type="password"
                autocomplete="current-password"
                value={field.value ?? ""}
                aria-invalid={field.error ? true : undefined}
                class="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600 aria-[invalid=true]:border-red-500"
              />
              <Show when={field.error}>
                <span class="text-xs text-red-400">{field.error}</span>
              </Show>
            </label>
          )}
        </Field>

        <Show when={authError()}>
          <p class="text-sm text-red-400">{authError()}</p>
        </Show>

        <button
          type="submit"
          disabled={loginForm.submitting}
          class="w-full rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {loginForm.submitting ? "Signing in…" : "Sign in"}
        </button>
      </Form>
    </div>
  )
}

export default Login
