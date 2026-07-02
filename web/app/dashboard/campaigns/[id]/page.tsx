'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

type CampaignDetail = {
  id: string
  name?: string
  subject?: string
  sentAt?: string | null
  sent_at?: string | null
  senderId?: string
  sender_id?: string
  segmentId?: string
  segment_id?: string
  senderName?: string
  segmentName?: string
  metadata?: Record<string, unknown> | null
  counts?: Record<string, number>
  rates?: Record<string, number>
  deltas?: Record<string, number>
  // tolerant flat fields
  sends?: number
  delivered?: number
  opens?: number
  clicks?: number
  bounces?: number
  complaints?: number
  unsubscribes?: number
  openRate?: number
  clickRate?: number
  bounceRate?: number
  complaintRate?: number
  deliveryRate?: number
  revenueCents?: number
  revenue_cents?: number
  [k: string]: unknown
}

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
  [k: string]: unknown
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined)

function pct(v: number | undefined): string {
  if (v === undefined) return '—'
  // accept either 0..1 or 0..100
  const n = v <= 1 ? v * 100 : v
  return `${n.toFixed(2)}%`
}

function money(cents: number | undefined): string {
  if (cents === undefined) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString()
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

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null)
  const [events, setEvents] = useState<SendEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [c, ev] = await Promise.all([api.getCampaign(id), api.getCampaignEvents(id)])
      const detail: CampaignDetail = (c?.campaign ?? c) as CampaignDetail
      setCampaign(detail)
      const list: SendEvent[] = Array.isArray(ev) ? ev : (ev?.events ?? [])
      setEvents(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load campaign')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const c = campaign
  const counts = c?.counts ?? {}
  const rates = c?.rates ?? {}

  const sends = num(c?.sends) ?? num(counts.sends) ?? num(counts.sent) ?? num(counts.total)
  const delivered = num(c?.delivered) ?? num(counts.delivered)
  const opens = num(c?.opens) ?? num(counts.opens) ?? num(counts.open)
  const clicks = num(c?.clicks) ?? num(counts.clicks) ?? num(counts.click)
  const bounces = num(c?.bounces) ?? num(counts.bounces) ?? num(counts.bounce)
  const complaints = num(c?.complaints) ?? num(counts.complaints) ?? num(counts.complaint)
  const revenue = num(c?.revenueCents) ?? num(c?.revenue_cents) ?? num((c as Record<string, unknown> | null)?.['atRiskCents'] as number)

  const openRate = num(c?.openRate) ?? num(rates.open) ?? num(rates.openRate) ?? (opens && sends ? opens / sends : undefined)
  const clickRate = num(c?.clickRate) ?? num(rates.click) ?? num(rates.clickRate) ?? (clicks && sends ? clicks / sends : undefined)
  const bounceRate = num(c?.bounceRate) ?? num(rates.bounce) ?? num(rates.bounceRate) ?? (bounces && sends ? bounces / sends : undefined)
  const complaintRate = num(c?.complaintRate) ?? num(rates.complaint) ?? num(rates.complaintRate) ?? (complaints && sends ? complaints / sends : undefined)
  const deliveryRate = num(c?.deliveryRate) ?? num(rates.delivery) ?? (delivered && sends ? delivered / sends : undefined)

  const eventTypes = useMemo(() => {
    const set = new Set<string>()
    for (const e of events) {
      const t = e.eventType ?? e.event_type
      if (t) set.add(t)
    }
    return Array.from(set).sort()
  }, [events])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      const t = (e.eventType ?? e.event_type ?? '').toString()
      if (typeFilter !== 'all' && t !== typeFilter) return false
      if (q) {
        const hay = `${e.recipientEmail ?? e.email ?? ''} ${e.messageId ?? e.message_id ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, typeFilter, search])

  if (loading) return <PageLoader label="Loading campaign..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load campaign"
          description={error}
          action={
            <div className="flex gap-3">
              <Button onClick={load}>Retry</Button>
              <Link href="/dashboard/campaigns">
                <Button variant="secondary">Back to campaigns</Button>
              </Link>
            </div>
          }
        />
      </div>
    )
  }

  if (!c) {
    return (
      <EmptyState
        title="Campaign not found"
        description="This campaign may have been removed."
        action={
          <Link href="/dashboard/campaigns">
            <Button variant="secondary">Back to campaigns</Button>
          </Link>
        }
      />
    )
  }

  const sentAt = c.sentAt ?? c.sent_at

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <Link href="/dashboard/campaigns" className="text-sm text-stone-500 hover:text-rose-300">
          ← Campaigns
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">{c.name ?? 'Campaign'}</h1>
            {c.subject && <p className="mt-1 text-sm text-stone-400">Subject: {c.subject}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
              {c.senderName && <Badge tone="slate">{c.senderName}</Badge>}
              {c.segmentName && <Badge tone="sky">{c.segmentName}</Badge>}
              <span>Sent {fmtDate(sentAt)}</span>
            </div>
          </div>
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Sends" value={sends?.toLocaleString() ?? '—'} />
        <Stat label="Delivered" value={delivered?.toLocaleString() ?? '—'} hint={`Delivery ${pct(deliveryRate)}`} tone="green" />
        <Stat label="Opens" value={opens?.toLocaleString() ?? '—'} hint={`Open rate ${pct(openRate)}`} tone="sky" />
        <Stat label="Clicks" value={clicks?.toLocaleString() ?? '—'} hint={`Click rate ${pct(clickRate)}`} tone="sky" />
        <Stat
          label="Bounces"
          value={bounces?.toLocaleString() ?? '—'}
          hint={`Bounce rate ${pct(bounceRate)}`}
          tone={bounceRate !== undefined && (bounceRate <= 1 ? bounceRate : bounceRate / 100) > 0.02 ? 'rose' : 'amber'}
        />
        <Stat
          label="Complaints"
          value={complaints?.toLocaleString() ?? '—'}
          hint={`Complaint rate ${pct(complaintRate)}`}
          tone={complaintRate !== undefined && (complaintRate <= 1 ? complaintRate : complaintRate / 100) > 0.001 ? 'rose' : 'amber'}
        />
        <Stat label="Revenue" value={money(revenue)} tone="green" />
        <Stat label="Events" value={events.length.toLocaleString()} />
      </div>

      {/* Rate bars + deltas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-stone-200">Engagement breakdown</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <RateBar label="Delivery rate" value={deliveryRate} tone="emerald" />
            <RateBar label="Open rate" value={openRate} tone="sky" />
            <RateBar label="Click rate" value={clickRate} tone="sky" />
            <RateBar label="Bounce rate" value={bounceRate} tone="amber" />
            <RateBar label="Complaint rate" value={complaintRate} tone="rose" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-stone-200">Deltas vs. baseline</h2>
          </CardHeader>
          <CardBody>
            {c.deltas && Object.keys(c.deltas).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(c.deltas).map(([k, v]) => {
                  const n = typeof v === 'number' ? v : 0
                  const positive = n >= 0
                  return (
                    <div key={k} className="flex items-center justify-between text-sm">
                      <span className="capitalize text-stone-400">{k.replace(/([A-Z])/g, ' $1')}</span>
                      <span className={positive ? 'text-emerald-300' : 'text-rose-300'}>
                        {positive ? '▲' : '▼'} {pct(Math.abs(n))}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-stone-500">No baseline comparison available for this campaign.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Event list */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-stone-200">Events ({filtered.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email / message id"
              className="w-56 rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-200 placeholder-stone-600 focus:border-rose-500 focus:outline-none"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
            >
              <option value="all">All event types</option>
              {eventTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={events.length === 0 ? 'No events recorded' : 'No matching events'}
                description={
                  events.length === 0
                    ? 'Once sends are imported for this campaign, individual events appear here.'
                    : 'Try clearing filters or search.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Event</TH>
                  <TH>Recipient</TH>
                  <TH>Bounce type</TH>
                  <TH>Message ID</TH>
                  <TH>When</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => {
                  const t = e.eventType ?? e.event_type
                  return (
                    <TR key={e.id}>
                      <TD>
                        <Badge tone={eventTone(t)}>{t ?? 'event'}</Badge>
                      </TD>
                      <TD>
                        {e.recipientId ?? e.recipient_id ? (
                          <Link
                            href={`/dashboard/recipients?focus=${e.recipientId ?? e.recipient_id}`}
                            className="text-rose-300 hover:underline"
                          >
                            {e.recipientEmail ?? e.email ?? (e.recipientId ?? e.recipient_id)}
                          </Link>
                        ) : (
                          e.recipientEmail ?? e.email ?? '—'
                        )}
                      </TD>
                      <TD>{e.bounceType ?? e.bounce_type ?? '—'}</TD>
                      <TD className="font-mono text-xs text-stone-500">{e.messageId ?? e.message_id ?? '—'}</TD>
                      <TD className="whitespace-nowrap text-stone-400">{fmtDate(e.eventAt ?? e.event_at)}</TD>
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

function RateBar({ label, value, tone }: { label: string; value: number | undefined; tone: 'emerald' | 'sky' | 'amber' | 'rose' }) {
  const n = value === undefined ? undefined : value <= 1 ? value * 100 : value
  const width = n === undefined ? 0 : Math.min(100, Math.max(0, n))
  const bar: Record<string, string> = {
    emerald: 'bg-emerald-400',
    sky: 'bg-rose-400',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-stone-400">{label}</span>
        <span className="font-medium text-stone-200">{n === undefined ? '—' : `${n.toFixed(2)}%`}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-800">
        <div className={`h-full rounded-full ${bar[tone]}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}
