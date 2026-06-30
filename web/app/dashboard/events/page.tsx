'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

type Sender = { id: string; domain?: string; friendlyName?: string; friendly_name?: string; subdomain?: string }
type Workspace = { id: string; name?: string }

type SendEvent = {
  id: string
  messageId?: string
  message_id?: string
  eventType?: string
  event_type?: string
  bounceType?: string | null
  bounce_type?: string | null
  eventAt?: string | null
  event_at?: string | null
  recipientId?: string
  recipient_id?: string
  recipientEmail?: string
  email?: string
  campaignId?: string
  campaign_id?: string
  campaignName?: string
  senderId?: string
  sender_id?: string
  [k: string]: unknown
}

const WS_KEY = 'edrg_workspace'
const PAGE_SIZE = 50

const EVENT_TYPES = ['delivered', 'open', 'click', 'bounce', 'complaint', 'unsubscribe']

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

function senderLabel(s: Sender): string {
  return s.friendlyName ?? s.friendly_name ?? [s.subdomain, s.domain].filter(Boolean).join('.') ?? s.domain ?? s.id
}

export default function EventsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [wsResolved, setWsResolved] = useState(false)
  const [senders, setSenders] = useState<Sender[]>([])

  const [events, setEvents] = useState<SendEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // filters
  const [type, setType] = useState<string>('')
  const [senderId, setSenderId] = useState<string>('')
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')
  const [page, setPage] = useState(0)

  // Resolve active workspace
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        const list: Workspace[] = await api.listWorkspaces()
        if (!active) return
        let wsId = stored && list.some((w) => w.id === stored) ? stored : list[0]?.id ?? null
        setWorkspaceId(wsId)
        if (wsId) {
          try {
            const s: Sender[] = await api.listSenders(wsId)
            if (active) setSenders(Array.isArray(s) ? s : [])
          } catch {
            /* senders are optional for the filter */
          }
        }
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
      const params: Record<string, unknown> = {
        workspaceId,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }
      if (type) params.type = type
      if (senderId) params.senderId = senderId
      if (from) params.from = new Date(from).toISOString()
      if (to) params.to = new Date(to).toISOString()
      const res = await api.listEvents(params)
      const list: SendEvent[] = Array.isArray(res) ? res : (res?.events ?? [])
      setEvents(list)
      setTotal(typeof res?.total === 'number' ? res.total : list.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, page, type, senderId, from, to])

  useEffect(() => {
    if (wsResolved) load()
  }, [wsResolved, load])

  // reset to first page when filters change
  const setFilter = (fn: () => void) => {
    fn()
    setPage(0)
  }

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of events) {
      const t = (e.eventType ?? e.event_type ?? 'unknown').toLowerCase()
      m[t] = (m[t] ?? 0) + 1
    }
    return m
  }, [events])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(type || senderId || from || to)

  if (!wsResolved) return <PageLoader label="Loading events..." />

  if (!workspaceId) {
    return (
      <EmptyState
        title="No workspace yet"
        description="Create a workspace from the dashboard to start exploring events."
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
          <h1 className="text-2xl font-semibold tracking-tight text-white">Event explorer</h1>
          <p className="mt-1 text-sm text-slate-400">Raw send, open, click, bounce and complaint events across all senders.</p>
        </div>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      {/* On-page tallies */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="On page" value={events.length} />
        <Stat label="Delivered" value={counts['delivered'] ?? 0} tone="green" />
        <Stat label="Opens" value={counts['open'] ?? 0} tone="sky" />
        <Stat label="Clicks" value={counts['click'] ?? 0} tone="sky" />
        <Stat label="Bounces" value={counts['bounce'] ?? 0} tone="amber" />
        <Stat label="Complaints" value={(counts['complaint'] ?? 0) + (counts['unsubscribe'] ?? 0)} tone="rose" />
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label="Event type">
            <select
              value={type}
              onChange={(e) => setFilter(() => setType(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="">All types</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sender">
            <select
              value={senderId}
              onChange={(e) => setFilter(() => setSenderId(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="">All senders</option>
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {senderLabel(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input
              type="date"
              value={from}
              onChange={(e) => setFilter(() => setFrom(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={to}
              onChange={(e) => setFilter(() => setTo(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            />
          </Field>
          {hasFilters && (
            <Button
              variant="ghost"
              onClick={() =>
                setFilter(() => {
                  setType('')
                  setSenderId('')
                  setFrom('')
                  setTo('')
                })
              }
            >
              Clear filters
            </Button>
          )}
        </CardBody>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">
            {total.toLocaleString()} event{total === 1 ? '' : 's'}
          </h2>
          {loading && <Spinner />}
        </CardHeader>
        <CardBody className="p-0">
          {error ? (
            <div className="p-6">
              <EmptyState title="Could not load events" description={error} action={<Button onClick={load}>Retry</Button>} />
            </div>
          ) : !loading && events.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={hasFilters ? 'No events match these filters' : 'No events yet'}
                description={
                  hasFilters
                    ? 'Widen the date range or clear filters.'
                    : 'Import a list or seed sample data to populate the event stream.'
                }
                action={
                  !hasFilters ? (
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
                  <TH>Event</TH>
                  <TH>Recipient</TH>
                  <TH>Campaign</TH>
                  <TH>Bounce type</TH>
                  <TH>Message ID</TH>
                  <TH>When</TH>
                </TR>
              </THead>
              <TBody>
                {events.map((e) => {
                  const t = e.eventType ?? e.event_type
                  const cid = e.campaignId ?? e.campaign_id
                  const rid = e.recipientId ?? e.recipient_id
                  return (
                    <TR key={e.id}>
                      <TD>
                        <Badge tone={eventTone(t)}>{t ?? 'event'}</Badge>
                      </TD>
                      <TD>
                        {rid ? (
                          <Link href={`/dashboard/recipients?focus=${rid}`} className="text-sky-300 hover:underline">
                            {e.recipientEmail ?? e.email ?? rid}
                          </Link>
                        ) : (
                          e.recipientEmail ?? e.email ?? '—'
                        )}
                      </TD>
                      <TD>
                        {cid ? (
                          <Link href={`/dashboard/campaigns/${cid}`} className="text-sky-300 hover:underline">
                            {e.campaignName ?? 'View campaign'}
                          </Link>
                        ) : (
                          e.campaignName ?? '—'
                        )}
                      </TD>
                      <TD>{e.bounceType ?? e.bounce_type ?? '—'}</TD>
                      <TD className="font-mono text-xs text-slate-500">{e.messageId ?? e.message_id ?? '—'}</TD>
                      <TD className="whitespace-nowrap text-slate-400">{fmtDate(e.eventAt ?? e.event_at)}</TD>
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
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}
