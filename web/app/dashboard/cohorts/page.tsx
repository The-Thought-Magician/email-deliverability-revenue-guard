'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
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
  status?: string
}

interface Cohort {
  id: string
  sender_id?: string | null
  name: string
  recency_days?: number | null
  min_frequency?: number | null
  member_count?: number | null
  engagement_rate?: number | null
  revenue_contribution_cents?: number | null
  created_at?: string
}

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
  // rate may be 0..1 or already a percent; normalize defensively
  const pct = rate <= 1 ? rate * 100 : rate
  return `${pct.toFixed(1)}%`
}

export default function CohortsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [senders, setSenders] = useState<Sender[]>([])
  const [senderId, setSenderId] = useState<string>('') // '' = all senders
  const [cohorts, setCohorts] = useState<Cohort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'member_count' | 'engagement_rate' | 'revenue_contribution_cents'>('revenue_contribution_cents')

  const currency = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.currency ?? 'USD',
    [workspaces, workspaceId],
  )

  // Bootstrap workspaces
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

  const load = useCallback(async (wsId: string, sId: string) => {
    setLoading(true)
    setError(null)
    try {
      const [snd, ch] = await Promise.all([
        api.listSenders(wsId),
        api.listCohorts(wsId, sId || undefined),
      ])
      setSenders(snd)
      setCohorts(ch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cohorts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!workspaceId) return
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, workspaceId)
    load(workspaceId, senderId)
  }, [workspaceId, senderId, load])

  const recompute = async () => {
    if (!workspaceId) return
    setRecomputing(true)
    setError(null)
    setNotice(null)
    try {
      const body: Record<string, unknown> = { workspaceId }
      if (senderId) body.senderId = senderId
      const fresh: Cohort[] = await api.computeCohorts(body)
      setCohorts(fresh)
      setNotice(`Recomputed ${fresh.length} cohort${fresh.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recompute failed')
    } finally {
      setRecomputing(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = q ? cohorts.filter((c) => c.name.toLowerCase().includes(q)) : cohorts.slice()
    rows.sort((a, b) => (Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0)))
    return rows
  }, [cohorts, search, sortKey])

  const totals = useMemo(() => {
    const members = cohorts.reduce((s, c) => s + (c.member_count ?? 0), 0)
    const revenue = cohorts.reduce((s, c) => s + (c.revenue_contribution_cents ?? 0), 0)
    const engaged = cohorts.length
      ? cohorts.reduce((s, c) => s + ((c.engagement_rate ?? 0) <= 1 ? (c.engagement_rate ?? 0) * 100 : (c.engagement_rate ?? 0)), 0) /
        cohorts.length
      : 0
    return { members, revenue, engaged }
  }, [cohorts])

  const maxRevenue = useMemo(
    () => Math.max(1, ...cohorts.map((c) => c.revenue_contribution_cents ?? 0)),
    [cohorts],
  )

  const senderName = (id?: string | null) => {
    if (!id) return 'All senders'
    return senderLabel(senders.find((s) => s.id === id))
  }

  // ---- Render ----
  if (loading && !workspaces.length && !error) return <PageLoader label="Loading cohorts..." />

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
          description="Create a workspace from the dashboard to start segmenting engagement cohorts."
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
          <h1 className="text-2xl font-semibold text-white">Engagement Cohorts</h1>
          <p className="mt-1 text-sm text-slate-400">
            Recency &amp; frequency segments scored by engagement and revenue contribution.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <select
            value={senderId}
            onChange={(e) => setSenderId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
          >
            <option value="">All senders</option>
            {senders.map((s) => (
              <option key={s.id} value={s.id}>
                {senderLabel(s)}
              </option>
            ))}
          </select>
          <Button onClick={recompute} disabled={recomputing}>
            {recomputing ? (
              <>
                <Spinner className="mr-2 h-4 w-4" /> Recomputing
              </>
            ) : (
              'Recompute cohorts'
            )}
          </Button>
        </div>
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

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cohorts" value={cohorts.length} />
        <Stat label="Total members" value={totals.members.toLocaleString()} tone="sky" />
        <Stat label="Avg engagement" value={`${totals.engaged.toFixed(1)}%`} tone="green" />
        <Stat label="Revenue contribution" value={fmtMoney(totals.revenue, currency)} tone="green" />
      </div>

      {/* Controls */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-200">Cohorts</h2>
            <Badge tone="slate">{senderName(senderId)}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cohorts..."
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
            >
              <option value="revenue_contribution_cents">Sort: Revenue</option>
              <option value="member_count">Sort: Members</option>
              <option value="engagement_rate">Sort: Engagement</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-12">
              <PageLoader label="Loading cohorts..." />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={cohorts.length === 0 ? 'No cohorts yet' : 'No cohorts match your search'}
                description={
                  cohorts.length === 0
                    ? 'Recompute to build standard recency/frequency cohorts from your send history.'
                    : 'Try a different search term.'
                }
                action={
                  cohorts.length === 0 ? (
                    <Button onClick={recompute} disabled={recomputing}>
                      {recomputing ? 'Recomputing...' : 'Recompute cohorts'}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Cohort</TH>
                  <TH>Sender</TH>
                  <TH className="text-right">Recency</TH>
                  <TH className="text-right">Min freq</TH>
                  <TH className="text-right">Members</TH>
                  <TH className="text-right">Engagement</TH>
                  <TH>Revenue contribution</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => {
                  const rev = c.revenue_contribution_cents ?? 0
                  const eng = (c.engagement_rate ?? 0) <= 1 ? (c.engagement_rate ?? 0) * 100 : c.engagement_rate ?? 0
                  return (
                    <TR key={c.id}>
                      <TD className="font-medium text-slate-100">{c.name}</TD>
                      <TD>
                        <span className="text-slate-400">{senderName(c.sender_id)}</span>
                      </TD>
                      <TD className="text-right">
                        {c.recency_days != null ? `${c.recency_days}d` : '—'}
                      </TD>
                      <TD className="text-right">{c.min_frequency ?? '—'}</TD>
                      <TD className="text-right font-medium text-slate-100">
                        {(c.member_count ?? 0).toLocaleString()}
                      </TD>
                      <TD className="text-right">
                        <span className={eng >= 30 ? 'text-emerald-300' : eng >= 10 ? 'text-amber-300' : 'text-rose-300'}>
                          {fmtPct(c.engagement_rate)}
                        </span>
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-sky-500"
                              style={{ width: `${Math.min(100, (rev / maxRevenue) * 100)}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-slate-200">{fmtMoney(rev, currency)}</span>
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
    </div>
  )
}
