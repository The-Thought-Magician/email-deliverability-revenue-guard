'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'edrg.workspaceId'

type Workspace = { id: string; name: string }
type Sender = { id: string; domain?: string; friendly_name?: string; friendlyName?: string }
type Action = { title?: string; label?: string; detail?: string; description?: string; impact?: string; priority?: string } | string
type Scorecard = {
  id: string
  sender_id?: string
  senderId?: string
  generated_at?: string
  generatedAt?: string
  grade?: string
  placement_score?: number
  placementScore?: number
  list_health_grade?: string
  listHealthGrade?: string
  complaint_rate?: number
  complaintRate?: number
  revenue_at_risk_cents?: number
  revenueAtRiskCents?: number
  top_actions?: Action[] | null
  topActions?: Action[] | null
  payload?: Record<string, unknown> | null
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
function asScore(v?: number) {
  if (typeof v !== 'number') return undefined
  return v <= 1 ? v * 100 : v
}
function pct(v?: number) {
  if (typeof v !== 'number') return '—'
  const n = v <= 1 ? v * 100 : v
  return `${n.toFixed(2)}%`
}
function money(cents?: number) {
  if (typeof cents !== 'number') return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}
function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function gradeTone(g?: string): 'green' | 'sky' | 'amber' | 'rose' | 'slate' {
  if (!g) return 'slate'
  const c = g.trim().toUpperCase()[0]
  if (c === 'A') return 'green'
  if (c === 'B') return 'sky'
  if (c === 'C') return 'amber'
  if (c === 'D' || c === 'F') return 'rose'
  return 'slate'
}
function actionTitle(a: Action) {
  if (typeof a === 'string') return a
  return a.title || a.label || a.description || 'Action'
}
function actionDetail(a: Action) {
  if (typeof a === 'string') return ''
  return a.detail || a.description || a.impact || ''
}

export default function ScorecardsPage() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [scorecards, setScorecards] = useState<Scorecard[]>([])
  const [selectedSender, setSelectedSender] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string>('')

  const [detail, setDetail] = useState<Scorecard | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportJson, setExportJson] = useState<string>('')
  const [exporting, setExporting] = useState(false)
  const [copied, setCopied] = useState(false)

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
      const [sendersRes, cardsRes] = await Promise.all([
        api.listSenders(wsId),
        api.listScorecards(wsId),
      ])
      const sList: Sender[] = sendersRes || []
      setSenders(sList)
      setScorecards(cardsRes || [])
      setSelectedSender((prev) => prev || (sList[0]?.id ?? ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scorecards')
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

  const generate = async () => {
    if (!workspaceId || !selectedSender) return
    setGenerating(true)
    setError('')
    try {
      await api.generateScorecard({ workspaceId, senderId: selectedSender })
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate scorecard')
    } finally {
      setGenerating(false)
    }
  }

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    setError('')
    try {
      const sc: Scorecard = await api.getScorecard(id)
      setDetail(sc)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scorecard')
    } finally {
      setDetailLoading(false)
    }
  }

  const doExport = async (id: string) => {
    setExporting(true)
    setError('')
    try {
      const res = await api.exportScorecard(id)
      setExportJson(JSON.stringify(res, null, 2))
      setExportOpen(true)
      setCopied(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export scorecard')
    } finally {
      setExporting(false)
    }
  }

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportJson)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const downloadExport = () => {
    const blob = new Blob([exportJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'scorecard.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const senderById = useMemo(() => new Map(senders.map((s) => [s.id, s])), [senders])
  const sorted = useMemo(() => {
    return [...scorecards].sort((a, b) => {
      const ad = new Date(a.generated_at || a.generatedAt || a.created_at || a.createdAt || 0).getTime()
      const bd = new Date(b.generated_at || b.generatedAt || b.created_at || b.createdAt || 0).getTime()
      return bd - ad
    })
  }, [scorecards])
  const latest = sorted[0]

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading scorecards..." />
  }

  const detailActions: Action[] = (detail?.top_actions || detail?.topActions || []) as Action[]

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Deliverability Scorecards</h1>
          <p className="mt-1 text-sm text-slate-400">
            A single board-ready grade per sender combining placement, list health, complaints, and revenue at risk.
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
          <Button onClick={generate} disabled={!selectedSender || generating}>
            {generating ? <><Spinner className="mr-2 h-4 w-4" /> Generating</> : 'Generate scorecard'}
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading scorecards..." />
      ) : !workspaceId ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace from the dashboard to generate scorecards."
        />
      ) : senders.length === 0 ? (
        <EmptyState
          title="No senders configured"
          description="Add a sender and import send events, then generate a scorecard."
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No scorecards yet"
          description="Generate your first scorecard for a sender to grade overall deliverability health."
          action={<Button onClick={generate} disabled={!selectedSender || generating}>{generating ? 'Generating...' : 'Generate first scorecard'}</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Latest grade"
              value={<span className="font-bold">{latest?.grade || '—'}</span>}
              tone={(() => {
                const t = gradeTone(latest?.grade)
                return t === 'slate' || t === 'sky' ? (t === 'sky' ? 'sky' : 'default') : t
              })()}
              hint={latest ? senderName(senderById.get(latest.sender_id || latest.senderId || '')) : undefined}
            />
            <Stat
              label="Placement score"
              value={(() => { const v = asScore(num(latest?.placement_score, latest?.placementScore)); return typeof v === 'number' ? v.toFixed(1) : '—' })()}
              tone="sky"
              hint="0–100 inbox placement"
            />
            <Stat
              label="Complaint rate"
              value={pct(num(latest?.complaint_rate, latest?.complaintRate))}
              tone="amber"
              hint="Spam complaints per send"
            />
            <Stat
              label="Revenue at risk"
              value={money(num(latest?.revenue_at_risk_cents, latest?.revenueAtRiskCents))}
              tone="rose"
              hint="Estimated exposure"
            />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Scorecard history</h2>
              <p className="text-xs text-slate-500">View a full scorecard or export it as a JSON bundle.</p>
            </CardHeader>
            <CardBody className="px-0 py-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Generated</TH>
                    <TH>Sender</TH>
                    <TH className="text-center">Grade</TH>
                    <TH className="text-right">Placement</TH>
                    <TH className="text-center">List health</TH>
                    <TH className="text-right">Complaint</TH>
                    <TH className="text-right">Rev. at risk</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {sorted.map((sc) => (
                    <TR key={sc.id}>
                      <TD className="text-slate-400">{fmtDate(sc.generated_at || sc.generatedAt || sc.created_at || sc.createdAt)}</TD>
                      <TD className="text-slate-200">{senderName(senderById.get(sc.sender_id || sc.senderId || ''))}</TD>
                      <TD className="text-center">
                        <Badge tone={gradeTone(sc.grade)}>{sc.grade || '—'}</Badge>
                      </TD>
                      <TD className="text-right">{(() => { const v = asScore(num(sc.placement_score, sc.placementScore)); return typeof v === 'number' ? v.toFixed(1) : '—' })()}</TD>
                      <TD className="text-center">
                        <Badge tone={gradeTone(sc.list_health_grade || sc.listHealthGrade)}>{sc.list_health_grade || sc.listHealthGrade || '—'}</Badge>
                      </TD>
                      <TD className="text-right">{pct(num(sc.complaint_rate, sc.complaintRate))}</TD>
                      <TD className="text-right">{money(num(sc.revenue_at_risk_cents, sc.revenueAtRiskCents))}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => openDetail(sc.id)}>View</Button>
                          <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => doExport(sc.id)} disabled={exporting}>Export</Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={detail !== null || detailLoading}
        onClose={() => setDetail(null)}
        title="Scorecard detail"
        className="max-w-2xl"
        footer={
          <>
            {detail && (
              <Button variant="secondary" onClick={() => doExport(detail.id)} disabled={exporting}>
                {exporting ? 'Exporting...' : 'Export JSON'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
          </>
        }
      >
        {detailLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <div className={`flex h-16 w-16 items-center justify-center rounded-xl border text-2xl font-bold ${
                gradeTone(detail.grade) === 'green' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : gradeTone(detail.grade) === 'sky' ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                : gradeTone(detail.grade) === 'amber' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : gradeTone(detail.grade) === 'rose' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                : 'border-slate-700 bg-slate-800 text-slate-300'
              }`}>
                {detail.grade || '—'}
              </div>
              <div>
                <div className="text-sm font-medium text-slate-200">{senderName(senderById.get(detail.sender_id || detail.senderId || ''))}</div>
                <div className="text-xs text-slate-500">Generated {fmtDate(detail.generated_at || detail.generatedAt || detail.created_at || detail.createdAt)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Placement" value={(() => { const v = asScore(num(detail.placement_score, detail.placementScore)); return typeof v === 'number' ? v.toFixed(1) : '—' })()} tone="sky" />
              <Stat label="List health" value={detail.list_health_grade || detail.listHealthGrade || '—'} />
              <Stat label="Complaint" value={pct(num(detail.complaint_rate, detail.complaintRate))} tone="amber" />
              <Stat label="Rev. at risk" value={money(num(detail.revenue_at_risk_cents, detail.revenueAtRiskCents))} tone="rose" />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-200">Top actions</h3>
              {detailActions.length === 0 ? (
                <p className="text-sm text-slate-500">No recommended actions in this scorecard.</p>
              ) : (
                <ul className="space-y-2">
                  {detailActions.map((a, i) => (
                    <li key={i} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                      <div className="text-sm font-medium text-slate-200">{actionTitle(a)}</div>
                      {actionDetail(a) && <div className="mt-0.5 text-xs text-slate-500">{actionDetail(a)}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export scorecard"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={copyExport}>{copied ? 'Copied' : 'Copy JSON'}</Button>
            <Button onClick={downloadExport}>Download .json</Button>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>Close</Button>
          </>
        }
      >
        <pre className="max-h-[50vh] overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
          {exportJson || '{}'}
        </pre>
      </Modal>
    </div>
  )
}
