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
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <nav className="flex items-center justify-between border-b border-stone-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500 text-sm font-black text-stone-950">E</span>
          <span className="text-base font-bold tracking-tight text-white">EmailDeliverabilityRevenueGuard</span>
        </span>
        <div className="flex items-center gap-3 sm:gap-5">
          <Link href="/benchmarks" className="hidden text-sm text-stone-300 hover:text-white sm:inline">Benchmarks</Link>
          <Link href="/pricing" className="text-sm text-stone-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-stone-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-stone-950 transition-colors hover:bg-rose-400">Get Started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 font-mono text-xs font-medium text-rose-300">
          read-only · no sending scope · SPF/DKIM/DMARC aware
        </span>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-white sm:text-5xl md:text-6xl">
          <span className="text-rose-400">$</span> deliverability_decay --to-dollars
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-stone-400">
          Point it at your ESP export. It normalizes sends, bounces, complaints, and opens into events, scores placement per sender per period, and prices every point of decay against your revenue model. No SDK, no sending API keys, no write scope.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="rounded-lg bg-rose-500 px-6 py-3 text-base font-semibold text-stone-950 transition-colors hover:bg-rose-400">Start free</Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-stone-700 px-6 py-3 text-base font-medium text-stone-200 transition-colors hover:bg-stone-800">Sign in</Link>
        </div>
        <p className="mt-4 text-sm text-stone-500">Free, full feature set. No card. `seed-demo` populates a realistic workspace in one click.</p>
      </section>

      {/* Code sample */}
      <section className="mx-auto max-w-3xl px-6 pb-16">
        <div className="overflow-hidden rounded-xl border border-stone-800 bg-stone-900">
          <div className="flex items-center justify-between border-b border-stone-800 px-4 py-2">
            <span className="font-mono text-xs text-stone-500">GET /api/senders/mail.acme.co/scorecard</span>
            <span className="font-mono text-xs text-rose-400">200</span>
          </div>
          <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed text-stone-300">
{`{
  "sender": "mail.acme.co",
  "period": "2026-06",
  "placement_score": 71,          // 0-100, complaint + engagement decay weighted
  "complaint_rate": 0.0027,       // Gmail/Yahoo throttle line: 0.003
  "distance_to_throttle": 0.0003,
  "auth": { "spf": "pass", "dkim": "pass", "dmarc": "quarantine" },
  "one_click_unsubscribe": true,
  "revenue_at_risk_usd": 84210,
  "driver_segment": "black_friday_reactivation",
  "recommendation": "suppress 4,812 dormant addresses, -0.09% complaints"
}`}
          </pre>
        </div>
        <p className="mt-3 text-center text-sm text-stone-500">
          Every field traces to a documented formula and the raw events behind it. No black-box scores.
        </p>
      </section>

      {/* Problem */}
      <section className="border-y border-stone-800 bg-stone-900/40 px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Placement erosion doesn&apos;t show up in your dashboards until it&apos;s expensive</h2>
          <p className="mt-4 text-stone-400">
            Open and conversion rates lag placement by days to weeks. By the time they visibly drop, reputation has already degraded, and rebuilding it is measured in months, not send cycles. Gmail and Yahoo enforce a complaint-rate ceiling near 0.3%, require SPF/DKIM/DMARC alignment, and mandate one-click unsubscribe. Cross the line and the whole sending domain gets throttled, not just the offending campaign.
          </p>
          <p className="mt-4 font-mono text-sm text-rose-300">
            distance_to_throttle: 0.0003 · driver_segment: black_friday_reactivation · revenue_at_risk_usd: 84210
          </p>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Every number is reproducible</h2>
          <p className="mt-3 text-stone-400">Scores, alerts, and dollar figures resolve to specific events and a documented formula, not a proprietary model.</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-stone-800 bg-stone-900/60 p-6">
              <h3 className="text-base font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-stone-800 px-6 py-20">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-500/10 to-stone-900 p-10 text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Wire the enforcement thresholds to your revenue model</h2>
          <p className="mt-3 font-mono text-sm text-stone-400">import a CSV/JSON export or run `seed-demo` — revenue-at-risk resolves in minutes.</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="rounded-lg bg-rose-500 px-6 py-3 text-base font-semibold text-stone-950 transition-colors hover:bg-rose-400">Create free account</Link>
            <Link href="/auth/sign-in" className="rounded-lg border border-stone-700 px-6 py-3 text-base font-medium text-stone-200 transition-colors hover:bg-stone-800">Sign in</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-800 py-10 text-center text-sm text-stone-600">
        <p>EmailDeliverabilityRevenueGuard — an independent deliverability and list-health analytics layer. Owns no sending.</p>
      </footer>
    </main>
  )
}
