'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'edrg.workspaceId'

type Workspace = { id: string; name: string }
type Sender = { id: string; domain?: string; friendly_name?: string; friendlyName?: string; status?: string }
type ReputationPoint = {
  id?: string
  bucket_at?: string
  bucketAt?: string
  at?: string
  complaint_rate?: number
  complaintRate?: number
  bounce_rate?: number
  bounceRate?: number
  engagement_rate?: number
  engagementRate?: number
  placement_score?: number
  placementScore?: number
  annotation?: string | null
}

type Metric = 'placement' | 'engagement' | 'complaint' | 'bounce'

const METRICS: { key: Metric; label: string; stroke: string; fill: string }[] = [
  { key: 'placement', label: 'Placement score', stroke: '#38bdf8', fill: '#0ea5e9' },
  { key: 'engagement', label: 'Engagement rate', stroke: '#34d399', fill: '#10b981' },
  { key: 'complaint', label: 'Complaint rate', stroke: '#fbbf24', fill: '#f59e0b' },
  { key: 'bounce', label: 'Bounce rate', stroke: '#fb7185', fill: '#f43f5e' },
]

function senderName(s?: Sender) {
  if (!s) return 'Unknown sender'
  return s.friendly_name || s.friendlyName || s.domain || s.id
}
function num(...vals: (number | undefined)[]) {
  for (const v of vals) if (typeof v === 'number' && !Number.isNaN(v)) return v
  return undefined
}
function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function fmtDateTime(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
// rates may arrive 0..1 or 0..100; normalize to percentage points
function asPct(v?: number) {
  if (typeof v !== 'number' || Number.isNaN(v)) return undefined
  return v <= 1 ? v * 100 : v
}
function asScore(v?: number) {
  if (typeof v !== 'number' || Number.isNaN(v)) return undefined
  return v <= 1 ? v * 100 : v
}
function pointAt(p: ReputationPoint) {
  return p.bucket_at || p.bucketAt || p.at || ''
}
function metricValue(p: ReputationPoint, m: Metric): number | undefined {
  switch (m) {
    case 'placement':
      return asScore(num(p.placement_score, p.placementScore))
    case 'engagement':
      return asPct(num(p.engagement_rate, p.engagementRate))
    case 'complaint':
      return asPct(num(p.complaint_rate, p.complaintRate))
    case 'bounce':
      return asPct(num(p.bounce_rate, p.bounceRate))
  }
}
function scoreTone(score?: number): 'green' | 'amber' | 'rose' | 'slate' {
  if (typeof score !== 'number') return 'slate'
  if (score >= 80) return 'green'
  if (score >= 60) return 'amber'
  return 'rose'
}

export default function ReputationPage() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [selectedSender, setSelectedSender] = useState<string>('')
  const [points, setPoints] = useState<ReputationPoint[]>([])
  const [metric, setMetric] = useState<Metric>('placement')
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        if (!active) return
        setWorkspaces(ws || [])
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : ''
        const chosen = (stored && (ws || []).some((w) => w.id === stored) ? stored : ws?.[0]?.id) || ''
        setWorkspaceId(chosen)
        if (!chosen) setLoading(false)
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load workspaces')
          setLoading(false)
        }
      }
    })()
    return () => { active = false }
  }, [])

  const load = useCallback(async (wsId: string, senderId: string) => {
    setLoading(true)
    setError('')
    try {
      const sendersRes: Sender[] = (await api.listSenders(wsId)) || []
      setSenders(sendersRes)
      const effectiveSender = senderId || (sendersRes[0]?.id ?? '')
      if (!senderId && effectiveSender) setSelectedSender(effectiveSender)
      if (effectiveSender) {
        try {
          const rep = await api.getReputation(wsId, effectiveSender)
          setPoints((rep?.points as ReputationPoint[]) || [])
        } catch {
          setPoints([])
        }
      } else {
        setPoints([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reputation data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) {
      if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, workspaceId)
      load(workspaceId, selectedSender)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const onSenderChange = (id: string) => {
    setSelectedSender(id)
    if (workspaceId) load(workspaceId, id)
  }

  const rebuild = async () => {
    if (!workspaceId || !selectedSender) return
    setRebuilding(true)
    setError('')
    try {
      const rep = await api.rebuildReputation({ workspaceId, senderId: selectedSender })
      setPoints((rep?.points as ReputationPoint[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rebuild reputation timeline')
    } finally {
      setRebuilding(false)
    }
  }

  const sorted = useMemo(() => {
    return [...points].sort((a, b) => new Date(pointAt(a) || 0).getTime() - new Date(pointAt(b) || 0).getTime())
  }, [points])

  const annotated = useMemo(() => sorted.filter((p) => p.annotation && p.annotation.trim().length > 0), [sorted])
  const latest = sorted[sorted.length - 1]
  const first = sorted[0]
  const senderById = useMemo(() => new Map(senders.map((s) => [s.id, s])), [senders])

  const latestPlacement = latest ? asScore(num(latest.placement_score, latest.placementScore)) : undefined
  const placementDelta = useMemo(() => {
    const a = first ? asScore(num(first.placement_score, first.placementScore)) : undefined
    const b = latestPlacement
    if (typeof a !== 'number' || typeof b !== 'number') return undefined
    return b - a
  }, [first, latestPlacement])

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading reputation..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Sender Reputation</h1>
          <p className="mt-1 text-sm text-stone-400">
            Reputation timeline rebuilt from send events — placement, engagement, complaint, and bounce trends with annotated events.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {workspaces.length > 1 && (
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
          <select
            value={selectedSender}
            onChange={(e) => onSenderChange(e.target.value)}
            disabled={senders.length === 0}
            className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none disabled:opacity-50"
          >
            {senders.length === 0 && <option value="">No senders</option>}
            {senders.map((s) => (
              <option key={s.id} value={s.id}>{senderName(s)}</option>
            ))}
          </select>
          <Button onClick={rebuild} disabled={!selectedSender || rebuilding}>
            {rebuilding ? <><Spinner className="mr-2 h-4 w-4" /> Rebuilding</> : 'Rebuild timeline'}
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading reputation timeline..." />
      ) : !workspaceId ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace from the dashboard to start tracking sender reputation."
        />
      ) : senders.length === 0 ? (
        <EmptyState
          title="No senders configured"
          description="Add a sender domain and import send events, then rebuild its reputation timeline."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Placement score"
              value={typeof latestPlacement === 'number' ? latestPlacement.toFixed(1) : '—'}
              tone={scoreTone(latestPlacement) === 'slate' ? 'default' : (scoreTone(latestPlacement) as 'green' | 'amber' | 'rose')}
              hint={
                typeof placementDelta === 'number'
                  ? `${placementDelta >= 0 ? '▲' : '▼'} ${Math.abs(placementDelta).toFixed(1)} since ${fmtDate(pointAt(first))}`
                  : latest ? `As of ${fmtDate(pointAt(latest))}` : 'Rebuild to begin'
              }
            />
            <Stat
              label="Engagement rate"
              value={typeof asPct(num(latest?.engagement_rate, latest?.engagementRate)) === 'number'
                ? `${asPct(num(latest?.engagement_rate, latest?.engagementRate))!.toFixed(2)}%` : '—'}
              tone="green"
              hint="Opens & clicks of latest bucket"
            />
            <Stat
              label="Complaint rate"
              value={typeof asPct(num(latest?.complaint_rate, latest?.complaintRate)) === 'number'
                ? `${asPct(num(latest?.complaint_rate, latest?.complaintRate))!.toFixed(3)}%` : '—'}
              tone="amber"
              hint="Spam complaints of latest bucket"
            />
            <Stat
              label="Bounce rate"
              value={typeof asPct(num(latest?.bounce_rate, latest?.bounceRate)) === 'number'
                ? `${asPct(num(latest?.bounce_rate, latest?.bounceRate))!.toFixed(3)}%` : '—'}
              tone="rose"
              hint="Hard/soft bounces of latest bucket"
            />
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Reputation timeline</h2>
                <p className="text-xs text-stone-500">
                  {sorted.length} buckets for {senderName(senderById.get(selectedSender))}
                  {sorted.length > 0 && ` · ${fmtDate(pointAt(first))} – ${fmtDate(pointAt(latest))}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMetric(m.key)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      metric === m.key
                        ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                        : 'border-stone-700 bg-stone-900 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardBody>
              <ReputationChart points={sorted} metric={metric} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Annotations</h2>
                <p className="text-xs text-stone-500">Notable events flagged on the timeline.</p>
              </div>
              <Badge tone={annotated.length > 0 ? 'sky' : 'slate'}>{annotated.length} annotated</Badge>
            </CardHeader>
            <CardBody>
              {annotated.length === 0 ? (
                <div className="py-6 text-center text-sm text-stone-500">
                  No annotations on this timeline. Rebuilds flag complaint spikes and bounce surges automatically.
                </div>
              ) : (
                <ul className="space-y-3">
                  {[...annotated].reverse().map((p, i) => (
                    <li key={p.id || `${pointAt(p)}-${i}`} className="flex gap-3 rounded-lg border border-stone-800 bg-stone-900/40 px-4 py-3">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs text-amber-300">!</div>
                      <div className="min-w-0">
                        <div className="text-sm text-stone-200">{p.annotation}</div>
                        <div className="mt-0.5 text-xs text-stone-500">{fmtDateTime(pointAt(p))}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Bucket detail</h2>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {sorted.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    title="No timeline yet"
                    description="Rebuild the reputation timeline for this sender from its send events."
                    action={<Button onClick={rebuild} disabled={rebuilding}>{rebuilding ? 'Rebuilding...' : 'Rebuild now'}</Button>}
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Bucket</TH>
                      <TH className="text-right">Placement</TH>
                      <TH className="text-right">Engagement</TH>
                      <TH className="text-right">Complaint</TH>
                      <TH className="text-right">Bounce</TH>
                      <TH>Annotation</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {[...sorted].reverse().map((p, i) => {
                      const score = asScore(num(p.placement_score, p.placementScore))
                      return (
                        <TR key={p.id || `${pointAt(p)}-${i}`}>
                          <TD>{fmtDateTime(pointAt(p))}</TD>
                          <TD className="text-right">
                            <Badge tone={scoreTone(score) === 'slate' ? 'slate' : scoreTone(score)}>
                              {typeof score === 'number' ? score.toFixed(1) : '—'}
                            </Badge>
                          </TD>
                          <TD className="text-right">{fmtRate(asPct(num(p.engagement_rate, p.engagementRate)), 2)}</TD>
                          <TD className="text-right">{fmtRate(asPct(num(p.complaint_rate, p.complaintRate)), 3)}</TD>
                          <TD className="text-right">{fmtRate(asPct(num(p.bounce_rate, p.bounceRate)), 3)}</TD>
                          <TD>{p.annotation ? <span className="text-amber-300">{p.annotation}</span> : <span className="text-stone-600">—</span>}</TD>
                        </TR>
                      )
                    })}
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

function fmtRate(v: number | undefined, digits: number) {
  return typeof v === 'number' ? `${v.toFixed(digits)}%` : '—'
}

function ReputationChart({ points, metric }: { points: ReputationPoint[]; metric: Metric }) {
  const conf = METRICS.find((m) => m.key === metric)!
  const data = points
    .map((p) => ({ at: pointAt(p), value: metricValue(p, metric), annotation: p.annotation || '' }))
    .filter((d) => typeof d.value === 'number') as { at: string; value: number; annotation: string }[]

  if (data.length === 0) {
    return <div className="py-10 text-center text-sm text-stone-500">No data for this metric. Rebuild the timeline to populate it.</div>
  }

  const W = 760
  const H = 220
  const pad = 32
  const rawMax = Math.max(...data.map((d) => d.value))
  const max = metric === 'placement' ? 100 : Math.max(rawMax * 1.2, 1)
  const min = 0
  const stepX = data.length > 1 ? (W - pad * 2) / (data.length - 1) : 0
  const y = (v: number) => H - pad - ((v - min) / (max - min)) * (H - pad * 2)
  const x = (i: number) => pad + i * stepX
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(' ')
  const area = `${path} L ${x(data.length - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min))
  const gradId = `repFill-${metric}`

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full min-w-[520px]" preserveAspectRatio="none">
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="#1e293b" strokeWidth="1" />
            <text x={4} y={y(g) + 3} fill="#475569" fontSize="9">{metric === 'placement' ? g.toFixed(0) : g.toFixed(2)}</text>
          </g>
        ))}
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={conf.fill} stopOpacity="0.35" />
            <stop offset="100%" stopColor={conf.fill} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path d={path} fill="none" stroke={conf.stroke} strokeWidth="2" />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.value)} r={d.annotation ? 4.5 : 3} fill={d.annotation ? '#fbbf24' : conf.stroke} />
            {d.annotation && <line x1={x(i)} x2={x(i)} y1={y(d.value)} y2={H - pad} stroke="#fbbf24" strokeWidth="1" strokeDasharray="2 3" />}
          </g>
        ))}
        {data.length <= 14 && data.map((d, i) => (
          <text key={`l${i}`} x={x(i)} y={H - pad + 14} fill="#475569" fontSize="8" textAnchor="middle">{fmtDate(d.at)}</text>
        ))}
      </svg>
    </div>
  )
}
