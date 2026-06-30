import Link from 'next/link'

const features = [
  {
    title: 'Revenue-at-Risk Engine',
    body: 'Every bounce, spam-bound send, and dormant subscriber is mapped to dollars using your own per-send revenue model, so you see the loss before reputation breaks.',
  },
  {
    title: 'Inbox-Placement Scoring',
    body: 'A composite 0-100 placement score per sender per period, built from engagement decay and complaint rate against the Gmail/Yahoo lines. Every score lists its inputs and formula.',
  },
  {
    title: 'List-Health Ledger',
    body: 'Hard and soft bounce trends, role-account detection, and dormant-subscriber identification with a letter-grade list-health snapshot history.',
  },
  {
    title: 'Suppression Recommendations',
    body: 'Ranked addresses and segments to suppress, each with a reason code and a quantified revenue impact, exportable straight into your ESP.',
  },
  {
    title: 'Sunset Planner',
    body: 'Preview the revenue retained versus forfeited and the complaint-risk reduction before you sunset a disengaged cohort. No guesswork.',
  },
  {
    title: 'Engagement Cohorts',
    body: 'Recency and frequency cohorts with member counts, engagement rates, and revenue contribution so you can re-engage the segments that still pay.',
  },
  {
    title: 'Send-Frequency Fatigue',
    body: 'Frequency-versus-engagement curves that flag over-mailing and recommend a cadence with a projected complaint reduction.',
  },
  {
    title: 'Spike Alerts & Rules',
    body: 'Configurable thresholds on complaint, unsubscribe, and bounce rates. Alerts name the triggering campaign and segment so you act on the cause.',
  },
  {
    title: 'Authentication Posture',
    body: 'SPF, DKIM, DMARC, and one-click-unsubscribe checks per sender, aligned to the 2024+ bulk-sender enforcement requirements.',
  },
  {
    title: 'Reputation Timeline',
    body: 'A time series of complaint, bounce, engagement, and placement proxies per sender, rebuilt from your normalized events with annotations.',
  },
  {
    title: 'Exportable Scorecards',
    body: 'Point-in-time deliverability scorecards bundling grade, placement, list health, complaint rate, and revenue at risk with top recommended actions.',
  },
  {
    title: 'ESP-Agnostic Ingestion',
    body: 'Upload CSV or JSON exports from Klaviyo, Iterable, Braze, Mailchimp, and more with a column-mapping wizard, or seed realistic sample data in one click.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500 text-sm font-black text-slate-950">E</span>
          <span className="text-base font-bold tracking-tight text-white">EmailDeliverabilityRevenueGuard</span>
        </span>
        <div className="flex items-center gap-3 sm:gap-5">
          <Link href="/benchmarks" className="hidden text-sm text-slate-300 hover:text-white sm:inline">Benchmarks</Link>
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400">Get Started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
          Built for Gmail / Yahoo bulk-sender enforcement
        </span>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-white sm:text-5xl md:text-6xl">
          See the revenue email leaks <span className="text-sky-400">before</span> reputation breaks.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          EmailDeliverabilityRevenueGuard is a read-only analytics layer that sits beside your ESP and dollarizes deliverability decay, bounces, and list rot. It owns no sending. It is your independent audit, scoring, and early-warning system.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="rounded-lg bg-sky-500 px-6 py-3 text-base font-semibold text-slate-950 transition-colors hover:bg-sky-400">Start free</Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-slate-700 px-6 py-3 text-base font-medium text-slate-200 transition-colors hover:bg-slate-800">Sign in</Link>
        </div>
        <p className="mt-4 text-sm text-slate-500">Every feature free. No card required. Seed a realistic demo workspace in one click.</p>
      </section>

      {/* Problem */}
      <section className="border-y border-slate-800 bg-slate-900/40 px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Deliverability decay silently erases your highest-ROI channel</h2>
          <p className="mt-4 text-slate-400">
            By the time open and conversion rates visibly drop, sender reputation has already eroded, and reputation is brutally slow to rebuild. Senders must now keep spam-complaint rates under 0.3%, authenticate with SPF/DKIM/DMARC, and honor one-click unsubscribe. Cross the line and delivery throttles across your entire domain.
          </p>
          <p className="mt-4 font-medium text-sky-300">
            You need an instrument that says: &ldquo;You are 0.07% from the Gmail throttle line, and the Black Friday segment is driving it, putting $84k of next-quarter email revenue at risk.&rdquo;
          </p>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Everything reproducible and explainable</h2>
          <p className="mt-3 text-slate-400">Every score, alert, and dollar figure traces back to specific events and a documented formula.</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
              <h3 className="text-base font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-800 px-6 py-20">
        <div className="mx-auto max-w-3xl rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-500/10 to-slate-900 p-10 text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Turn enforcement thresholds into a revenue early-warning system</h2>
          <p className="mt-3 text-slate-400">Connect an ESP export or seed sample data, and watch the revenue-at-risk view light up in minutes.</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="rounded-lg bg-sky-500 px-6 py-3 text-base font-semibold text-slate-950 transition-colors hover:bg-sky-400">Create free account</Link>
            <Link href="/auth/sign-in" className="rounded-lg border border-slate-700 px-6 py-3 text-base font-medium text-slate-200 transition-colors hover:bg-slate-800">Sign in</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-10 text-center text-sm text-slate-600">
        <p>EmailDeliverabilityRevenueGuard — an independent deliverability and list-health analytics layer. Owns no sending.</p>
      </footer>
    </main>
  )
}
