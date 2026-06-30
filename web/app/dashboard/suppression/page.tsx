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
type Recommendation = {
  id: string
  sender_id?: string
  senderId?: string
  target_email?: string
  targetEmail?: string
  reason_code?: string
  reasonCode?: string
  reason?: string
  revenue_impact_cents?: number
  revenueImpactCents?: number
  status?: string
  created_at?: string
  createdAt?: string
}

type StatusFilter = 'all' | 'pending' | 'accepted' | 'dismissed'

function email(r: Recommendation) {
  return r.target_email || r.targetEmail || '—'
}
function reasonCode(r: Recommendation) {
  return r.reason_code || r.reasonCode || ''
}
function revenueCents(r: Recommendation) {
  const v = r.revenue_impact_cents ?? r.revenueImpactCents
  return typeof v === 'number' ? v : 0
}
function money(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100)
}
function statusTone(s?: string): 'sky' | 'green' | 'rose' | 'slate' {
  switch ((s || '').toLowerCase()) {
    case 'accepted': return 'green'
    case 'dismissed': return 'rose'
    case 'pending': return 'sky'
    default: return 'slate'
  }
}
function reasonTone(code: string): 'rose' | 'amber' | 'slate' {
  const c = code.toLowerCase()
  if (c.includes('complaint') || c.includes('hard')) return 'rose'
  if (c.includes('dormant') || c.includes('soft') || c.includes('inactive')) return 'amber'
  return 'slate'
}
function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SuppressionPage() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [computing, setComputing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [actingId, setActingId] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [notice, setNotice] = useState<string>('')

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
      const list: Recommendation[] = (await api.listSuppression(wsId)) || []
      setRecs(list)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recommendations')
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
    if (!workspaceId) return
    setComputing(true)
    setError('')
    setNotice('')
    try {
      await api.computeSuppression({ workspaceId })
      await load(workspaceId)
      setNotice('Recommendations regenerated.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to regenerate recommendations')
    } finally {
      setComputing(false)
    }
  }

  const setStatus = async (id: string, status: 'accepted' | 'dismissed' | 'pending') => {
    setActingId(id)
    setError('')
    try {
      const updated: Recommendation = await api.updateSuppression(id, { status })
      setRecs((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated, status: updated?.status ?? status } : r)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update recommendation')
    } finally {
      setActingId('')
    }
  }

  const bulkSet = async (status: 'accepted' | 'dismissed') => {
    if (selected.size === 0) return
    setError('')
    const ids = Array.from(selected)
    try {
      await Promise.all(ids.map((id) => api.updateSuppression(id, { status })))
      setRecs((prev) => prev.map((r) => (selected.has(r.id) ? { ...r, status } : r)))
      setSelected(new Set())
      setNotice(`${ids.length} recommendation${ids.length === 1 ? '' : 's'} ${status}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk update failed')
    }
  }

  const exportList = async () => {
    if (!workspaceId) return
    setExporting(true)
    setError('')
    setNotice('')
    try {
      const res = await api.exportSuppression(workspaceId)
      const emails: string[] = res?.emails || []
      if (emails.length === 0) {
        setNotice('No accepted suppressions to export yet.')
        return
      }
      const blob = new Blob([emails.join('\n')], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `suppression-list-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setNotice(`Exported ${emails.length} suppressed address${emails.length === 1 ? '' : 'es'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return recs.filter((r) => {
      const st = (r.status || 'pending').toLowerCase()
      if (filter !== 'all' && st !== filter) return false
      if (term) {
        const hay = `${email(r)} ${reasonCode(r)} ${r.reason || ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [recs, filter, search])

  const counts = useMemo(() => {
    const c = { all: recs.length, pending: 0, accepted: 0, dismissed: 0 }
    for (const r of recs) {
      const st = (r.status || 'pending').toLowerCase()
      if (st === 'accepted') c.accepted++
      else if (st === 'dismissed') c.dismissed++
      else c.pending++
    }
    return c
  }, [recs])

  const acceptedRevenue = useMemo(
    () => recs.filter((r) => (r.status || '').toLowerCase() === 'accepted').reduce((a, r) => a + revenueCents(r), 0),
    [recs],
  )
  const pendingRevenue = useMemo(
    () => recs.filter((r) => (r.status || 'pending').toLowerCase() === 'pending').reduce((a, r) => a + revenueCents(r), 0),
    [recs],
  )

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) filtered.forEach((r) => next.delete(r.id))
      else filtered.forEach((r) => next.add(r.id))
      return next
    })
  }
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading suppression..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Suppression Recommendations</h1>
          <p className="mt-1 text-sm text-slate-400">
            Risky addresses flagged for suppression, with the revenue trade-off of keeping them on the list.
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
          <Button variant="secondary" onClick={exportList} disabled={!workspaceId || exporting}>
            {exporting ? <><Spinner className="mr-2 h-4 w-4" /> Exporting</> : 'Export accepted'}
          </Button>
          <Button onClick={compute} disabled={!workspaceId || computing}>
            {computing ? <><Spinner className="mr-2 h-4 w-4" /> Recomputing</> : 'Regenerate'}
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">{notice}</div>
      )}

      {loading ? (
        <PageLoader label="Loading recommendations..." />
      ) : !workspaceId ? (
        <EmptyState title="No workspace yet" description="Create a workspace from the dashboard to generate suppression recommendations." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total flagged" value={counts.all.toLocaleString()} hint="All recommendations" />
            <Stat label="Pending review" value={counts.pending.toLocaleString()} tone="sky" hint="Awaiting decision" />
            <Stat label="Accepted" value={counts.accepted.toLocaleString()} tone="green" hint={`${money(acceptedRevenue)} forgone revenue`} />
            <Stat label="Revenue at stake" value={money(pendingRevenue)} tone="amber" hint="If pending kept on list" />
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'pending', 'accepted', 'dismissed'] as StatusFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                      filter === f ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {f} <span className="opacity-70">({counts[f]})</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {selected.size > 0 && (
                  <>
                    <span className="text-xs text-slate-400">{selected.size} selected</span>
                    <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => bulkSet('accepted')}>Accept</Button>
                    <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => bulkSet('dismissed')}>Dismiss</Button>
                  </>
                )}
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search email or reason"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {filtered.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    title={recs.length === 0 ? 'No recommendations yet' : 'Nothing matches'}
                    description={
                      recs.length === 0
                        ? 'Regenerate to scan recipients for complaints, hard bounces, and dormant addresses.'
                        : 'Adjust the filter or search to see recommendations.'
                    }
                    action={
                      recs.length === 0
                        ? <Button onClick={compute} disabled={computing}>{computing ? 'Recomputing...' : 'Regenerate'}</Button>
                        : undefined
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-10">
                        <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="accent-sky-500" aria-label="Select all" />
                      </TH>
                      <TH>Email</TH>
                      <TH>Reason</TH>
                      <TH className="text-right">Revenue impact</TH>
                      <TH>Status</TH>
                      <TH>Flagged</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => {
                      const st = (r.status || 'pending').toLowerCase()
                      const busy = actingId === r.id
                      return (
                        <TR key={r.id}>
                          <TD>
                            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} className="accent-sky-500" aria-label={`Select ${email(r)}`} />
                          </TD>
                          <TD className="font-mono text-xs text-slate-200">{email(r)}</TD>
                          <TD>
                            <div className="flex flex-col gap-1">
                              {reasonCode(r) && <Badge tone={reasonTone(reasonCode(r))}>{reasonCode(r)}</Badge>}
                              {r.reason && <span className="text-xs text-slate-500">{r.reason}</span>}
                            </div>
                          </TD>
                          <TD className="text-right text-slate-200">{money(revenueCents(r))}</TD>
                          <TD><Badge tone={statusTone(st)}>{st}</Badge></TD>
                          <TD className="text-slate-500">{fmtDate(r.created_at || r.createdAt)}</TD>
                          <TD>
                            <div className="flex justify-end gap-2">
                              {st !== 'accepted' && (
                                <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => setStatus(r.id, 'accepted')}>
                                  {busy ? '...' : 'Accept'}
                                </Button>
                              )}
                              {st !== 'dismissed' && (
                                <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => setStatus(r.id, 'dismissed')}>
                                  {busy ? '...' : 'Dismiss'}
                                </Button>
                              )}
                              {st !== 'pending' && (
                                <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => setStatus(r.id, 'pending')}>
                                  Reset
                                </Button>
                              )}
                            </div>
                          </TD>
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
