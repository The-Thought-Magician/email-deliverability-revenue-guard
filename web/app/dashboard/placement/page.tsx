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
type PlacementScore = {
  id: string
  sender_id?: string
  senderId?: string
  period_start?: string
  periodStart?: string
  period_end?: string
  periodEnd?: string
  score?: number
  engagement_component?: number
  engagementComponent?: number
  complaint_component?: number
  complaintComponent?: number
  bounce_component?: number
  bounceComponent?: number
  components?: Record<string, number> | null
  created_at?: string
  createdAt?: string
}
type TrendPoint = { bucket_at?: string; bucketAt?: string; at?: string; score?: number; value?: number }

function senderName(s?: Sender) {
  if (!s) return 'Unknown sender'
  return s.friendly_name || s.friendlyName || s.domain || s.id
}
function num(...vals: (number | undefined)[]) {
  for (const v of vals) if (typeof v === 'number' && !Number.isNaN(v)) return v
  return undefined
}
function pct(v?: number) {
  if (typeof v !== 'number') return '—'
  // score components may be 0..1 or 0..100; normalize heuristically
  const n = v <= 1 ? v * 100 : v
  return `${n.toFixed(1)}`
}
function scoreTone(score?: number): 'green' | 'amber' | 'rose' | 'slate' {
  if (typeof score !== 'number') return 'slate'
  const n = score <= 1 ? score * 100 : score
  if (n >= 80) return 'green'
  if (n >= 60) return 'amber'
  return 'rose'
}
function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function asScore(v?: number) {
  if (typeof v !== 'number') return 0
  return v <= 1 ? v * 100 : v
}

