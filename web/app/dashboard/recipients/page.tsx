'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

type Workspace = { id: string; name?: string }

type Recipient = {
  id: string
  email?: string
  status?: string
  isRoleAccount?: boolean
  is_role_account?: boolean
  lastEngagedAt?: string | null
  last_engaged_at?: string | null
  totalSends?: number
  total_sends?: number
  totalOpens?: number
  total_opens?: number
  totalClicks?: number
  total_clicks?: number
  totalBounces?: number
  total_bounces?: number
  totalComplaints?: number
  total_complaints?: number
  [k: string]: unknown
}

type RecipientEvent = {
  id: string
  eventType?: string
  event_type?: string
  bounceType?: string | null
  bounce_type?: string | null
  eventAt?: string | null
  event_at?: string | null
  campaignName?: string
  campaignId?: string
  campaign_id?: string
  [k: string]: unknown
}

type RecipientDetail = Recipient & {
  recipient?: Recipient
  events?: RecipientEvent[]
  history?: RecipientEvent[]
}

const WS_KEY = 'edrg_workspace'
const PAGE_SIZE = 50
const STATUSES = ['active', 'dormant', 'suppressed', 'bounced', 'complained']

const num = (...vals: unknown[]): number | undefined => {
  for (const v of vals) if (typeof v === 'number' && !Number.isNaN(v)) return v
  return undefined
}

const statusTone = (s?: string): 'green' | 'sky' | 'amber' | 'rose' | 'slate' => {
  switch ((s ?? '').toLowerCase()) {
    case 'active':
      return 'green'
    case 'dormant':
      return 'amber'
    case 'suppressed':
    case 'bounced':
    case 'complained':
      return 'rose'
    default:
      return 'slate'
  }
}

const eventTone = (t?: string): 'green' | 'sky' | 'amber' | 'rose' | 'slate' => {
  switch ((t ?? '').toLowerCase()) {
    case 'delivered':
    case 'delivery':
      return 'green'
    case 'open':
    case 'click':
      return 'sky'
    case 'bounce':
    case 'hard_bounce':
    case 'soft_bounce':
      return 'amber'
    case 'complaint':
    case 'spam':
    case 'unsubscribe':
      return 'rose'
    default:
      return 'slate'
  }
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString()
}

export default function RecipientsPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading recipients..." />}>
      <RecipientsView />
    </Suspense>
  )
}

