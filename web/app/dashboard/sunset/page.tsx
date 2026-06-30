'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'edrg.activeWorkspaceId'

interface Workspace {
  id: string
  name: string
  currency?: string
}

interface Sender {
  id: string
  domain?: string
  subdomain?: string | null
  friendly_name?: string | null
}

interface Cohort {
  id: string
  sender_id?: string | null
  name: string
  member_count?: number | null
  engagement_rate?: number | null
  revenue_contribution_cents?: number | null
}

interface SunsetPlan {
  id: string
  sender_id?: string | null
  name: string
  cohort_ids?: string[] | null
  schedule?: string
  revenue_retained_cents?: number | null
  revenue_forfeited_cents?: number | null
  complaint_risk_reduction?: number | null
  status?: string
  created_at?: string
}

interface Preview {
  retained?: number
  forfeited?: number
  riskReduction?: number
}

const SCHEDULES = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'gradual_30d', label: 'Gradual over 30 days' },
  { value: 'gradual_60d', label: 'Gradual over 60 days' },
  { value: 'gradual_90d', label: 'Gradual over 90 days' },
]

function senderLabel(s?: Sender): string {
  if (!s) return 'All senders'
  if (s.friendly_name) return s.friendly_name
  if (s.subdomain) return `${s.subdomain}.${s.domain ?? ''}`
  return s.domain ?? s.id
}

function fmtMoney(cents?: number | null, currency = 'USD'): string {
  const v = (cents ?? 0) / 100
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v)
}

function fmtPct(rate?: number | null): string {
  if (rate == null) return '—'
  const pct = rate <= 1 ? rate * 100 : rate
  return `${pct.toFixed(1)}%`
}

