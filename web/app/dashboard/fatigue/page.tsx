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
type Sender = { id: string; domain?: string; friendly_name?: string; friendlyName?: string }
type Segment = { id: string; name?: string }
type CurvePoint = {
  frequency?: number
  freq?: number
  sends_per_week?: number
  sendsPerWeek?: number
  engagement?: number
  engagement_rate?: number
  engagementRate?: number
  complaint?: number
  complaint_rate?: number
  complaintRate?: number
}
type Fatigue = {
  id: string
  name?: string
  sender_id?: string
  senderId?: string
  segment_id?: string | null
  segmentId?: string | null
  curve?: CurvePoint[] | null
  recommended_cadence_per_week?: number
  recommendedCadencePerWeek?: number
  projected_complaint_reduction?: number
  projectedComplaintReduction?: number
  is_overmailing?: boolean
  isOvermailing?: boolean
  created_at?: string
  createdAt?: string
}

function senderName(s?: Sender) {
  if (!s) return 'Unknown sender'
  return s.friendly_name || s.friendlyName || s.domain || s.id
}
function num(...vals: (number | undefined | null)[]) {
  for (const v of vals) if (typeof v === 'number' && !Number.isNaN(v)) return v
  return undefined
}
function asRate(v?: number) {
  if (typeof v !== 'number') return undefined
  return v <= 1 ? v * 100 : v
}
function pct(v?: number) {
  const n = asRate(v)
  return typeof n === 'number' ? `${n.toFixed(1)}%` : '—'
}
function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function cadence(v?: number) {
  return typeof v === 'number' ? `${v.toFixed(1)}/wk` : '—'
}

