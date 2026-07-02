'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageLoader } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Sender {
  id: string
  domain: string | null
  friendly_name: string | null
}

interface Workspace {
  id: string
  name: string
}

// Campaign rollups arrive with totals; rates may be precomputed or derivable.
interface CampaignRollup {
  id: string
  name: string | null
  subject: string | null
  sender_id: string | null
  segment_id: string | null
  sent_at: string | null
  sends?: number | null
  opens?: number | null
  clicks?: number | null
  bounces?: number | null
  complaints?: number | null
  unsubscribes?: number | null
  open_rate?: number | null
  click_rate?: number | null
  bounce_rate?: number | null
  complaint_rate?: number | null
  revenue_cents?: number | null
}

const WS_KEY = 'activeWorkspaceId'

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function rate(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function complaintTone(r: number): 'green' | 'amber' | 'rose' {
  if (r >= 0.003) return 'rose'
  if (r >= 0.001) return 'amber'
  return 'green'
}

type SortKey = 'sent_at' | 'sends' | 'open_rate' | 'click_rate' | 'bounce_rate' | 'complaint_rate' | 'revenue'

export default function CampaignsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [senders, setSenders] = useState<Sender[]>([])
  const [campaigns, setCampaigns] = useState<CampaignRollup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [senderFilter, setSenderFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('sent_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        let wsId = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        if (!wsId) {
          const list: Workspace[] = await api.listWorkspaces()
          if (Array.isArray(list) && list.length > 0) {
            wsId = list[0].id
            window.localStorage.setItem(WS_KEY, wsId)
          }
        }
        if (!active) return
        setWorkspaceId(wsId ?? '')
        if (!wsId) {
          setLoading(false)
          return
        }
        const [s, c]: [Sender[], CampaignRollup[]] = await Promise.all([api.listSenders(wsId), api.listCampaigns(wsId)])
        if (!active) return
        setSenders(Array.isArray(s) ? s : [])
        setCampaigns(Array.isArray(c) ? c : [])
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load campaigns')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Reload campaigns when sender filter changes (server-side filter when possible).
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    ;(async () => {
      try {
        const c: CampaignRollup[] = await api.listCampaigns(workspaceId, senderFilter === 'all' ? undefined : senderFilter)
        if (active) setCampaigns(Array.isArray(c) ? c : [])
      } catch {
        /* keep existing list on transient filter error */
      }
    })()
    return () => {
      active = false
    }
  }, [senderFilter, workspaceId])

  const senderName = (id: string | null): string => {
    if (!id) return '—'
    const s = senders.find((x) => x.id === id)
    return s?.friendly_name || s?.domain || id.slice(0, 8)
  }

  const derived = useMemo(() => {
    return campaigns.map((c) => {
      const sends = num(c.sends)
      const opens = num(c.opens)
      const clicks = num(c.clicks)
      const bounces = num(c.bounces)
      const complaints = num(c.complaints)
      return {
        ...c,
        _sends: sends,
        _opens: opens,
        _clicks: clicks,
        _bounces: bounces,
        _complaints: complaints,
        _openRate: typeof c.open_rate === 'number' ? c.open_rate : rate(opens, sends),
        _clickRate: typeof c.click_rate === 'number' ? c.click_rate : rate(clicks, sends),
        _bounceRate: typeof c.bounce_rate === 'number' ? c.bounce_rate : rate(bounces, sends),
        _complaintRate: typeof c.complaint_rate === 'number' ? c.complaint_rate : rate(complaints, sends),
        _revenue: num(c.revenue_cents),
      }
    })
  }, [campaigns])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = derived.filter((c) => {
      if (!q) return true
      return (c.name ?? '').toLowerCase().includes(q) || (c.subject ?? '').toLowerCase().includes(q)
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      let av: number, bv: number
      switch (sortKey) {
        case 'sends':
          av = a._sends
          bv = b._sends
          break
        case 'open_rate':
          av = a._openRate
          bv = b._openRate
          break
        case 'click_rate':
          av = a._clickRate
          bv = b._clickRate
          break
        case 'bounce_rate':
          av = a._bounceRate
          bv = b._bounceRate
          break
        case 'complaint_rate':
          av = a._complaintRate
          bv = b._complaintRate
          break
        case 'revenue':
          av = a._revenue
          bv = b._revenue
          break
        case 'sent_at':
        default:
          av = a.sent_at ? new Date(a.sent_at).getTime() : 0
          bv = b.sent_at ? new Date(b.sent_at).getTime() : 0
          break
      }
      return (av - bv) * dir
    })
  }, [derived, search, sortKey, sortDir])

  const totals = useMemo(() => {
    const t = derived.reduce(
      (acc, c) => {
        acc.campaigns += 1
        acc.sends += c._sends
        acc.opens += c._opens
        acc.clicks += c._clicks
        acc.complaints += c._complaints
        acc.revenue += c._revenue
        return acc
      },
      { campaigns: 0, sends: 0, opens: 0, clicks: 0, complaints: 0, revenue: 0 }
    )
    return {
      ...t,
      openRate: rate(t.opens, t.sends),
      complaintRate: rate(t.complaints, t.sends),
    }
  }, [derived])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortIcon = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')

  if (loading) return <PageLoader label="Loading campaigns..." />

  if (workspaceId === '') {
    return (
      <EmptyState
        title="No workspace selected"
        description="Create a workspace from the dashboard to view campaign rollups."
        action={
          <Link href="/dashboard">
            <span className="text-sm text-rose-400 hover:text-rose-300">Go to dashboard →</span>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">Campaigns</h1>
        <p className="mt-1 text-sm text-stone-500">
          Per-campaign engagement and deliverability rollups across all sends in this workspace.
        </p>
      </div>

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Campaigns" value={totals.campaigns} />
        <Stat label="Total sends" value={totals.sends.toLocaleString()} tone="sky" />
        <Stat label="Avg open rate" value={pct(totals.openRate)} tone="green" />
        <Stat
          label="Avg complaint rate"
          value={pct(totals.complaintRate)}
          tone={complaintTone(totals.complaintRate) === 'green' ? 'green' : complaintTone(totals.complaintRate)}
        />
        <Stat label="Attributed revenue" value={`$${(totals.revenue / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-stone-200">Rollup</span>
            <Badge tone="slate">{filtered.length}</Badge>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or subject..."
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-rose-500 focus:outline-none sm:w-56"
            />
            <select
              value={senderFilter}
              onChange={(e) => setSenderFilter(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
            >
              <option value="all">All senders</option>
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.friendly_name || s.domain || s.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={campaigns.length === 0 ? 'No campaigns yet' : 'No campaigns match your filters'}
                description={
                  campaigns.length === 0
                    ? 'Import send events or seed sample data to populate campaign rollups.'
                    : 'Try a different search or sender filter.'
                }
                action={
                  campaigns.length === 0 ? (
                    <Link href="/dashboard/imports">
                      <span className="text-sm text-rose-400 hover:text-rose-300">Go to imports →</span>
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH>Sender</TH>
                  <TH className="cursor-pointer select-none text-right" >
                    <button onClick={() => toggleSort('sent_at')}>Sent{sortIcon('sent_at')}</button>
                  </TH>
                  <TH className="text-right">
                    <button onClick={() => toggleSort('sends')}>Sends{sortIcon('sends')}</button>
                  </TH>
                  <TH className="text-right">
                    <button onClick={() => toggleSort('open_rate')}>Open{sortIcon('open_rate')}</button>
                  </TH>
                  <TH className="text-right">
                    <button onClick={() => toggleSort('click_rate')}>Click{sortIcon('click_rate')}</button>
                  </TH>
                  <TH className="text-right">
                    <button onClick={() => toggleSort('bounce_rate')}>Bounce{sortIcon('bounce_rate')}</button>
                  </TH>
                  <TH className="text-right">
                    <button onClick={() => toggleSort('complaint_rate')}>Complaint{sortIcon('complaint_rate')}</button>
                  </TH>
                  <TH className="text-right">
                    <button onClick={() => toggleSort('revenue')}>Revenue{sortIcon('revenue')}</button>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/dashboard/campaigns/${c.id}`} className="font-medium text-rose-300 hover:text-rose-200">
                        {c.name || 'Untitled campaign'}
                      </Link>
                      {c.subject && <div className="truncate text-xs text-stone-500">{c.subject}</div>}
                    </TD>
                    <TD className="text-stone-400">{senderName(c.sender_id)}</TD>
                    <TD className="whitespace-nowrap text-right text-xs text-stone-400">{fmtDate(c.sent_at)}</TD>
                    <TD className="text-right tabular-nums">{c._sends.toLocaleString()}</TD>
                    <TD className="text-right tabular-nums text-stone-200">{pct(c._openRate)}</TD>
                    <TD className="text-right tabular-nums text-stone-200">{pct(c._clickRate)}</TD>
                    <TD className="text-right tabular-nums">
                      <span className={c._bounceRate >= 0.02 ? 'text-amber-300' : 'text-stone-300'}>{pct(c._bounceRate)}</span>
                    </TD>
                    <TD className="text-right">
                      <Badge tone={complaintTone(c._complaintRate)}>{pct(c._complaintRate)}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums text-stone-300">
                      {c._revenue > 0 ? `$${(c._revenue / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