export default function SunsetPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [senders, setSenders] = useState<Sender[]>([])
  const [cohorts, setCohorts] = useState<Cohort[]>([])
  const [plans, setPlans] = useState<SunsetPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Planner form state
  const [planName, setPlanName] = useState('')
  const [senderId, setSenderId] = useState<string>('') // '' = all
  const [schedule, setSchedule] = useState<string>('gradual_30d')
  const [selectedCohorts, setSelectedCohorts] = useState<string[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Detail modal
  const [detail, setDetail] = useState<SunsetPlan | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const currency = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.currency ?? 'USD',
    [workspaces, workspaceId],
  )

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        if (!active) return
        setWorkspaces(ws)
        if (ws.length) {
          const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
          const initial = stored && ws.some((w) => w.id === stored) ? stored : ws[0].id
          setWorkspaceId(initial)
        } else {
          setLoading(false)
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load workspaces')
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async (wsId: string) => {
    setLoading(true)
    setError(null)
    try {
      const [snd, ch, pl] = await Promise.all([
        api.listSenders(wsId),
        api.listCohorts(wsId),
        api.listSunsetPlans(wsId),
      ])
      setSenders(snd)
      setCohorts(ch)
      setPlans(pl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sunset data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!workspaceId) return
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, workspaceId)
    load(workspaceId)
  }, [workspaceId, load])

  // Cohorts available for the chosen sender (sender '' shows all)
  const availableCohorts = useMemo(
    () => (senderId ? cohorts.filter((c) => !c.sender_id || c.sender_id === senderId) : cohorts),
    [cohorts, senderId],
  )

  // Drop selections no longer available when sender changes
  useEffect(() => {
    setSelectedCohorts((prev) => prev.filter((id) => availableCohorts.some((c) => c.id === id)))
    setPreview(null)
  }, [availableCohorts])

  const toggleCohort = (id: string) => {
    setPreview(null)
    setSelectedCohorts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const runPreview = async () => {
    if (!workspaceId || selectedCohorts.length === 0) return
    setPreviewing(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { workspaceId, cohortIds: selectedCohorts, schedule }
      if (senderId) body.senderId = senderId
      const p: Preview = await api.previewSunset(body)
      setPreview(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const savePlan = async () => {
    if (!workspaceId || !planName.trim() || selectedCohorts.length === 0) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const body: Record<string, unknown> = {
        workspaceId,
        name: planName.trim(),
        cohortIds: selectedCohorts,
        schedule,
      }
      if (senderId) body.senderId = senderId
      const created: SunsetPlan = await api.createSunsetPlan(body)
      setPlans((prev) => [created, ...prev])
      setNotice(`Saved plan "${created.name}".`)
      setPlanName('')
      setSelectedCohorts([])
      setPreview(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    setDetail(null)
    try {
      const full: SunsetPlan = await api.getSunsetPlan(id)
      setDetail(full)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load plan')
    } finally {
      setDetailLoading(false)
    }
  }

  const deletePlan = async (id: string) => {
    setDeletingId(id)
    setError(null)
    try {
      await api.deleteSunsetPlan(id)
      setPlans((prev) => prev.filter((p) => p.id !== id))
      if (detail?.id === id) setDetail(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  const senderName = (id?: string | null) => (id ? senderLabel(senders.find((s) => s.id === id)) : 'All senders')
  const cohortName = (id: string) => cohorts.find((c) => c.id === id)?.name ?? id

  // Local estimate from selected cohorts to enrich the preview UI
  const selectionTotals = useMemo(() => {
    const sel = availableCohorts.filter((c) => selectedCohorts.includes(c.id))
    return {
      members: sel.reduce((s, c) => s + (c.member_count ?? 0), 0),
      revenue: sel.reduce((s, c) => s + (c.revenue_contribution_cents ?? 0), 0),
    }
  }, [availableCohorts, selectedCohorts])

  // ---- Render ----
  if (loading && !workspaces.length && !error) return <PageLoader label="Loading sunset planner..." />

  if (error && !workspaces.length) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <EmptyState
          title="Couldn't load workspaces"
          description={error}
          action={<Button onClick={() => window.location.reload()}>Retry</Button>}
        />
      </div>
    )
  }

  if (!workspaces.length) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <EmptyState
          title="No workspace yet"
          description="Create a workspace from the dashboard to plan list sunsets."
          action={
            <a href="/dashboard">
              <Button>Go to dashboard</Button>
            </a>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Sunset Planner</h1>
          <p className="mt-1 text-sm text-slate-400">
            Model the revenue you keep vs. forfeit when you sunset disengaged cohorts, then save a plan.
          </p>
        </div>
        {workspaces.length > 1 && (
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading sunset planner..." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Planner */}
          <div className="lg:col-span-3 space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-slate-200">Build a sunset plan</h2>
              </CardHeader>
              <CardBody className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Plan name</span>
                    <input
                      value={planName}
                      onChange={(e) => setPlanName(e.target.value)}
                      placeholder="Q3 disengaged sunset"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Sender scope</span>
                    <select
                      value={senderId}
                      onChange={(e) => setSenderId(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
                    >
                      <option value="">All senders</option>
                      {senders.map((s) => (
                        <option key={s.id} value={s.id}>
                          {senderLabel(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div>
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Rollout schedule</span>
                  <div className="flex flex-wrap gap-2">
                    {SCHEDULES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => {
                          setSchedule(s.value)
                          setPreview(null)
                        }}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                          schedule === s.value
                            ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                            : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Cohorts to sunset ({selectedCohorts.length} selected)
                    </span>
                    {availableCohorts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPreview(null)
                          setSelectedCohorts(
                            selectedCohorts.length === availableCohorts.length ? [] : availableCohorts.map((c) => c.id),
                          )
                        }}
                        className="text-xs text-sky-400 hover:text-sky-300"
                      >
                        {selectedCohorts.length === availableCohorts.length ? 'Clear all' : 'Select all'}
                      </button>
                    )}
                  </div>
                  {availableCohorts.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 py-6 text-center text-sm text-slate-500">
                      No cohorts for this scope.{' '}
                      <a href="/dashboard/cohorts" className="text-sky-400 hover:text-sky-300">
                        Compute cohorts
                      </a>{' '}
                      first.
                    </div>
                  ) : (
                    <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                      {availableCohorts.map((c) => {
                        const checked = selectedCohorts.includes(c.id)
                        return (
                          <label
                            key={c.id}
                            className={`flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm ${
                              checked ? 'bg-sky-500/10' : 'hover:bg-slate-900'
                            }`}
                          >
                            <span className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCohort(c.id)}
                                className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-sky-500"
                              />
                              <span className="font-medium text-slate-200">{c.name}</span>
                              <span className="text-xs text-slate-500">{senderName(c.sender_id)}</span>
                            </span>
                            <span className="flex items-center gap-3 text-xs text-slate-400">
                              <span>{(c.member_count ?? 0).toLocaleString()} members</span>
                              <span className="text-slate-500">·</span>
                              <span>{fmtPct(c.engagement_rate)}</span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="secondary" onClick={runPreview} disabled={previewing || selectedCohorts.length === 0}>
                    {previewing ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" /> Previewing
                      </>
                    ) : (
                      'Preview revenue impact'
                    )}
                  </Button>
                  <Button onClick={savePlan} disabled={saving || !planName.trim() || selectedCohorts.length === 0}>
                    {saving ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" /> Saving
                      </>
                    ) : (
                      'Save plan'
                    )}
                  </Button>
                  {selectedCohorts.length > 0 && (
                    <span className="text-xs text-slate-500">
                      {selectionTotals.members.toLocaleString()} members ·{' '}
                      {fmtMoney(selectionTotals.revenue, currency)} cohort revenue
                    </span>
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Preview result */}
            {preview && (
              <Card>
                <CardHeader>
                  <h2 className="text-sm font-semibold text-slate-200">Revenue impact preview</h2>
                </CardHeader>
                <CardBody className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Stat label="Revenue retained" value={fmtMoney(preview.retained, currency)} tone="green" />
                    <Stat label="Revenue forfeited" value={fmtMoney(preview.forfeited, currency)} tone="rose" />
                    <Stat label="Complaint risk reduction" value={fmtPct(preview.riskReduction)} tone="sky" />
                  </div>
                  {/* Retained vs forfeited bar */}
                  {(() => {
                    const retained = preview.retained ?? 0
                    const forfeited = preview.forfeited ?? 0
                    const total = retained + forfeited || 1
                    const rPct = (retained / total) * 100
                    return (
                      <div>
                        <div className="flex h-4 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full bg-emerald-500" style={{ width: `${rPct}%` }} />
                          <div className="h-full bg-rose-500" style={{ width: `${100 - rPct}%` }} />
                        </div>
                        <div className="mt-2 flex justify-between text-xs text-slate-400">
                          <span className="text-emerald-300">Retained {rPct.toFixed(0)}%</span>
                          <span className="text-rose-300">Forfeited {(100 - rPct).toFixed(0)}%</span>
                        </div>
                      </div>
                    )
                  })()}
                  <p className="text-xs text-slate-500">
                    Based on {selectedCohorts.length} cohort{selectedCohorts.length === 1 ? '' : 's'} with a{' '}
                    {SCHEDULES.find((s) => s.value === schedule)?.label.toLowerCase()} rollout.
                  </p>
                </CardBody>
              </Card>
            )}
          </div>

          {/* Saved plans */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Saved plans</h2>
                <Badge tone="slate">{plans.length}</Badge>
              </CardHeader>
              <CardBody className="p-0">
                {plans.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      title="No saved plans"
                      description="Build and save a sunset plan to track it here."
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-800">
                    {plans.map((p) => (
                      <li key={p.id} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <button
                              onClick={() => openDetail(p.id)}
                              className="text-left text-sm font-medium text-slate-100 hover:text-sky-300"
                            >
                              {p.name}
                            </button>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <Badge tone={p.status === 'active' ? 'green' : 'slate'}>{p.status ?? 'draft'}</Badge>
                              <span>{senderName(p.sender_id)}</span>
                              <span>·</span>
                              <span>{(p.cohort_ids?.length ?? 0)} cohorts</span>
                            </div>
                          </div>
                          <button
                            onClick={() => deletePlan(p.id)}
                            disabled={deletingId === p.id}
                            className="text-xs text-slate-500 hover:text-rose-400 disabled:opacity-50"
                          >
                            {deletingId === p.id ? '...' : 'Delete'}
                          </button>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <div className="text-slate-500">Retained</div>
                            <div className="font-medium text-emerald-300">{fmtMoney(p.revenue_retained_cents, currency)}</div>
                          </div>
                          <div>
                            <div className="text-slate-500">Forfeited</div>
                            <div className="font-medium text-rose-300">{fmtMoney(p.revenue_forfeited_cents, currency)}</div>
                          </div>
                          <div>
                            <div className="text-slate-500">Risk ↓</div>
                            <div className="font-medium text-sky-300">{fmtPct(p.complaint_risk_reduction)}</div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* Detail modal */}
      <Modal open={detail != null || detailLoading} onClose={() => setDetail(null)} title="Sunset plan">
        {detailLoading || !detail ? (
          <div className="py-8">
            <PageLoader label="Loading plan..." />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{detail.name}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <Badge tone={detail.status === 'active' ? 'green' : 'slate'}>{detail.status ?? 'draft'}</Badge>
                <span>{senderName(detail.sender_id)}</span>
                <span>·</span>
                <span>{SCHEDULES.find((s) => s.value === detail.schedule)?.label ?? detail.schedule ?? '—'}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Retained" value={fmtMoney(detail.revenue_retained_cents, currency)} tone="green" />
              <Stat label="Forfeited" value={fmtMoney(detail.revenue_forfeited_cents, currency)} tone="rose" />
              <Stat label="Risk ↓" value={fmtPct(detail.complaint_risk_reduction)} tone="sky" />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Cohorts ({detail.cohort_ids?.length ?? 0})
              </div>
              {detail.cohort_ids && detail.cohort_ids.length > 0 ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Cohort</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {detail.cohort_ids.map((id) => (
                      <TR key={id}>
                        <TD>{cohortName(id)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-slate-500">No cohorts attached.</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="danger" onClick={() => deletePlan(detail.id)} disabled={deletingId === detail.id}>
                {deletingId === detail.id ? 'Deleting...' : 'Delete plan'}
              </Button>
              <Button variant="secondary" onClick={() => setDetail(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
