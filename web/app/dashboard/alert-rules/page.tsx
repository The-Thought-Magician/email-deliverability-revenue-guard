'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'edrg.workspaceId'

type Workspace = { id: string; name: string }
type Sender = { id: string; friendly_name?: string; domain?: string }
type Segment = { id: string; name: string }

type AlertRule = {
  id: string
  sender_id?: string | null
  segment_id?: string | null
  metric: string
  threshold: number
  comparison: string
  enabled: boolean
  created_at?: string
}

const METRICS: { value: string; label: string; unit: 'pct' | 'score' | 'num' }[] = [
  { value: 'complaint_rate', label: 'Complaint rate', unit: 'pct' },
  { value: 'bounce_rate', label: 'Bounce rate', unit: 'pct' },
  { value: 'hard_bounce_rate', label: 'Hard bounce rate', unit: 'pct' },
  { value: 'engagement_rate', label: 'Engagement rate', unit: 'pct' },
  { value: 'placement_score', label: 'Placement score', unit: 'score' },
  { value: 'revenue_at_risk', label: 'Revenue at risk', unit: 'num' },
]

const COMPARISONS: { value: string; label: string; symbol: string }[] = [
  { value: 'gt', label: 'greater than', symbol: '>' },
  { value: 'gte', label: 'greater than or equal', symbol: '≥' },
  { value: 'lt', label: 'less than', symbol: '<' },
  { value: 'lte', label: 'less than or equal', symbol: '≤' },
  { value: 'eq', label: 'equal to', symbol: '=' },
]

function metricMeta(metric: string) {
  return METRICS.find((m) => m.value === metric) ?? { value: metric, label: metric, unit: 'num' as const }
}

function comparisonSymbol(c: string): string {
  return COMPARISONS.find((x) => x.value === c)?.symbol ?? c
}

