import type { Component } from "solid-js"

/**
 * Inbox — placeholder page on-brand. Real implementation lands in Phase 6.x
 * once the customer-channel ingest (email / webform → ticket) is wired.
 */
const Inbox: Component = () => (
  <div class="mx-auto max-w-4xl px-12 py-16">
    <header class="space-y-3 border-b border-rule pb-6" data-reveal style={{ "--i": "0" }}>
      <p class="micro-caps">Volume I · Inbox</p>
      <h1 class="font-serif text-[3rem] italic leading-[0.95] tracking-tight text-ink">Inbox</h1>
      <p class="max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
        Unfiled correspondence — emails, webform submissions, and forwarded messages waiting to be
        triaged into the ledger.
      </p>
    </header>

    <div
      class="mx-auto mt-24 max-w-[52ch] space-y-6 text-center"
      data-reveal
      style={{ "--i": "1" }}
    >
      <p class="micro-caps">— nothing arrived —</p>
      <p class="font-serif text-[2rem] italic leading-tight text-ink">
        Mailbox closed. <span class="text-ember">The kettle is on.</span>
      </p>
      <p class="text-[14px] leading-relaxed text-ink-2">
        Customer channels are not wired yet. Configure inbound email or the public form in Settings
        to begin filling this page.
      </p>
    </div>
  </div>
)

export default Inbox
