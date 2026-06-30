'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'edrg.workspaceId'

type Workspace = { id: string; name: string; currency?: string }

type AtRiskRecord = {
  id: string
  sender_id?: string | null
  campaign_id?: string | null
  segment_id?: string | null
  period_start?: string | null
  period_end?: string | null
  cause: string
  at_risk_cents: number
  detail?: Record<string, unknown> | null
  created_at?: string
}

type CauseBucket = { cause: string; cents: number }
type TrendPoint = { period?: string; bucket?: string; label?: string; date?: string; cents: number }
type Summary = {
  byCause?: CauseBucket[]
  trend?: TrendPoint[]
  total?: number
}
type Contributor = {
  id?: string
  kind?: string
  type?: string
  name?: string
  label?: string
  cause?: string
  at_risk_cents?: number
  cents?: number
}

function fmtMoney(cents: number | undefined | null, currency = 'USD'): string {
  const v = (cents ?? 0) / 100
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v)
  } catch {
    return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  }
}

function causeLabel(c: string): string {
  return c
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

const CAUSE_TONES = ['#38bdf8', '#f43f5e', '#f59e0b', '#34d399', '#a78bfa', '#fb7185', '#22d3ee', '#facc15']

export default function RevenueAtRiskPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [records, setRecords] = useState<AtRiskRecord[]>([])
  const [contributors, setContributors] = useState<Contributor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [computing, setComputing] = useState(false)
  const [notice, setNotice] = useState<string>('')
  const [causeFilter, setCauseFilter] = useState<string>('all')
  const [search, setSearch] = useState<string>('')

  const currency = workspaces.find((w) => w.id === workspaceId)?.currency ?? 'USD'

  // Bootstrap workspaces + persisted selection
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        if (!active) return
        setWorkspaces(ws ?? [])
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        const initial = (stored && ws?.some((w) => w.id === stored)) ? stored : ws?.[0]?.id ?? ''
        setWorkspaceId(initial)
        if (!initial) setLoading(false)
      } catch (e) {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Failed to load workspaces')
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async (wsId: string) => {
    if (!wsId) return
    setLoading(true)
    setError('')
    try {
      const [sum, recs, contribs] = await Promise.all([
        api.getRevenueAtRiskSummary(wsId),
        api.listRevenueAtRisk(wsId),
        api.getTopContributors(wsId),
      ])
      setSummary(sum ?? {})
      setRecords(Array.isArray(recs) ? recs : [])
      setContributors(Array.isArray(contribs) ? contribs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load revenue at risk')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) load(workspaceId)
  }, [workspaceId, load])

  const onSelectWorkspace = (id: string) => {
    setWorkspaceId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, id)
  }

  const recompute = async () => {
    if (!workspaceId) return
    setComputing(true)
    setError('')
    setNotice('')
    try {
      await api.computeRevenueAtRisk({ workspaceId })
      await load(workspaceId)
      setNotice('Recomputed at-risk revenue from latest events.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recompute failed')
    } finally {
      setComputing(false)
    }
  }

  const byCause: CauseBucket[] = useMemo(() => {
    if (summary?.byCause && summary.byCause.length) {
      return [...summary.byCause].sort((a, b) => b.cents - a.cents)
    }
    // Derive from records as a fallback
    const map = new Map<string, number>()
    for (const r of records) map.set(r.cause, (map.get(r.cause) ?? 0) + (r.at_risk_cents ?? 0))
    return [...map.entries()].map(([cause, cents]) => ({ cause, cents })).sort((a, b) => b.cents - a.cents)
  }, [summary, records])

  const total = useMemo(() => {
    if (typeof summary?.total === 'number') return summary.total
    return byCause.reduce((s, c) => s + c.cents, 0)
  }, [summary, byCause])

  const trend: TrendPoint[] = useMemo(() => {
    return Array.isArray(summary?.trend) ? summary!.trend! : []
  }, [summary])

  const causes = useMemo(() => byCause.map((c) => c.cause), [byCause])

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase()
    return records.filter((r) => {
      if (causeFilter !== 'all' && r.cause !== causeFilter) return false
      if (!q) return true
      const hay = [r.cause, r.sender_id, r.campaign_id, r.segment_id, JSON.stringify(r.detail ?? {})]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [records, causeFilter, search])

  const maxBucket = Math.max(1, ...byCause.map((c) => c.cents))
  const maxTrend = Math.max(1, ...trend.map((t) => t.cents))

  if (loading && !summary) {
    return <PageLoader label="Loading revenue at risk..." />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Revenue at Risk</h1>
          <p className="mt-1 text-sm text-slate-500">
            Dollars exposed by deliverability degradation, broken down by root cause.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workspaces.length > 0 && (
            <select
              value={workspaceId}
              onChange={(e) => onSelectWorkspace(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" onClick={recompute} disabled={computing || !workspaceId}>
            {computing ? 'Recomputing...' : 'Recompute'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {!workspaceId ? (
        <EmptyState
          title="No workspace selected"
          description="Create a workspace from the dashboard to start tracking revenue at risk."
        />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Total at risk" value={fmtMoney(total, currency)} tone="rose" hint="Across all causes" />
            <Stat
              label="Top cause"
              value={byCause[0] ? causeLabel(byCause[0].cause) : '—'}
              tone="amber"
              hint={byCause[0] ? fmtMoney(byCause[0].cents, currency) : 'No data yet'}
            />
            <Stat label="Risk records" value={records.length} tone="sky" hint={`${causes.length} distinct causes`} />
          </div>

          {/* Breakdown by cause + trend */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">At Risk by Cause</h2>
              </CardHeader>
              <CardBody>
                {byCause.length === 0 ? (
                  <EmptyState
                    title="No at-risk revenue"
                    description="Recompute after importing send events to populate this breakdown."
                    action={
                      <Button variant="secondary" onClick={recompute} disabled={computing}>
                        Recompute now
                      </Button>
                    }
                  />
                ) : (
                  <div className="space-y-3">
                    {byCause.map((c, i) => {
                      const pct = total > 0 ? (c.cents / total) * 100 : 0
                      return (
                        <div key={c.cause}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-slate-300">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-sm"
                                style={{ backgroundColor: CAUSE_TONES[i % CAUSE_TONES.length] }}
                              />
                              {causeLabel(c.cause)}
                            </span>
                            <span className="font-medium text-slate-200">{fmtMoney(c.cents, currency)}</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(2, (c.cents / maxBucket) * 100)}%`,
                                backgroundColor: CAUSE_TONES[i % CAUSE_TONES.length],
                              }}
                            />
                          </div>
                          <div className="mt-0.5 text-right text-[11px] text-slate-500">{pct.toFixed(1)}% of total</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">Risk Trend</h2>
              </CardHeader>
              <CardBody>
                {trend.length === 0 ? (
                  <EmptyState title="No trend data" description="Trend appears once multiple periods have been computed." />
                ) : (
                  <div>
                    <div className="flex h-44 items-end gap-1.5">
                      {trend.map((t, i) => {
                        const h = (t.cents / maxTrend) * 100
                        const label = t.label ?? t.period ?? t.bucket ?? t.date ?? `P${i + 1}`
                        return (
                          <div key={`${label}-${i}`} className="group flex flex-1 flex-col items-center justify-end">
                            <div className="relative w-full">
                              <div
                                className="w-full rounded-t bg-sky-500/70 transition-colors group-hover:bg-sky-400"
                                style={{ height: `${Math.max(4, (h / 100) * 160)}px` }}
                                title={`${label}: ${fmtMoney(t.cents, currency)}`}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-2 flex justify-between text-[10px] text-slate-600">
                      <span>{trend[0]?.label ?? trend[0]?.period ?? trend[0]?.date ?? 'start'}</span>
                      <span>{fmtMoney(maxTrend, currency)} peak</span>
                      <span>
                        {trend[trend.length - 1]?.label ??
                          trend[trend.length - 1]?.period ??
                          trend[trend.length - 1]?.date ??
                          'now'}
                      </span>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Top contributors */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Top Contributors</h2>
            </CardHeader>
            <CardBody>
              {contributors.length === 0 ? (
                <EmptyState title="No contributors" description="Segments and campaigns ranked by risk appear here after a compute." />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {contributors.slice(0, 12).map((c, i) => {
                    const cents = c.at_risk_cents ?? c.cents ?? 0
                    const name = c.name ?? c.label ?? c.id ?? `Contributor ${i + 1}`
                    const kind = c.kind ?? c.type
                    return (
                      <div
                        key={`${name}-${i}`}
                        className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-200" title={name}>
                            {name}
                          </span>
                          {kind && <Badge tone="slate">{kind}</Badge>}
                        </div>
                        <div className="mt-1 text-lg font-semibold text-rose-300">{fmtMoney(cents, currency)}</div>
                        {c.cause && <div className="mt-0.5 text-xs text-slate-500">{causeLabel(c.cause)}</div>}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Detailed records */}
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-sm font-semibold text-white">Risk Records</h2>
                <div className="flex items-center gap-2">
                  <select
                    value={causeFilter}
                    onChange={(e) => setCauseFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="all">All causes</option>
                    {causes.map((c) => (
                      <option key={c} value={c}>
                        {causeLabel(c)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search records..."
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {filteredRecords.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState
                    title={records.length === 0 ? 'No risk records' : 'No matching records'}
                    description={
                      records.length === 0
                        ? 'Recompute to surface at-risk revenue by period and cause.'
                        : 'Adjust the cause filter or search query.'
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Cause</TH>
                      <TH>Period</TH>
                      <TH>Sender</TH>
                      <TH>Segment</TH>
                      <TH>Campaign</TH>
                      <TH className="text-right">At Risk</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filteredRecords.map((r) => (
                      <TR key={r.id}>
                        <TD>
                          <Badge tone="rose">{causeLabel(r.cause)}</Badge>
                        </TD>
                        <TD className="whitespace-nowrap text-xs text-slate-400">
                          {r.period_start ? new Date(r.period_start).toLocaleDateString() : '—'}
                          {r.period_end ? ` → ${new Date(r.period_end).toLocaleDateString()}` : ''}
                        </TD>
                        <TD className="font-mono text-xs text-slate-400">{r.sender_id ? r.sender_id.slice(0, 8) : '—'}</TD>
                        <TD className="font-mono text-xs text-slate-400">{r.segment_id ? r.segment_id.slice(0, 8) : '—'}</TD>
                        <TD className="font-mono text-xs text-slate-400">{r.campaign_id ? r.campaign_id.slice(0, 8) : '—'}</TD>
                        <TD className="text-right font-medium text-rose-300">{fmtMoney(r.at_risk_cents, currency)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