function fmtThreshold(metric: string, t: number): string {
  const unit = metricMeta(metric).unit
  if (unit === 'pct') return `${t}%`
  return t.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

type FormState = {
  senderId: string
  segmentId: string
  metric: string
  comparison: string
  threshold: string
  enabled: boolean
}

const emptyForm: FormState = {
  senderId: '',
  segmentId: '',
  metric: 'complaint_rate',
  comparison: 'gt',
  threshold: '0.3',
  enabled: true,
}

export default function AlertRulesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [senders, setSenders] = useState<Sender[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [notice, setNotice] = useState<string>('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AlertRule | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string>('')
  const [busyId, setBusyId] = useState<string>('')
  const [confirmDelete, setConfirmDelete] = useState<AlertRule | null>(null)

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

  const load = useCallback(async (wsId: string) => {
    if (!wsId) return
    setLoading(true)
    setError('')
    try {
      const [snd, seg, rls] = await Promise.all([
        api.listSenders(wsId),
        api.listSegments(wsId),
        api.listAlertRules(wsId),
      ])
      setSenders(Array.isArray(snd) ? snd : [])
      setSegments(Array.isArray(seg) ? seg : [])
      setRules(Array.isArray(rls) ? rls : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alert rules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) load(workspaceId)
  }, [workspaceId, load])

  const onSelectWorkspace = (id: string) => {
    setWorkspaceId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, id)
  }

  const senderName = useCallback(
    (id?: string | null) => {
      if (!id) return null
      const s = senders.find((x) => x.id === id)
      return s ? s.friendly_name ?? s.domain ?? id.slice(0, 8) : id.slice(0, 8)
    },
    [senders],
  )
  const segmentName = useCallback(
    (id?: string | null) => {
      if (!id) return null
      const s = segments.find((x) => x.id === id)
      return s ? s.name : id.slice(0, 8)
    },
    [segments],
  )

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setModalOpen(true)
  }

  const openEdit = (r: AlertRule) => {
    setEditing(r)
    setForm({
      senderId: r.sender_id ?? '',
      segmentId: r.segment_id ?? '',
      metric: r.metric,
      comparison: r.comparison,
      threshold: String(r.threshold),
      enabled: r.enabled,
    })
    setFormError('')
    setModalOpen(true)
  }

  const submit = async () => {
    setFormError('')
    const thresholdNum = Number(form.threshold)
    if (Number.isNaN(thresholdNum)) {
      setFormError('Threshold must be a number.')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        // Update: threshold, comparison, enabled (metric/scope kept stable per backend contract)
        await api.updateAlertRule(editing.id, {
          threshold: thresholdNum,
          comparison: form.comparison,
          enabled: form.enabled,
        })
        setNotice('Rule updated.')
      } else {
        await api.createAlertRule({
          workspaceId,
          senderId: form.senderId || undefined,
          segmentId: form.segmentId || undefined,
          metric: form.metric,
          comparison: form.comparison,
          threshold: thresholdNum,
          enabled: form.enabled,
        })
        setNotice('Rule created.')
      }
      setModalOpen(false)
      await load(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (r: AlertRule) => {
    setBusyId(r.id)
    setError('')
    try {
      await api.updateAlertRule(r.id, { enabled: !r.enabled })
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toggle failed')
    } finally {
      setBusyId('')
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setBusyId(confirmDelete.id)
    setError('')
    try {
      await api.deleteAlertRule(confirmDelete.id)
      setConfirmDelete(null)
      setNotice('Rule deleted.')
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId('')
    }
  }

  const enabledCount = useMemo(() => rules.filter((r) => r.enabled).length, [rules])

  if (loading && rules.length === 0 && !error) {
    return <PageLoader label="Loading alert rules..." />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Alert Rules</h1>
          <p className="mt-1 text-sm text-slate-500">
            Define thresholds the scanner evaluates against sender and segment metrics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workspaces.length > 0 && (
            <select
              value={workspaceId}
              onChange={(e) => onSelectWorkspace(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" onClick={openCreate} disabled={!workspaceId}>
            New rule
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
          description="Create a workspace from the dashboard to configure alert rules."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Total rules" value={rules.length} tone="sky" />
            <Stat label="Enabled" value={enabledCount} tone="green" />
            <Stat label="Disabled" value={rules.length - enabledCount} tone="amber" />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Configured Rules</h2>
            </CardHeader>
            <CardBody className="p-0">
              {rules.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState
                    title="No alert rules"
                    description="Create your first rule to start detecting deliverability degradation."
                    action={
                      <Button variant="secondary" onClick={openCreate}>
                        New rule
                      </Button>
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Metric</TH>
                      <TH>Condition</TH>
                      <TH>Scope</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rules.map((r) => (
                      <TR key={r.id}>
                        <TD className="font-medium text-slate-200">{metricMeta(r.metric).label}</TD>
                        <TD>
                          <span className="font-mono text-slate-300">
                            {comparisonSymbol(r.comparison)} {fmtThreshold(r.metric, r.threshold)}
                          </span>
                        </TD>
                        <TD className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {r.sender_id ? (
                              <Badge tone="sky">{senderName(r.sender_id)}</Badge>
                            ) : (
                              <Badge tone="slate">All senders</Badge>
                            )}
                            {r.segment_id && <Badge tone="neutral">{segmentName(r.segment_id)}</Badge>}
                          </div>
                        </TD>
                        <TD>
                          {r.enabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="slate">Disabled</Badge>}
                        </TD>
                        <TD>
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" onClick={() => toggleEnabled(r)} disabled={busyId === r.id}>
                              {r.enabled ? 'Disable' : 'Enable'}
                            </Button>
                            <Button variant="secondary" onClick={() => openEdit(r)} disabled={busyId === r.id}>
                              Edit
                            </Button>
                            <Button variant="danger" onClick={() => setConfirmDelete(r)} disabled={busyId === r.id}>
                              Delete
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {/* Create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit alert rule' : 'New alert rule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Metric</label>
            <select
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value })}
              disabled={!!editing}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none disabled:opacity-60"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {editing && <p className="mt-1 text-xs text-slate-600">Metric and scope are fixed after creation.</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Comparison</label>
              <select
                value={form.comparison}
                onChange={(e) => setForm({ ...form, comparison: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                {COMPARISONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.symbol} {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Threshold {metricMeta(form.metric).unit === 'pct' ? '(%)' : ''}
              </label>
              <input
                type="number"
                step="any"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Sender (optional)
                </label>
                <select
                  value={form.senderId}
                  onChange={(e) => setForm({ ...form, senderId: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  <option value="">All senders</option>
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.friendly_name ?? s.domain ?? s.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Segment (optional)
                </label>
                <select
                  value={form.segmentId}
                  onChange={(e) => setForm({ ...form, segmentId: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  <option value="">All segments</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500"
            />
            Rule enabled
          </label>

          <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
            Triggers when{' '}
            <span className="font-medium text-slate-200">{metricMeta(form.metric).label}</span>{' '}
            <span className="font-mono text-slate-200">{comparisonSymbol(form.comparison)}</span>{' '}
            <span className="font-medium text-slate-200">
              {fmtThreshold(form.metric, Number(form.threshold) || 0)}
            </span>
            .
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete alert rule"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={busyId === confirmDelete?.id}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doDelete} disabled={busyId === confirmDelete?.id}>
              {busyId === confirmDelete?.id ? 'Deleting...' : 'Delete rule'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-400">
          This will permanently delete the{' '}
          <span className="font-medium text-slate-200">
            {confirmDelete ? metricMeta(confirmDelete.metric).label : ''}
          </span>{' '}
          rule. Alerts already triggered by it are retained.
        </p>
      </Modal>
    </div>
  )
}
