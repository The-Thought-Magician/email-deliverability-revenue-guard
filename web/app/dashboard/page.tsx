'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'

const WS_KEY = 'edrg.workspaceId'

interface Workspace { id: string; name: string; currency?: string | null; owner_id?: string }
interface RiskSummary {
  total?: number
  byCause?: { cause: string; at_risk_cents?: number; atRiskCents?: number }[]
  trend?: { period?: string; period_start?: string; at_risk_cents?: number; atRiskCents?: number }[]
}
interface PlacementScore { id: string; sender_id?: string; score?: number; period_end?: string }
interface Alert { id: string; severity?: string; status?: string; metric?: string; message?: string; triggered_at?: string }
interface Sender { id: string; friendly_name?: string; domain?: string }
interface HealthSnapshot { grade?: string; active_count?: number; dormant_count?: number; hard_bounce_rate?: number }

function centsToDollars(cents?: number): string {
  const v = (cents ?? 0) / 100
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}

function gradeTone(grade?: string): 'green' | 'sky' | 'amber' | 'rose' | 'slate' {
  if (!grade) return 'slate'
  const g = grade[0].toUpperCase()
  if (g === 'A') return 'green'
  if (g === 'B') return 'sky'
  if (g === 'C') return 'amber'
  return 'rose'
}

function severityTone(sev?: string): 'rose' | 'amber' | 'sky' | 'slate' {
  switch ((sev ?? '').toLowerCase()) {
    case 'critical':
    case 'high': return 'rose'
    case 'medium': return 'amber'
    case 'low': return 'sky'
    default: return 'slate'
  }
}

function scoreTone(score?: number): 'green' | 'sky' | 'amber' | 'rose' {
  const s = score ?? 0
  if (s >= 85) return 'green'
  if (s >= 70) return 'sky'
  if (s >= 50) return 'amber'
  return 'rose'
}