function RecipientsView() {
  const searchParams = useSearchParams()
  const focusId = searchParams?.get('focus') ?? null

  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [wsResolved, setWsResolved] = useState(false)

  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  // drawer
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RecipientDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // Resolve workspace
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        const list: Workspace[] = await api.listWorkspaces()
        if (!active) return
        const wsId = stored && list.some((w) => w.id === stored) ? stored : list[0]?.id ?? null
        setWorkspaceId(wsId)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to resolve workspace')
      } finally {
        if (active) setWsResolved(true)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, unknown> = { workspaceId, limit: PAGE_SIZE, offset: page * PAGE_SIZE }
      if (status) params.status = status
      const res = await api.listRecipients(params)
      const list: Recipient[] = Array.isArray(res) ? res : (res?.recipients ?? [])
      setRecipients(list)
      setTotal(typeof res?.total === 'number' ? res.total : list.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recipients')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, page, status])

  useEffect(() => {
    if (wsResolved) load()
  }, [wsResolved, load])

  const openDrawer = useCallback(async (id: string) => {
    setOpenId(id)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const res = await api.getRecipient(id)
      const r: RecipientDetail = (res?.recipient ? { ...res.recipient, ...res } : res) as RecipientDetail
      setDetail(r)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load recipient')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // Auto-open the focused recipient (deep link from events page)
  useEffect(() => {
    if (focusId) openDrawer(focusId)
  }, [focusId, openDrawer])

  const closeDrawer = () => {
    setOpenId(null)
    setDetail(null)
    setDetailError(null)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return recipients
    return recipients.filter((r) => (r.email ?? '').toLowerCase().includes(q))
  }, [recipients, search])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (!wsResolved) return <PageLoader label="Loading recipients..." />

  if (!workspaceId) {
    return (
      <EmptyState
        title="No workspace yet"
        description="Create a workspace from the dashboard to start managing recipients."
        action={
          <Link href="/dashboard">
            <Button>Go to dashboard</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Recipients</h1>
          <p className="mt-1 text-sm text-stone-400">Per-address engagement, role-account flags and lifecycle status.</p>
        </div>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1" style={{ minWidth: 220 }}>
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Search email (this page)</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="name@domain.com"
              className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:border-rose-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setPage(0)
              }}
              className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </CardBody>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-200">
            {total.toLocaleString()} recipient{total === 1 ? '' : 's'}
          </h2>
          {loading && <Spinner />}
        </CardHeader>
        <CardBody className="p-0">
          {error ? (
            <div className="p-6">
              <EmptyState title="Could not load recipients" description={error} action={<Button onClick={load}>Retry</Button>} />
            </div>
          ) : !loading && filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={search || status ? 'No matching recipients' : 'No recipients yet'}
                description={
                  search || status
                    ? 'Adjust your search or status filter.'
                    : 'Import a subscriber list or seed sample data to populate recipients.'
                }
                action={
                  !search && !status ? (
                    <Link href="/dashboard/imports">
                      <Button>Import data</Button>
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Email</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Sends</TH>
                  <TH className="text-right">Opens</TH>
                  <TH className="text-right">Clicks</TH>
                  <TH className="text-right">Bounces</TH>
                  <TH className="text-right">Complaints</TH>
                  <TH>Last engaged</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => {
                  const isRole = r.isRoleAccount ?? r.is_role_account
                  return (
                    <TR key={r.id} className="cursor-pointer" onClick={() => openDrawer(r.id)}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <span className="text-stone-200">{r.email ?? r.id}</span>
                          {isRole && <Badge tone="amber">role</Badge>}
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(r.status)}>{r.status ?? 'unknown'}</Badge>
                      </TD>
                      <TD className="text-right">{(num(r.totalSends, r.total_sends) ?? 0).toLocaleString()}</TD>
                      <TD className="text-right">{(num(r.totalOpens, r.total_opens) ?? 0).toLocaleString()}</TD>
                      <TD className="text-right">{(num(r.totalClicks, r.total_clicks) ?? 0).toLocaleString()}</TD>
                      <TD className="text-right">{(num(r.totalBounces, r.total_bounces) ?? 0).toLocaleString()}</TD>
                      <TD className="text-right">{(num(r.totalComplaints, r.total_complaints) ?? 0).toLocaleString()}</TD>
                      <TD className="whitespace-nowrap text-stone-400">{fmtDate(r.lastEngagedAt ?? r.last_engaged_at)}</TD>
                      <TD className="text-right text-rose-300">View →</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-stone-400">
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Previous
            </Button>
            <Button variant="secondary" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Profile drawer */}
      {openId && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-stone-950/70 backdrop-blur-sm" onClick={closeDrawer} />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-stone-800 bg-stone-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-800 px-5 py-4">
              <h2 className="text-sm font-semibold text-white">Recipient profile</h2>
              <button onClick={closeDrawer} className="text-stone-500 hover:text-white" aria-label="Close">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {detailLoading ? (
                <div className="flex min-h-[30vh] items-center justify-center gap-3 text-stone-400">
                  <Spinner />
                  <span className="text-sm">Loading profile...</span>
                </div>
              ) : detailError ? (
                <EmptyState
                  title="Could not load profile"
                  description={detailError}
                  action={<Button onClick={() => openDrawer(openId)}>Retry</Button>}
                />
              ) : detail ? (
                <RecipientProfile detail={detail} />
              ) : null}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function RecipientProfile({ detail }: { detail: RecipientDetail }) {
  const r = detail.recipient ?? detail
  const events = detail.events ?? detail.history ?? []
  const sends = num(r.totalSends, r.total_sends) ?? 0
  const opens = num(r.totalOpens, r.total_opens) ?? 0
  const clicks = num(r.totalClicks, r.total_clicks) ?? 0
  const bounces = num(r.totalBounces, r.total_bounces) ?? 0
  const complaints = num(r.totalComplaints, r.total_complaints) ?? 0
  const isRole = r.isRoleAccount ?? r.is_role_account
  const openRate = sends ? (opens / sends) * 100 : 0
  const clickRate = sends ? (clicks / sends) * 100 : 0

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="break-all text-lg font-semibold text-white">{r.email ?? r.id}</h3>
          <Badge tone={statusTone(r.status)}>{r.status ?? 'unknown'}</Badge>
          {isRole && <Badge tone="amber">role account</Badge>}
        </div>
        <p className="mt-1 text-xs text-stone-500">Last engaged {fmtDate(r.lastEngagedAt ?? r.last_engaged_at)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Sends" value={sends.toLocaleString()} />
        <Stat label="Opens" value={opens.toLocaleString()} hint={`${openRate.toFixed(1)}% open`} tone="sky" />
        <Stat label="Clicks" value={clicks.toLocaleString()} hint={`${clickRate.toFixed(1)}% click`} tone="sky" />
        <Stat label="Bounces" value={bounces.toLocaleString()} tone={bounces > 0 ? 'amber' : 'default'} />
        <Stat label="Complaints" value={complaints.toLocaleString()} tone={complaints > 0 ? 'rose' : 'default'} />
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Event history</h4>
        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-800 bg-stone-900/40 px-4 py-6 text-center text-sm text-stone-500">
            No recorded events for this recipient.
          </p>
        ) : (
          <ol className="space-y-2">
            {events.map((e) => {
              const t = e.eventType ?? e.event_type
              const cid = e.campaignId ?? e.campaign_id
              return (
                <li key={e.id} className="flex items-start justify-between gap-3 rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={eventTone(t)}>{t ?? 'event'}</Badge>
                      {(e.bounceType ?? e.bounce_type) && (
                        <span className="text-xs text-stone-500">{e.bounceType ?? e.bounce_type}</span>
                      )}
                    </div>
                    {(e.campaignName || cid) && (
                      <span className="text-xs text-stone-500">
                        {cid ? (
                          <Link href={`/dashboard/campaigns/${cid}`} className="text-rose-300 hover:underline">
                            {e.campaignName ?? 'View campaign'}
                          </Link>
                        ) : (
                          e.campaignName
                        )}
                      </span>
                    )}
                  </div>
                  <span className="whitespace-nowrap text-xs text-stone-500">{fmtDate(e.eventAt ?? e.event_at)}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