export default function PlacementPage() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [selectedSender, setSelectedSender] = useState<string>('')
  const [scores, setScores] = useState<PlacementScore[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string>('')

  // resolve workspace
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
      const [sendersRes, scoresRes] = await Promise.all([
        api.listSenders(wsId),
        api.listPlacementScores(wsId, senderId || undefined),
      ])
      const sList: Sender[] = sendersRes || []
      setSenders(sList)
      const effectiveSender = senderId || (sList[0]?.id ?? '')
      if (!senderId && effectiveSender) setSelectedSender(effectiveSender)
      setScores(scoresRes || [])
      if (effectiveSender) {
        try {
          const t = await api.getPlacementTrend(wsId, effectiveSender)
          setTrend(t?.points || [])
        } catch {
          setTrend([])
        }
      } else {
        setTrend([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load placement data')
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

  const compute = async () => {
    if (!workspaceId || !selectedSender) return
    setComputing(true)
    setError('')
    try {
      await api.computePlacement({ workspaceId, senderId: selectedSender })
      await load(workspaceId, selectedSender)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compute placement score')
    } finally {
      setComputing(false)
    }
  }

  const visibleScores = useMemo(() => {
    const list = selectedSender ? scores.filter((s) => (s.sender_id || s.senderId) === selectedSender) : scores
    return [...list].sort((a, b) => {
      const ad = new Date(a.period_end || a.periodEnd || a.created_at || a.createdAt || 0).getTime()
      const bd = new Date(b.period_end || b.periodEnd || b.created_at || b.createdAt || 0).getTime()
      return bd - ad
    })
  }, [scores, selectedSender])

  const latest = visibleScores[0]
  const senderById = useMemo(() => new Map(senders.map((s) => [s.id, s])), [senders])

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading placement..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Inbox Placement</h1>
          <p className="mt-1 text-sm text-slate-400">
            Engagement, complaint, and bounce signals rolled into a single placement score per sender.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {workspaces.length > 1 && (
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
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
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none disabled:opacity-50"
          >
            {senders.length === 0 && <option value="">No senders</option>}
            {senders.map((s) => (
              <option key={s.id} value={s.id}>{senderName(s)}</option>
            ))}
          </select>
          <Button onClick={compute} disabled={!selectedSender || computing}>
            {computing ? <><Spinner className="mr-2 h-4 w-4" /> Computing</> : 'Compute score'}
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading placement data..." />
      ) : !workspaceId ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace from the dashboard to start scoring inbox placement."
        />
      ) : senders.length === 0 ? (
        <EmptyState
          title="No senders configured"
          description="Add a sender domain and import send events, then compute a placement score."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Placement score"
              value={latest ? asScore(num(latest.score)).toFixed(1) : '—'}
              tone={scoreTone(latest?.score) === 'slate' ? 'default' : scoreTone(latest?.score) as 'green' | 'amber' | 'rose'}
              hint={latest ? `Period ending ${fmtDate(latest.period_end || latest.periodEnd)}` : 'Compute a score to begin'}
            />
            <Stat
              label="Engagement"
              value={pct(num(latest?.engagement_component, latest?.engagementComponent, latest?.components?.engagement))}
              tone="sky"
              hint="Opens & clicks contribution"
            />
            <Stat
              label="Complaint drag"
              value={pct(num(latest?.complaint_component, latest?.complaintComponent, latest?.components?.complaint))}
              tone="amber"
              hint="Spam-complaint penalty"
            />
            <Stat
              label="Bounce drag"
              value={pct(num(latest?.bounce_component, latest?.bounceComponent, latest?.components?.bounce))}
              tone="rose"
              hint="Hard/soft bounce penalty"
            />
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Score trend</h2>
                <p className="text-xs text-slate-500">Placement score over recent periods for {senderName(senderById.get(selectedSender))}</p>
              </div>
              <Badge tone={scoreTone(latest?.score) === 'slate' ? 'slate' : scoreTone(latest?.score)}>
                {trend.length} points
              </Badge>
            </CardHeader>
            <CardBody>
              <TrendChart points={trend} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Score history</h2>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {visibleScores.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    title="No scores yet"
                    description="Compute a placement score for this sender to populate the history."
                    action={<Button onClick={compute} disabled={computing}>{computing ? 'Computing...' : 'Compute now'}</Button>}
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Period</TH>
                      <TH>Sender</TH>
                      <TH className="text-right">Score</TH>
                      <TH className="text-right">Engagement</TH>
                      <TH className="text-right">Complaint</TH>
                      <TH className="text-right">Bounce</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {visibleScores.map((s) => (
                      <TR key={s.id}>
                        <TD>{fmtDate(s.period_start || s.periodStart)} – {fmtDate(s.period_end || s.periodEnd)}</TD>
                        <TD>{senderName(senderById.get(s.sender_id || s.senderId || ''))}</TD>
                        <TD className="text-right">
                          <Badge tone={scoreTone(s.score) === 'slate' ? 'slate' : scoreTone(s.score)}>
                            {asScore(num(s.score)).toFixed(1)}
                          </Badge>
                        </TD>
                        <TD className="text-right">{pct(num(s.engagement_component, s.engagementComponent, s.components?.engagement))}</TD>
                        <TD className="text-right">{pct(num(s.complaint_component, s.complaintComponent, s.components?.complaint))}</TD>
                        <TD className="text-right">{pct(num(s.bounce_component, s.bounceComponent, s.components?.bounce))}</TD>
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

function TrendChart({ points }: { points: TrendPoint[] }) {
  const data = points
    .map((p) => ({
      at: p.bucket_at || p.bucketAt || p.at || '',
      value: asScore(typeof p.score === 'number' ? p.score : p.value),
    }))
    .filter((d) => typeof d.value === 'number')

  if (data.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-500">No trend data yet. Compute a score to build the timeline.</div>
  }

  const W = 720
  const H = 200
  const pad = 28
  const max = 100
  const min = 0
  const stepX = data.length > 1 ? (W - pad * 2) / (data.length - 1) : 0
  const y = (v: number) => H - pad - ((v - min) / (max - min)) * (H - pad * 2)
  const x = (i: number) => pad + i * stepX
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(' ')
  const area = `${path} L ${x(data.length - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full min-w-[480px]" preserveAspectRatio="none">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="#1e293b" strokeWidth="1" />
            <text x={4} y={y(g) + 3} fill="#475569" fontSize="9">{g}</text>
          </g>
        ))}
        <defs>
          <linearGradient id="placeFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#placeFill)" />
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="2" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r="3" fill="#38bdf8" />
        ))}
      </svg>
    </div>
  )
}
