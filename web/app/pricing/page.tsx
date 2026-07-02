'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const includedFeatures = [
  'Unlimited workspaces, senders, and members',
  'CSV / JSON ingestion + one-click sample seeder',
  'Inbox-placement proxy scoring with component breakdown',
  'List-health ledger, suppression, and cohorts',
  'Sunset planner with revenue preview',
  'Revenue model + revenue-at-risk engine',
  'Spike alerts, alert rules, and notifications',
  'Send-frequency fatigue analysis',
  'SPF / DKIM / DMARC authentication posture',
  'Reputation timeline + exportable scorecards',
  'Reports and ESP integration connectors',
  'Public deliverability benchmark reference',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const [planName, setPlanName] = useState('Free')
  const [checkingOut, setCheckingOut] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await api.getBillingPlan()
        if (!active) return
        if (typeof res?.stripeEnabled === 'boolean') setStripeEnabled(res.stripeEnabled)
        if (res?.plan?.name) setPlanName(res.plan.name)
      } catch {
        // Not signed in or backend unreachable — pricing is still fully public/static.
      }
    })()
    return () => { active = false }
  }, [])

  const upgrade = async () => {
    setCheckingOut(true)
    try {
      const res = await api.startCheckout()
      if (res?.url) window.location.href = res.url
    } catch {
      // Billing not configured (503) — stays on the free plan, every feature already free.
    } finally {
      setCheckingOut(false)
    }
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <nav className="flex items-center justify-between border-b border-stone-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500 text-sm font-black text-stone-950">E</span>
          <span className="text-base font-bold tracking-tight text-white">EmailDeliverabilityRevenueGuard</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-sm text-stone-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-rose-400">Get Started</Link>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Simple pricing: it&rsquo;s all free</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-stone-400">
          Every feature of EmailDeliverabilityRevenueGuard is free for signed-in users. Billing is wired but optional, so the product is fully usable without payment.
        </p>

        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-rose-500/40 bg-stone-900/60 p-8 text-left">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-rose-300">Free plan</div>
              <div className="mt-1 text-4xl font-black text-white">$0<span className="text-base font-normal text-stone-500">/forever</span></div>
            </div>
            {planName && (
              <span className="rounded-full border border-stone-700 bg-stone-800 px-3 py-1 text-xs text-stone-300">Current: {planName}</span>
            )}
          </div>
          <ul className="mt-6 space-y-3">
            {includedFeatures.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-stone-300">
                <span className="mt-0.5 text-rose-400">✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/auth/sign-up"
            className="mt-8 block rounded-lg bg-rose-500 py-3 text-center font-semibold text-stone-950 transition-colors hover:bg-rose-400"
          >
            Start free
          </Link>
          {stripeEnabled && (
            <button
              onClick={upgrade}
              disabled={checkingOut}
              className="mt-3 block w-full rounded-lg border border-stone-700 py-3 text-center text-sm font-medium text-stone-200 transition-colors hover:bg-stone-800 disabled:opacity-50"
            >
              {checkingOut ? 'Redirecting...' : 'Upgrade to Pro (optional)'}
            </button>
          )}
          {!stripeEnabled && (
            <p className="mt-3 text-center text-xs text-stone-500">Paid plans are not enabled in this deployment. Everything is included for free.</p>
          )}
        </div>

        <p className="mt-10 text-sm text-stone-500">
          Looking for the data first? <Link href="/benchmarks" className="text-rose-400 hover:text-rose-300">View public deliverability benchmarks</Link>.
        </p>
      </section>

      <footer className="border-t border-stone-800 py-8 text-center text-sm text-stone-600">
        <p>EmailDeliverabilityRevenueGuard</p>
      </footer>
    </main>
  )
}