export default function DashboardPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [risk, setRisk] = useState<RiskSummary | null>(null)
  const [placement, setPlacement] = useState<PlacementScore[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [health, setHealth] = useState<HealthSnapshot | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId],
  )

  // Bootstrap: load workspaces, pick active.
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const list: Workspace[] = await api.listWorkspaces()
        if (!active) return
        const arr = Array.isArray(list) ? list : []
        setWorkspaces(arr)
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        const chosen = arr.find((w) => w.id === stored)?.id ?? arr[0]?.id ?? null
        setActiveId(chosen)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load workspaces')
      } finally {
        if (active) setBootstrapping(false)
      }
    })()
    return () => { active = false }
  }, [])

  const loadDashboard = useCallback(async (wsId: string) => {
    setLoadingData(true)
    setError(null)
    try {
      const senderList: Sender[] = await api.listSenders(wsId).catch(() => [])
      const sendersArr = Array.isArray(senderList) ? senderList : []
      const primarySender = sendersArr[0]?.id

      const [riskRes, placementRes, alertsRes, healthRes] = await Promise.all([
        api.getRevenueAtRiskSummary(wsId).catch(() => null),
        api.listPlacementScores(wsId).catch(() => []),
        api.listAlerts(wsId, 'open').catch(() => []),
        primarySender ? api.getListHealth(wsId, primarySender).catch(() => null) : Promise.resolve(null),
      ])

      setSenders(sendersArr)
      setRisk(riskRes ?? null)
      setPlacement(Array.isArray(placementRes) ? placementRes : [])
      setAlerts(Array.isArray(alertsRes) ? alertsRes : [])
      setHealth(healthRes?.latest ?? healthRes ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => {
    if (!activeId) return
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, activeId)
    loadDashboard(activeId)
  }, [activeId, loadDashboard])

  const createWorkspace = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const ws: Workspace = await api.createWorkspace({ name })
      setWorkspaces((prev) => [...prev, ws])
      setActiveId(ws.id)
      setCreateOpen(false)
      setNewName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workspace')
    } finally {
      setCreating(false)
    }
  }

  const runSeed = async () => {
    if (!activeId) return
    setSeeding(true)
    setSeedMsg(null)
    try {
      await api.seedSample(activeId)
      setSeedMsg('Sample data seeded. Refreshing dashboard...')
      await loadDashboard(activeId)
      setSeedMsg('Sample workspace populated with senders, campaigns, and 90 days of events.')
    } catch (e) {
      setSeedMsg(e instanceof Error ? e.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  // Derived headline values.
  const totalAtRisk = risk?.total ?? (risk?.byCause ?? []).reduce((s, c) => s + (c.at_risk_cents ?? c.atRiskCents ?? 0), 0)
  const latestPlacement = useMemo(() => {
    if (placement.length === 0) return undefined
    const sorted = [...placement].sort((a, b) => (b.period_end ?? '').localeCompare(a.period_end ?? ''))
    return sorted[0]?.score
  }, [placement])
  const avgPlacement = useMemo(() => {
    if (placement.length === 0) return undefined
    return placement.reduce((s, p) => s + (p.score ?? 0), 0) / placement.length
  }, [placement])
  const openAlerts = alerts.length
  const criticalAlerts = alerts.filter((a) => ['critical', 'high'].includes((a.severity ?? '').toLowerCase())).length

  const trendPoints = useMemo(() => {
    const t = risk?.trend ?? []
    return t.map((p) => (p.at_risk_cents ?? p.atRiskCents ?? 0))
  }, [risk])

  const hasData = senders.length > 0 || placement.length > 0 || (risk?.byCause?.length ?? 0) > 0

  if (bootstrapping) return <PageLoader label="Loading workspaces..." />

  if (workspaces.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Create your first workspace"
          description="A workspace holds your senders, imports, and deliverability analytics. Create one to get started."
          action={<Button onClick={() => setCreateOpen(true)}>New workspace</Button>}
        />
        <CreateWorkspaceModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          name={newName}
          setName={setNewName}
          onCreate={createWorkspace}
          creating={creating}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header + workspace switcher */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Deliverability overview</h1>
          <p className="mt-1 text-sm text-slate-500">Revenue exposure and sender health across {activeWorkspace?.name ?? 'your workspace'}.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="ws-switch">Workspace</label>
          <select
            id="ws-switch"
            value={activeId ?? ''}
            onChange={(e) => setActiveId(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>New</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {loadingData ? (
        <PageLoader label="Loading deliverability metrics..." />
      ) : !hasData ? (
        <Card>
          <CardBody>
            <EmptyState
              title="This workspace has no data yet"
              description="Seed a fully-populated sample workspace (senders, campaigns, and 90 days of events) to explore every report, or import your own data."
              action={
                <div className="flex flex-col items-center gap-3">
                  <Button onClick={runSeed} disabled={seeding}>
                    {seeding ? <span className="flex items-center gap-2"><Spinner className="h-4 w-4" /> Seeding...</span> : 'Seed sample data'}
                  </Button>
                  <Link href="/dashboard/imports/new" className="text-sm text-sky-400 hover:text-sky-300">or import your own CSV / JSON</Link>
                </div>
              }
            />
            {seedMsg && <p className="mt-4 text-center text-sm text-slate-400">{seedMsg}</p>}
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Headline stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Revenue at risk"
              value={centsToDollars(totalAtRisk)}
              tone={totalAtRisk > 0 ? 'rose' : 'green'}
              hint={totalAtRisk > 0 ? 'Projected exposure from deliverability issues' : 'No exposure detected'}
            />
            <Stat
              label="Inbox placement"
              value={latestPlacement != null ? `${Math.round(latestPlacement)}` : '—'}
              tone={latestPlacement != null ? scoreTone(latestPlacement) : 'sky'}
              hint={avgPlacement != null ? `Avg ${Math.round(avgPlacement)} across ${placement.length} score${placement.length === 1 ? '' : 's'}` : 'No scores computed yet'}
            />
            <Stat
              label="Open alerts"
              value={openAlerts}
              tone={criticalAlerts > 0 ? 'rose' : openAlerts > 0 ? 'amber' : 'green'}
              hint={criticalAlerts > 0 ? `${criticalAlerts} critical / high` : openAlerts > 0 ? 'Needs review' : 'All clear'}
            />
            <Stat
              label="List health"
              value={health?.grade ?? '—'}
              tone={(() => { const t = gradeTone(health?.grade); return t === 'slate' ? 'sky' : t })()}
              hint={health ? `${(health.active_count ?? 0).toLocaleString()} active / ${(health.dormant_count ?? 0).toLocaleString()} dormant` : 'No snapshot yet'}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Revenue at risk by cause + trend */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Revenue at risk</h2>
                <Link href="/dashboard/revenue-at-risk" className="text-xs text-sky-400 hover:text-sky-300">Full breakdown →</Link>
              </CardHeader>
              <CardBody className="space-y-5">
                <TrendChart points={trendPoints} />
                <div className="space-y-2">
                  {(risk?.byCause ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500">No at-risk records yet. Compute revenue at risk to populate this.</p>
                  ) : (
                    (risk?.byCause ?? [])
                      .map((c) => ({ cause: c.cause, cents: c.at_risk_cents ?? c.atRiskCents ?? 0 }))
                      .sort((a, b) => b.cents - a.cents)
                      .map((c) => {
                        const pct = totalAtRisk > 0 ? (c.cents / totalAtRisk) * 100 : 0
                        return (
                          <div key={c.cause}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="capitalize text-slate-300">{c.cause.replace(/_/g, ' ')}</span>
                              <span className="font-mono text-slate-400">{centsToDollars(c.cents)}</span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                              <div className="h-full rounded-full bg-rose-500/70" style={{ width: `${Math.max(2, pct)}%` }} />
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Open alerts */}
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Open alerts</h2>
                <Link href="/dashboard/alerts" className="text-xs text-sky-400 hover:text-sky-300">View all →</Link>
              </CardHeader>
              <CardBody>
                {alerts.length === 0 ? (
                  <p className="text-sm text-slate-500">No open alerts. Sender health is within thresholds.</p>
                ) : (
                  <ul className="space-y-3">
                    {alerts.slice(0, 6).map((a) => (
                      <li key={a.id} className="flex items-start gap-3">
                        <Badge tone={severityTone(a.severity)}>{a.severity ?? 'info'}</Badge>
                        <div className="min-w-0">
                          <div className="truncate text-sm text-slate-200">{a.message ?? a.metric ?? 'Alert'}</div>
                          {a.triggered_at && (
                            <div className="text-xs text-slate-600">{new Date(a.triggered_at).toLocaleString()}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Placement scores per sender */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Placement by sender</h2>
              <Link href="/dashboard/placement" className="text-xs text-sky-400 hover:text-sky-300">Placement detail →</Link>
            </CardHeader>
            <CardBody>
              {placement.length === 0 ? (
                <p className="text-sm text-slate-500">No placement scores computed yet.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {placement.slice(0, 6).map((p) => {
                    const senderName = senders.find((s) => s.id === p.sender_id)?.friendly_name
                      ?? senders.find((s) => s.id === p.sender_id)?.domain
                      ?? 'Sender'
                    const tone = scoreTone(p.score)
                    const barColor = tone === 'green' ? 'bg-emerald-500' : tone === 'sky' ? 'bg-sky-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-rose-500'
                    return (
                      <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                        <div className="flex items-center justify-between">
                          <span className="truncate text-sm text-slate-300">{senderName}</span>
                          <span className="font-mono text-sm text-slate-200">{Math.round(p.score ?? 0)}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(2, p.score ?? 0))}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Re-seed CTA available even with data */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4">
            <div>
              <div className="text-sm font-medium text-slate-200">Need fresh sample data?</div>
              <div className="text-xs text-slate-500">Re-seed this workspace with senders, campaigns, and 90 days of events.</div>
            </div>
            <Button variant="secondary" onClick={runSeed} disabled={seeding}>
              {seeding ? <span className="flex items-center gap-2"><Spinner className="h-4 w-4" /> Seeding...</span> : 'Seed sample data'}
            </Button>
          </div>
          {seedMsg && <p className="text-sm text-slate-400">{seedMsg}</p>}
        </>
      )}

      <CreateWorkspaceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        name={newName}
        setName={setNewName}
        onCreate={createWorkspace}
        creating={creating}
      />
    </div>
  )
}

function TrendChart({ points }: { points: number[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-800 text-xs text-slate-600">
        Not enough trend data to chart
      </div>
    )
  }
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const range = max - min || 1
  const w = 100
  const h = 100
  const step = w / (points.length - 1)
  const coords = points.map((p, i) => {
    const x = i * step
    const y = h - ((p - min) / range) * h
    return [x, y] as const
  })
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  return (
    <div className="h-24 w-full">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(244 63 94)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(244 63 94)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#riskFill)" />
        <path d={line} fill="none" stroke="rgb(251 113 133)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

function CreateWorkspaceModal({
  open, onClose, name, setName, onCreate, creating,
}: {
  open: boolean
  onClose: () => void
  name: string
  setName: (v: string) => void
  onCreate: () => void
  creating: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create workspace"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onCreate} disabled={creating || !name.trim()}>
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </>
      }
    >
      <label className="block text-sm font-medium text-slate-300">Workspace name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate() }}
        placeholder="Acme Marketing"
        className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
      />
      <p className="mt-2 text-xs text-slate-500">You will be added as the owner. You can rename it later in Settings.</p>
    </Modal>
  )
}
