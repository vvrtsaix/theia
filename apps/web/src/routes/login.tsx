import { createForm } from "@modular-forms/solid"
import { A, useNavigate } from "@solidjs/router"
import { Schema } from "effect"
import { type Component, createSignal, Show } from "solid-js"
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
  const nav = useNavigate()
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
      return
    }
    // better-auth creates the session with `activeOrganizationId = null`. Set
    // it to the user's first membership (if any) before redirecting, so the
    // Shell doesn't bounce through `/onboarding` for users that already
    // belong to a tenant.
    const orgs = await authClient.organization.list()
    const first = orgs.data?.[0]
    if (first) {
      await authClient.organization.setActive({ organizationId: first.id })
      nav("/", { replace: true })
    } else {
      nav("/onboarding", { replace: true })
    }
  }

  return (
    <div class="relative grid min-h-screen grid-cols-1 bg-paper md:grid-cols-[1.05fr_1fr]">
      <LoginAside />

      <section class="flex items-center justify-center px-8 py-16">
        <Form onSubmit={handleSubmit} class="w-full max-w-[420px] space-y-10" aria-label="sign in">
          <header data-reveal style={{ "--i": "0" }} class="space-y-3">
            <p class="micro-caps">001 · Access</p>
            <h1 class="font-serif text-[2.75rem] italic leading-[1] tracking-tight text-ink">
              Welcome <span class="text-ember">back</span>.
            </h1>
            <p class="text-[15px] leading-relaxed text-ink-2">
              Sign in to continue tending the queue. The paper remembers everything you wrote
              yesterday.
            </p>
          </header>

          <div class="space-y-8" data-reveal style={{ "--i": "1" }}>
            <Field name="email">
              {(
                field: { value: string | undefined; error: string },
                props: Record<string, unknown>,
              ) => (
                <label class="block space-y-2">
                  <span class="micro-caps">Email</span>
                  <input
                    {...props}
                    type="email"
                    autocomplete="email"
                    placeholder="name@andsystems.tech"
                    value={field.value ?? ""}
                    aria-invalid={field.error ? true : undefined}
                    class="field"
                  />
                  <Show when={field.error}>
                    <span class="block font-mono text-[11px] uppercase tracking-[0.08em] text-ember">
                      ↳ {field.error}
                    </span>
                  </Show>
                </label>
              )}
            </Field>

            <Field name="password">
              {(
                field: { value: string | undefined; error: string },
                props: Record<string, unknown>,
              ) => (
                <label class="block space-y-2">
                  <span class="micro-caps">Password</span>
                  <input
                    {...props}
                    type="password"
                    autocomplete="current-password"
                    placeholder="••••••••"
                    value={field.value ?? ""}
                    aria-invalid={field.error ? true : undefined}
                    class="field tracking-[0.2em]"
                  />
                  <Show when={field.error}>
                    <span class="block font-mono text-[11px] uppercase tracking-[0.08em] text-ember">
                      ↳ {field.error}
                    </span>
                  </Show>
                </label>
              )}
            </Field>
          </div>

          <div class="space-y-4" data-reveal style={{ "--i": "2" }}>
            <Show when={authError()}>
              <p class="border-l-2 border-ember bg-ember-soft/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ember">
                {authError()}
              </p>
            </Show>

            <button type="submit" disabled={loginForm.submitting} class="btn-ink w-full">
              <span>{loginForm.submitting ? "Signing in" : "Sign in"}</span>
              <span aria-hidden="true">→</span>
            </button>

            <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-4">
              Encrypted in transit · session bound to active tenant
            </p>
            <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              New here?{" "}
              <A href="/signup" class="text-ink hover:text-ember">
                Open an account →
              </A>
            </p>
          </div>
        </Form>
      </section>
    </div>
  )
}

/**
 * Left-side editorial column. Renders as a quiet manifesto for the product —
 * sets tone before the user has touched a single field. Hidden under `md`.
 */
const LoginAside: Component = () => (
  <aside class="relative hidden flex-col justify-between border-r border-rule bg-paper-2 px-12 py-12 md:flex">
    <div>
      <span class="font-serif text-[2rem] italic leading-none tracking-tight text-ink">Theia</span>
      <span class="ml-1 inline-block size-1.5 -translate-y-2 rounded-full bg-ember align-middle" />
      <p class="micro-caps mt-3">Volume I · Ledger</p>
    </div>

    <figure class="max-w-[42ch] space-y-6">
      <blockquote class="font-serif text-[2.5rem] italic leading-[1.05] tracking-tight text-ink">
        A ticket is a <span class="text-ember">letter</span> the future writes to itself.
      </blockquote>
      <figcaption class="micro-caps">— house style, 1.0</figcaption>
    </figure>

    <ol class="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
      <li>· Multi-tenant</li>
      <li>· Effect-TS v4</li>
      <li>· Postgres 18 · RLS</li>
      <li>· SolidJS · Bun</li>
    </ol>
  </aside>
)

export default Login
