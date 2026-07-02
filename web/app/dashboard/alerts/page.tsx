'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/Spinner'

const WS_KEY = 'edrg.workspaceId'

type Workspace = { id: string; name: string }

type Alert = {
  id: string
  rule_id?: string | null
  sender_id?: string | null
  campaign_id?: string | null
  segment_id?: string | null
  metric: string
  observed_value: number
  threshold: number
  severity: string
  message: string
  status: string
  triggered_at?: string
  created_at?: string
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
]

function severityTone(sev: string): 'rose' | 'amber' | 'sky' | 'slate' {
  const s = sev.toLowerCase()
  if (s === 'critical' || s === 'high') return 'rose'
  if (s === 'medium' || s === 'warning' || s === 'warn') return 'amber'
  if (s === 'low' || s === 'info') return 'sky'
  return 'slate'
}

function statusTone(status: string): 'rose' | 'amber' | 'green' | 'slate' {
  const s = status.toLowerCase()
  if (s === 'open' || s === 'triggered' || s === 'firing') return 'rose'
  if (s === 'acknowledged' || s === 'ack') return 'amber'
  if (s === 'resolved' || s === 'closed') return 'green'
  return 'slate'
}

function metricLabel(m: string): string {
  return m.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function fmtValue(metric: string, v: number): string {
  const m = metric.toLowerCase()
  if (m.includes('rate') || m.includes('pct') || m.includes('percent')) {
    return `${(v <= 1 ? v * 100 : v).toFixed(2)}%`
  }
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export default function AlertsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [notice, setNotice] = useState<string>('')
  const [scanning, setScanning] = useState(false)
  const [statusTab, setStatusTab] = useState<string>('open')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [search, setSearch] = useState<string>('')
  const [busyId, setBusyId] = useState<string>('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        if (!active) return
        setWorkspaces(ws ?? [])
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        const initial = (stored && ws?.some((w) => w.id === stored)) ? stored : ws?.[0]?.id ?? ''
        setWorkspaceId(initial)
        if (!initial) setLoading(false)
      } catch (e) {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Failed to load workspaces')
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async (wsId: string, status: string) => {
    if (!wsId) return
    setLoading(true)
    setError('')
    try {
      const list: Alert[] = await api.listAlerts(wsId, status === 'all' ? undefined : status)
      setAlerts(Array.isArray(list) ? list : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) load(workspaceId, statusTab)
  }, [workspaceId, statusTab, load])

  const onSelectWorkspace = (id: string) => {
    setWorkspaceId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, id)
  }

  const scan = async () => {
    if (!workspaceId) return
    setScanning(true)
    setError('')
    setNotice('')
    try {
      const found: Alert[] = await api.scanAlerts({ workspaceId })
      const count = Array.isArray(found) ? found.length : 0
      setNotice(count > 0 ? `Scan complete — ${count} alert(s) triggered.` : 'Scan complete — no thresholds breached.')
      await load(workspaceId, statusTab)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const setStatus = async (id: string, status: string) => {
    setBusyId(id)
    setError('')
    try {
      await api.updateAlert(id, { status })
      await load(workspaceId, statusTab)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId('')
    }
  }

  const counts = useMemo(() => {
    const c = { open: 0, acknowledged: 0, resolved: 0, critical: 0 }
    for (const a of alerts) {
      const s = a.status.toLowerCase()
      if (s === 'open' || s === 'triggered' || s === 'firing') c.open++
      else if (s === 'acknowledged' || s === 'ack') c.acknowledged++
      else if (s === 'resolved' || s === 'closed') c.resolved++
      const sev = a.severity.toLowerCase()
      if (sev === 'critical' || sev === 'high') c.critical++
    }
    return c
  }, [alerts])

  const severities = useMemo(() => {
    return [...new Set(alerts.map((a) => a.severity))]
  }, [alerts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return alerts.filter((a) => {
      if (severityFilter !== 'all' && a.severity !== severityFilter) return false
      if (!q) return true
      const hay = [a.metric, a.message, a.severity, a.status, a.sender_id, a.campaign_id, a.segment_id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [alerts, severityFilter, search])

  if (loading && alerts.length === 0 && !error) {
    return <PageLoader label="Loading alerts..." />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Alerts</h1>
          <p className="mt-1 text-sm text-stone-500">
            Threshold breaches detected against your alert rules. Scan, acknowledge, and resolve.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workspaces.length > 0 && (
            <select
              value={workspaceId}
              onChange={(e) => onSelectWorkspace(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" onClick={scan} disabled={scanning || !workspaceId}>
            {scanning ? 'Scanning...' : 'Run scan'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {!workspaceId ? (
        <EmptyState
          title="No workspace selected"
          description="Create a workspace from the dashboard to monitor deliverability alerts."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Open" value={counts.open} tone="rose" />
            <Stat label="Acknowledged" value={counts.acknowledged} tone="amber" />
            <Stat label="Resolved" value={counts.resolved} tone="green" />
            <Stat label="Critical / High" value={counts.critical} tone="rose" />
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-1">
                  {STATUS_TABS.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setStatusTab(t.key)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        statusTab === t.key
                          ? 'bg-rose-500/15 text-rose-300'
                          : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                    className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
                  >
                    <option value="all">All severities</option>
                    {severities.map((s) => (
                      <option key={s} value={s}>
                        {metricLabel(s)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search alerts..."
                    className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder-stone-600 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState
                    title={alerts.length === 0 ? 'No alerts' : 'No matching alerts'}
                    description={
                      alerts.length === 0
                        ? 'Run a scan to detect threshold breaches against your alert rules.'
                        : 'Adjust the status tab, severity filter, or search query.'
                    }
                    action={
                      alerts.length === 0 ? (
                        <Button variant="secondary" onClick={scan} disabled={scanning}>
                          Run scan now
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-stone-800">
                  {filtered.map((a) => {
                    const s = a.status.toLowerCase()
                    const isOpen = s === 'open' || s === 'triggered' || s === 'firing'
                    const isAck = s === 'acknowledged' || s === 'ack'
                    const isResolved = s === 'resolved' || s === 'closed'
                    return (
                      <li key={a.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={severityTone(a.severity)}>{metricLabel(a.severity)}</Badge>
                            <Badge tone={statusTone(a.status)}>{metricLabel(a.status)}</Badge>
                            <span className="text-sm font-medium text-stone-200">{metricLabel(a.metric)}</span>
                          </div>
                          <p className="mt-1 text-sm text-stone-400">{a.message}</p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500">
                            <span>
                              Observed{' '}
                              <span className="font-medium text-rose-300">{fmtValue(a.metric, a.observed_value)}</span>{' '}
                              vs threshold{' '}
                              <span className="font-medium text-stone-400">{fmtValue(a.metric, a.threshold)}</span>
                            </span>
                            {a.triggered_at && <span>Triggered {new Date(a.triggered_at).toLocaleString()}</span>}
                            {a.sender_id && <span className="font-mono">sender {a.sender_id.slice(0, 8)}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {!isAck && !isResolved && (
                            <Button
                              variant="secondary"
                              onClick={() => setStatus(a.id, 'acknowledged')}
                              disabled={busyId === a.id}
                            >
                              {busyId === a.id ? '...' : 'Acknowledge'}
                            </Button>
                          )}
                          {!isResolved && (
                            <Button
                              variant="primary"
                              onClick={() => setStatus(a.id, 'resolved')}
                              disabled={busyId === a.id}
                            >
                              {busyId === a.id ? '...' : 'Resolve'}
                            </Button>
                          )}
                          {isResolved && !isOpen && (
                            <Button
                              variant="ghost"
                              onClick={() => setStatus(a.id, 'open')}
                              disabled={busyId === a.id}
                            >
                              {busyId === a.id ? '...' : 'Reopen'}
                            </Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