export default function FatiguePage() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [analyses, setAnalyses] = useState<Fatigue[]>([])
  const [selectedSender, setSelectedSender] = useState<string>('')
  const [selectedSegment, setSelectedSegment] = useState<string>('')
  const [selectedId, setSelectedId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [computing, setComputing] = useState(false)
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

  const load = useCallback(async (wsId: string) => {
    setLoading(true)
    setError('')
    try {
      const [sendersRes, segmentsRes, fatigueRes] = await Promise.all([
        api.listSenders(wsId),
        api.listSegments(wsId),
        api.listFatigue(wsId),
      ])
      const sList: Sender[] = sendersRes || []
      setSenders(sList)
      setSegments(segmentsRes || [])
      const aList: Fatigue[] = fatigueRes || []
      setAnalyses(aList)
      setSelectedSender((prev) => prev || (sList[0]?.id ?? ''))
      setSelectedId((prev) => (prev && aList.some((a) => a.id === prev) ? prev : aList[0]?.id ?? ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fatigue analyses')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) {
      if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, workspaceId)
      load(workspaceId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const compute = async () => {
    if (!workspaceId || !selectedSender) return
    setComputing(true)
    setError('')
    try {
      const res: Fatigue = await api.computeFatigue({
        workspaceId,
        senderId: selectedSender,
        segmentId: selectedSegment || undefined,
      })
      await load(workspaceId)
      if (res?.id) setSelectedId(res.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compute fatigue curve')
    } finally {
      setComputing(false)
    }
  }

  const senderById = useMemo(() => new Map(senders.map((s) => [s.id, s])), [senders])
  const segmentById = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments])

  const sortedAnalyses = useMemo(() => {
    return [...analyses].sort((a, b) => {
      const ad = new Date(a.created_at || a.createdAt || 0).getTime()
      const bd = new Date(b.created_at || b.createdAt || 0).getTime()
      return bd - ad
    })
  }, [analyses])

  const selected = useMemo(
    () => sortedAnalyses.find((a) => a.id === selectedId) || sortedAnalyses[0],
    [sortedAnalyses, selectedId],
  )

  const overmailing = (a?: Fatigue) => Boolean(a?.is_overmailing ?? a?.isOvermailing)

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading fatigue..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Send Fatigue</h1>
          <p className="mt-1 text-sm text-slate-400">
            Frequency vs engagement curves and the cadence that maximizes engagement while cutting complaint risk.
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
            onChange={(e) => setSelectedSender(e.target.value)}
            disabled={senders.length === 0}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none disabled:opacity-50"
          >
            {senders.length === 0 && <option value="">No senders</option>}
            {senders.map((s) => (
              <option key={s.id} value={s.id}>{senderName(s)}</option>
            ))}
          </select>
          <select
            value={selectedSegment}
            onChange={(e) => setSelectedSegment(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value="">All recipients</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>{s.name || s.id}</option>
            ))}
          </select>
          <Button onClick={compute} disabled={!selectedSender || computing}>
            {computing ? <><Spinner className="mr-2 h-4 w-4" /> Computing</> : 'Compute curve'}
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading fatigue analyses..." />
      ) : !workspaceId ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace from the dashboard to start modeling send fatigue."
        />
      ) : senders.length === 0 ? (
        <EmptyState
          title="No senders configured"
          description="Add a sender and import send events, then compute a fatigue curve."
        />
      ) : sortedAnalyses.length === 0 ? (
        <EmptyState
          title="No fatigue curves yet"
          description="Pick a sender (and optional segment) and compute a frequency/engagement curve."
          action={<Button onClick={compute} disabled={!selectedSender || computing}>{computing ? 'Computing...' : 'Compute first curve'}</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Recommended cadence"
              value={cadence(num(selected?.recommended_cadence_per_week, selected?.recommendedCadencePerWeek))}
              tone="sky"
              hint="Sends per week per recipient"
            />
            <Stat
              label="Projected complaint reduction"
              value={pct(num(selected?.projected_complaint_reduction, selected?.projectedComplaintReduction))}
              tone="green"
              hint="If you adopt the recommended cadence"
            />
            <Stat
              label="Status"
              value={overmailing(selected) ? 'Over-mailing' : 'Healthy'}
              tone={overmailing(selected) ? 'rose' : 'green'}
              hint={overmailing(selected) ? 'Current frequency past the engagement peak' : 'Frequency within the engaged range'}
            />
            <Stat
              label="Curve points"
              value={(selected?.curve?.length ?? 0).toString()}
              hint="Frequency buckets analyzed"
            />
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Frequency / engagement curve</h2>
                <p className="text-xs text-slate-500">
                  {selected?.name || 'Curve'} · {senderName(senderById.get(selected?.sender_id || selected?.senderId || ''))}
                  {(selected?.segment_id || selected?.segmentId)
                    ? ` · ${segmentById.get((selected?.segment_id || selected?.segmentId) as string)?.name || 'Segment'}`
                    : ' · All recipients'}
                </p>
              </div>
              <Badge tone={overmailing(selected) ? 'rose' : 'green'}>
                {overmailing(selected) ? 'Over-mailing detected' : 'Within healthy range'}
              </Badge>
            </CardHeader>
            <CardBody>
              <FatigueChart
                curve={selected?.curve || []}
                recommended={num(selected?.recommended_cadence_per_week, selected?.recommendedCadencePerWeek)}
              />
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm bg-sky-400" /> Engagement rate</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm bg-rose-400" /> Complaint rate</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-emerald-400" /> Recommended cadence</span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Saved analyses</h2>
              <p className="text-xs text-slate-500">Select a row to inspect its curve above.</p>
            </CardHeader>
            <CardBody className="px-0 py-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Analysis</TH>
                    <TH>Sender</TH>
                    <TH>Segment</TH>
                    <TH className="text-right">Recommended</TH>
                    <TH className="text-right">Complaint ↓</TH>
                    <TH>Status</TH>
                    <TH>Computed</TH>
                  </TR>
                </THead>
                <TBody>
                  {sortedAnalyses.map((a) => {
                    const isSel = a.id === (selected?.id ?? '')
                    return (
                      <TR
                        key={a.id}
                        onClick={() => setSelectedId(a.id)}
                        className={`cursor-pointer ${isSel ? 'bg-sky-500/10' : ''}`}
                      >
                        <TD className="font-medium text-slate-200">{a.name || 'Curve'}</TD>
                        <TD>{senderName(senderById.get(a.sender_id || a.senderId || ''))}</TD>
                        <TD>{(a.segment_id || a.segmentId) ? (segmentById.get((a.segment_id || a.segmentId) as string)?.name || 'Segment') : 'All recipients'}</TD>
                        <TD className="text-right">{cadence(num(a.recommended_cadence_per_week, a.recommendedCadencePerWeek))}</TD>
                        <TD className="text-right">{pct(num(a.projected_complaint_reduction, a.projectedComplaintReduction))}</TD>
                        <TD>
                          <Badge tone={overmailing(a) ? 'rose' : 'green'}>
                            {overmailing(a) ? 'Over-mailing' : 'Healthy'}
                          </Badge>
                        </TD>
                        <TD className="text-slate-500">{fmtDate(a.created_at || a.createdAt)}</TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

function FatigueChart({ curve, recommended }: { curve: CurvePoint[]; recommended?: number }) {
  const data = (curve || [])
    .map((p) => ({
      freq: num(p.frequency, p.freq, p.sends_per_week, p.sendsPerWeek),
      engagement: asRate(num(p.engagement, p.engagement_rate, p.engagementRate)),
      complaint: asRate(num(p.complaint, p.complaint_rate, p.complaintRate)),
    }))
    .filter((d) => typeof d.freq === 'number')
    .sort((a, b) => (a.freq as number) - (b.freq as number))

  if (data.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-500">No curve data. Compute a fatigue curve to plot frequency against engagement.</div>
  }

  const W = 720
  const H = 220
  const pad = 32
  const freqs = data.map((d) => d.freq as number)
  const minF = Math.min(...freqs)
  const maxF = Math.max(...freqs)
  const engVals = data.map((d) => d.engagement ?? 0)
  const maxEng = Math.max(10, ...engVals)
  const cmpVals = data.map((d) => d.complaint ?? 0)
  const maxCmp = Math.max(0.5, ...cmpVals)

  const x = (f: number) => (maxF === minF ? W / 2 : pad + ((f - minF) / (maxF - minF)) * (W - pad * 2))
  const yEng = (v: number) => H - pad - (v / maxEng) * (H - pad * 2)
  const yCmp = (v: number) => H - pad - (v / maxCmp) * (H - pad * 2)

  const engPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(d.freq as number).toFixed(1)} ${yEng(d.engagement ?? 0).toFixed(1)}`).join(' ')
  const cmpPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(d.freq as number).toFixed(1)} ${yCmp(d.complaint ?? 0).toFixed(1)}`).join(' ')
  const engArea = `${engPath} L ${x(data[data.length - 1].freq as number).toFixed(1)} ${H - pad} L ${x(data[0].freq as number).toFixed(1)} ${H - pad} Z`

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full min-w-[480px]" preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={pad} x2={W - pad} y1={H - pad - g * (H - pad * 2)} y2={H - pad - g * (H - pad * 2)} stroke="#1e293b" strokeWidth="1" />
        ))}
        <defs>
          <linearGradient id="engFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={engArea} fill="url(#engFill)" />
        <path d={engPath} fill="none" stroke="#38bdf8" strokeWidth="2" />
        <path d={cmpPath} fill="none" stroke="#fb7185" strokeWidth="2" strokeDasharray="4 3" />
        {typeof recommended === 'number' && recommended >= minF && recommended <= maxF && (
          <g>
            <line x1={x(recommended)} x2={x(recommended)} y1={pad} y2={H - pad} stroke="#34d399" strokeWidth="1.5" strokeDasharray="3 3" />
            <text x={x(recommended) + 4} y={pad + 10} fill="#34d399" fontSize="10">{recommended.toFixed(1)}/wk</text>
          </g>
        )}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(d.freq as number)} cy={yEng(d.engagement ?? 0)} r="3" fill="#38bdf8" />
            <text x={x(d.freq as number)} y={H - pad + 14} fill="#475569" fontSize="9" textAnchor="middle">{(d.freq as number).toFixed(0)}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
