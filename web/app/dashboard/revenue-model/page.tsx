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
}

interface RevenueModel {
  id: string
  sender_id?: string | null
  version?: number | null
  revenue_per_send_cents?: number | null
  conversion_rate?: number | null
  aov_cents?: number | null
  source?: string | null
  is_active?: boolean | null
  created_at?: string
}

interface Derived {
  revenuePerSendCents?: number
  conversionRate?: number
  aovCents?: number
}

function senderLabel(s?: Sender): string {
  if (!s) return 'All senders'
  if (s.friendly_name) return s.friendly_name
  if (s.subdomain) return `${s.subdomain}.${s.domain ?? ''}`
  return s.domain ?? s.id
}

function fmtMoney(cents?: number | null, currency = 'USD', digits = 2): string {
  const v = (cents ?? 0) / 100
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v)
}

function fmtPct(rate?: number | null): string {
  if (rate == null) return '—'
  const pct = rate <= 1 ? rate * 100 : rate
  return `${pct.toFixed(2)}%`
}

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function RevenueModelPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [senders, setSenders] = useState<Sender[]>([])
  const [senderId, setSenderId] = useState<string>('') // '' = workspace-level
  const [active, setActive] = useState<RevenueModel | null>(null)
  const [versions, setVersions] = useState<RevenueModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Form (dollars / percent in the UI; convert on submit)
  const [rps, setRps] = useState('') // revenue per send, dollars
  const [conv, setConv] = useState('') // conversion rate, percent
  const [aov, setAov] = useState('') // average order value, dollars
  const [saving, setSaving] = useState(false)
  const [deriving, setDeriving] = useState(false)

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

  const fillForm = (m: RevenueModel | null) => {
    if (!m) {
      setRps('')
      setConv('')
      setAov('')
      return
    }
    setRps(m.revenue_per_send_cents != null ? (m.revenue_per_send_cents / 100).toString() : '')
    const c = m.conversion_rate ?? null
    setConv(c == null ? '' : (c <= 1 ? c * 100 : c).toString())
    setAov(m.aov_cents != null ? (m.aov_cents / 100).toString() : '')
  }

  const load = useCallback(async (wsId: string, sId: string) => {
    setLoading(true)
    setError(null)
    try {
      const [snd, model] = await Promise.all([api.listSenders(wsId), api.getRevenueModel(wsId, sId || undefined)])
      setSenders(snd)
      const act: RevenueModel | null = model?.active ?? null
      setActive(act)
      setVersions(Array.isArray(model?.versions) ? model.versions : [])
      fillForm(act)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load revenue model')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!workspaceId) return
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, workspaceId)
    load(workspaceId, senderId)
  }, [workspaceId, senderId, load])

  const toCents = (v: string): number | undefined => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? Math.round(n * 100) : undefined
  }
  const toRate = (v: string): number | undefined => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n / 100 : undefined
  }

  const derive = async () => {
    if (!workspaceId) return
    setDeriving(true)
    setError(null)
    setNotice(null)
    try {
      const body: Record<string, unknown> = { workspaceId }
      if (senderId) body.senderId = senderId
      const d: Derived = await api.deriveRevenueModel(body)
      if (d.revenuePerSendCents != null) setRps((d.revenuePerSendCents / 100).toString())
      if (d.conversionRate != null) setConv((d.conversionRate <= 1 ? d.conversionRate * 100 : d.conversionRate).toString())
      if (d.aovCents != null) setAov((d.aovCents / 100).toString())
      setNotice('Derived assumptions from send history. Review and save to create a new version.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Derive failed')
    } finally {
      setDeriving(false)
    }
  }

  const save = async () => {
    if (!workspaceId) return
    const rpsCents = toCents(rps)
    if (rpsCents == null) {
      setError('Revenue per send is required.')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const body: Record<string, unknown> = {
        workspaceId,
        revenuePerSendCents: rpsCents,
        source: 'manual',
      }
      if (senderId) body.senderId = senderId
      const c = toRate(conv)
      if (c != null) body.conversionRate = c
      const a = toCents(aov)
      if (a != null) body.aovCents = a
      const created: RevenueModel = await api.createRevenueModel(body)
      setNotice(`Saved version ${created.version ?? ''} as active.`)
      await load(workspaceId, senderId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const senderName = (id?: string | null) => (id ? senderLabel(senders.find((s) => s.id === id)) : 'Workspace default')

  // ---- Render ----
  if (loading && !workspaces.length && !error) return <PageLoader label="Loading revenue model..." />

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
          description="Create a workspace from the dashboard to configure a revenue model."
          action={
            <a href="/dashboard">
              <Button>Go to dashboard</Button>
            </a>
          }
        />
      </div>
    )
  }

  const computedRps = (() => {
    const c = toRate(conv)
    const a = toCents(aov)
    if (c != null && a != null) return Math.round(c * a)
    return null
  })()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Revenue Model</h1>
          <p className="mt-1 text-sm text-slate-400">
            Set the per-send value used to quantify revenue at risk. Derive it from history or enter it directly.
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
            <option value="">Workspace default</option>
            {senders.map((s) => (
              <option key={s.id} value={s.id}>
                {senderLabel(s)}
              </option>
            ))}
          </select>
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

      {loading ? (
        <PageLoader label="Loading revenue model..." />
      ) : (
        <>
          {/* Active summary */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Revenue / send"
              value={active ? fmtMoney(active.revenue_per_send_cents, currency, 4) : '—'}
              tone="green"
              hint={active ? `Active v${active.version ?? '?'}` : 'No active model'}
            />
            <Stat label="Conversion rate" value={active ? fmtPct(active.conversion_rate) : '—'} tone="sky" />
            <Stat label="Avg order value" value={active ? fmtMoney(active.aov_cents, currency) : '—'} />
            <Stat label="Source" value={active?.source ?? '—'} hint={active ? fmtDate(active.created_at) : undefined} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Form */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-200">New version</h2>
                  <Badge tone="slate">{senderName(senderId)}</Badge>
                </CardHeader>
                <CardBody className="space-y-4">
                  <p className="text-xs text-slate-500">
                    Saving creates a new version and deactivates the prior one. Either enter revenue per send
                    directly, or provide conversion &amp; AOV to derive it.
                  </p>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                      Revenue per send ({currency})
                    </span>
                    <input
                      value={rps}
                      onChange={(e) => setRps(e.target.value)}
                      type="number"
                      step="0.0001"
                      min="0"
                      placeholder="0.12"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Conversion %
                      </span>
                      <input
                        value={conv}
                        onChange={(e) => setConv(e.target.value)}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.30"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                        AOV ({currency})
                      </span>
                      <input
                        value={aov}
                        onChange={(e) => setAov(e.target.value)}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="40.00"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
                      />
                    </label>
                  </div>
                  {computedRps != null && (
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-sky-200">
                      Conversion × AOV implies{' '}
                      <span className="font-semibold">{fmtMoney(computedRps, currency, 4)}</span> per send.{' '}
                      <button
                        type="button"
                        onClick={() => setRps((computedRps / 100).toString())}
                        className="underline hover:text-sky-100"
                      >
                        Use this value
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="secondary" onClick={derive} disabled={deriving}>
                      {deriving ? (
                        <>
                          <Spinner className="mr-2 h-4 w-4" /> Deriving
                        </>
                      ) : (
                        'Derive from history'
                      )}
                    </Button>
                    <Button onClick={save} disabled={saving}>
                      {saving ? (
                        <>
                          <Spinner className="mr-2 h-4 w-4" /> Saving
                        </>
                      ) : (
                        'Save as active'
                      )}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* Versions */}
            <div className="lg:col-span-3">
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-200">Version history</h2>
                  <Badge tone="slate">{versions.length}</Badge>
                </CardHeader>
                <CardBody className="p-0">
                  {versions.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        title="No versions yet"
                        description="Derive or enter assumptions, then save to create the first version."
                      />
                    </div>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Version</TH>
                          <TH className="text-right">Rev / send</TH>
                          <TH className="text-right">Conversion</TH>
                          <TH className="text-right">AOV</TH>
                          <TH>Source</TH>
                          <TH>Created</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {versions
                          .slice()
                          .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
                          .map((v) => (
                            <TR key={v.id}>
                              <TD>
                                <span className="inline-flex items-center gap-2">
                                  <span className="font-medium text-slate-100">v{v.version ?? '?'}</span>
                                  {v.is_active && <Badge tone="green">active</Badge>}
                                </span>
                              </TD>
                              <TD className="text-right font-medium text-slate-100">
                                {fmtMoney(v.revenue_per_send_cents, currency, 4)}
                              </TD>
                              <TD className="text-right">{fmtPct(v.conversion_rate)}</TD>
                              <TD className="text-right">{fmtMoney(v.aov_cents, currency)}</TD>
                              <TD>
                                <span className="text-slate-400">{v.source ?? '—'}</span>
                              </TD>
                              <TD>
                                <span className="text-slate-500">{fmtDate(v.created_at)}</span>
                              </TD>
                            </TR>
                          ))}
                      </TBody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
