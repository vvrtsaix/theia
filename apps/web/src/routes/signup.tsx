import { createForm } from "@modular-forms/solid"
import { A, useNavigate } from "@solidjs/router"
import { Schema } from "effect"
import { type Component, Show, createSignal } from "solid-js"
import { authClient } from "#auth/client"
import { effectSchema } from "#lib/effect-form"

/**
 * Email/password signup.
 *
 * Validation: same Effect Schema layer as login (`effectSchema` adapter).
 * On success better-auth signs the user in immediately (no email
 * verification step yet — toggle in `packages/auth/src/auth.ts`), so we
 * navigate straight to the ledger.
 *
 * The new account has no membership; the SPA's onboarding view will offer
 * to create a tenant once Phase 2 lands. For dev convenience the dev-seed
 * pre-creates `dev@andsystems.tech` with a tenant attached.
 */

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const SignupSchema = Schema.Struct({
  name: Schema.NonEmptyString.check(Schema.isMinLength(2)),
  email: Schema.NonEmptyString.check(Schema.isPattern(emailPattern)),
  password: Schema.NonEmptyString.check(Schema.isMinLength(8)),
})

interface SignupInput {
  name: string
  email: string
  password: string
}

const Signup: Component = () => {
  const nav = useNavigate()
  const [authError, setAuthError] = createSignal<string | null>(null)
  const [form, { Form, Field }] = createForm<SignupInput>({
    validate: effectSchema(SignupSchema),
    validateOn: "blur",
    revalidateOn: "input",
  })

  const handleSubmit = async (values: SignupInput): Promise<void> => {
    setAuthError(null)
    const res = await authClient.signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
    })
    if (res.error) {
      setAuthError(res.error.message ?? "sign up failed")
      return
    }
    // Fresh signups have no memberships → onboarding flow.
    nav("/onboarding", { replace: true })
  }

  return (
    <div class="relative grid min-h-screen grid-cols-1 bg-paper md:grid-cols-[1.05fr_1fr]">
      <aside class="relative hidden flex-col justify-between border-r border-rule bg-paper-2 px-12 py-12 md:flex">
        <div>
          <span class="font-serif text-[2rem] italic leading-none tracking-tight text-ink">
            Theia
          </span>
          <span class="ml-1 inline-block size-1.5 -translate-y-2 rounded-full bg-ember align-middle" />
          <p class="micro-caps mt-3">Volume I · New Author</p>
        </div>

        <figure class="max-w-[42ch] space-y-6">
          <blockquote class="font-serif text-[2.5rem] italic leading-[1.05] tracking-tight text-ink">
            Every ledger begins with a <span class="text-ember">single entry</span>.
          </blockquote>
          <figcaption class="micro-caps">— house style, 1.0</figcaption>
        </figure>

        <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
          Already signed up?{" "}
          <A href="/login" class="text-ink hover:text-ember">
            Return to sign in
          </A>
        </p>
      </aside>

      <section class="flex items-center justify-center px-8 py-16">
        <Form onSubmit={handleSubmit} class="w-full max-w-[420px] space-y-10" aria-label="sign up">
          <header class="space-y-3" data-reveal style={{ "--i": "0" }}>
            <p class="micro-caps">002 · Create account</p>
            <h1 class="font-serif text-[2.75rem] italic leading-[1] tracking-tight text-ink">
              Begin <span class="text-ember">writing</span>.
            </h1>
            <p class="text-[15px] leading-relaxed text-ink-2">
              Open a new ledger or join one waiting on an invitation. Your account is global;
              tenants attach as memberships.
            </p>
          </header>

          <div class="space-y-8" data-reveal style={{ "--i": "1" }}>
            <Field name="name">
              {(
                field: { value: string | undefined; error: string },
                props: Record<string, unknown>,
              ) => (
                <label class="block space-y-2">
                  <span class="micro-caps">Name</span>
                  <input
                    {...props}
                    type="text"
                    autocomplete="name"
                    placeholder="Ada Lovelace"
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
                  <span class="micro-caps">Password (min 8)</span>
                  <input
                    {...props}
                    type="password"
                    autocomplete="new-password"
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

            <button type="submit" disabled={form.submitting} class="btn-ink w-full">
              <span>{form.submitting ? "Creating account" : "Create account"}</span>
              <span aria-hidden="true">→</span>
            </button>

            <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-4">
              By signing up you agree to the{" "}
              <A href="/" class="text-ink hover:text-ember">
                house style
              </A>
              .
            </p>
          </div>
        </Form>
      </section>
    </div>
  )
}

export default Signup
