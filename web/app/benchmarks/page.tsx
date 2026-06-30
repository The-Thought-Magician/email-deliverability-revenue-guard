'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Benchmark {
  id: string
  key: string
  label: string
  category: string
  value: number
  unit: string
  source: string | null
}

function categoryTone(category: string): 'sky' | 'green' | 'amber' | 'rose' | 'slate' {
  const c = category.toLowerCase()
  if (c.includes('complaint') || c.includes('spam')) return 'rose'
  if (c.includes('bounce')) return 'amber'
  if (c.includes('engagement') || c.includes('open') || c.includes('click')) return 'green'
  if (c.includes('placement') || c.includes('reputation')) return 'sky'
  return 'slate'
}

function formatValue(value: number, unit: string): string {
  const u = (unit || '').toLowerCase()
  if (u === '%' || u === 'percent' || u === 'rate') {
    return `${(value <= 1 ? value * 100 : value).toFixed(2)}%`
  }
  if (u === 'cents') return `$${(value / 100).toFixed(2)}`
  if (u === 'ratio') return value.toFixed(3)
  const formatted = Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)
  return unit && unit !== 'count' ? `${formatted} ${unit}` : formatted
}

export default function BenchmarksPage() {
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await api.listBenchmarks()
        if (!active) return
        setBenchmarks(Array.isArray(res) ? res : [])
      } catch (e) {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Failed to load benchmarks')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const b of benchmarks) if (b.category) set.add(b.category)
    return ['all', ...Array.from(set).sort()]
  }, [benchmarks])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return benchmarks.filter((b) => {
      if (activeCategory !== 'all' && b.category !== activeCategory) return false
      if (!q) return true
      return (
        b.label?.toLowerCase().includes(q) ||
        b.key?.toLowerCase().includes(q) ||
        b.category?.toLowerCase().includes(q) ||
        (b.source ?? '').toLowerCase().includes(q)
      )
    })
  }, [benchmarks, query, activeCategory])

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500 text-sm font-black text-slate-950">E</span>
          <span className="text-base font-bold tracking-tight text-white">EmailDeliverabilityRevenueGuard</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400">Get Started</Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-sky-400">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> Public reference
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Deliverability benchmarks</h1>
          <p className="max-w-2xl text-slate-400">
            Industry reference values for complaint rates, bounce thresholds, engagement, and inbox placement. Use these to calibrate
            your own sender health against Gmail and Yahoo bulk-sender expectations.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  activeCategory === c
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {c === 'all' ? 'All categories' : c}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search benchmarks..."
            className="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30 sm:w-64"
          />
        </div>

        <div className="mt-6">
          {loading ? (
            <PageLoader label="Loading benchmarks..." />
          ) : error ? (
            <EmptyState
              title="Could not load benchmarks"
              description={error}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={benchmarks.length === 0 ? 'No benchmarks available' : 'No matches'}
              description={benchmarks.length === 0 ? 'Benchmark reference data has not been seeded yet.' : 'Try a different search or category filter.'}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Benchmark</TH>
                  <TH>Category</TH>
                  <TH className="text-right">Value</TH>
                  <TH>Source</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((b) => (
                  <TR key={b.id ?? b.key}>
                    <TD>
                      <div className="font-medium text-slate-100">{b.label}</div>
                      <div className="font-mono text-xs text-slate-600">{b.key}</div>
                    </TD>
                    <TD>
                      <Badge tone={categoryTone(b.category)}>{b.category}</Badge>
                    </TD>
                    <TD className="text-right font-mono text-sky-300">{formatValue(b.value, b.unit)}</TD>
                    <TD className="text-slate-500">{b.source || '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        <p className="mt-8 text-sm text-slate-500">
          Ready to measure your own senders against these? <Link href="/auth/sign-up" className="text-sky-400 hover:text-sky-300">Create a free workspace</Link>.
        </p>
      </section>
    </main>
  )
}
