'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'edrg.workspaceId'

type Workspace = { id: string; name: string }
type Report = {
  id: string
  name: string
  kind?: string
  config?: Record<string, unknown> | null
  schedule?: string | null
  last_rendered_at?: string | null
  lastRenderedAt?: string | null
  output?: unknown
  created_at?: string
  createdAt?: string
}

const KINDS: { value: string; label: string; description: string }[] = [
  { value: 'placement_summary', label: 'Placement summary', description: 'Inbox-placement proxy scores across senders.' },
  { value: 'list_health', label: 'List health', description: 'Active vs dormant, role accounts and suppression candidates.' },
  { value: 'revenue_at_risk', label: 'Revenue at risk', description: 'Dollar exposure broken down by cause and contributor.' },
  { value: 'suppression', label: 'Suppression', description: 'Recommended suppressions with reasons and impact.' },
  { value: 'alerts', label: 'Alerts', description: 'Complaint/unsubscribe/bounce spike alert history.' },
  { value: 'deliverability_overview', label: 'Deliverability overview', description: 'Placement, complaint and bounce trends across senders.' },
]
const SCHEDULES = [
  { value: '', label: 'Manual only' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

function kindLabel(k?: string) {
  return KINDS.find((x) => x.value === k)?.label || (k ? k.replace(/_/g, ' ') : 'Custom')
}
function fmtDateTime(s?: string | null) {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function lastRendered(r: Report) {
  return r.last_rendered_at || r.lastRenderedAt || null
}

export default function ReportsPage() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', kind: 'deliverability', schedule: '' })
  const [saving, setSaving] = useState(false)

  const [renderingId, setRenderingId] = useState<string>('')
  const [deletingId, setDeletingId] = useState<string>('')
  const [viewReport, setViewReport] = useState<Report | null>(null)

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
      const res: Report[] = (await api.listReports(wsId)) || []
      setReports(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
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

  const create = async () => {
    if (!workspaceId || !form.name.trim()) return
    setSaving(true)
    setError('')
    try {
      const kindMeta = KINDS.find((k) => k.value === form.kind)
      await api.createReport({
        workspaceId,
        name: form.name.trim(),
        kind: form.kind,
        schedule: form.schedule || null,
        config: { kind: form.kind, description: kindMeta?.description },
      })
      setCreateOpen(false)
      setForm({ name: '', kind: 'deliverability', schedule: '' })
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create report')
    } finally {
      setSaving(false)
    }
  }

  const render = async (r: Report) => {
    setRenderingId(r.id)
    setError('')
    try {
      const updated: Report = await api.renderReport(r.id)
      setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...updated } : x)))
      setViewReport((prev) => (prev && prev.id === r.id ? { ...prev, ...updated } : prev))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to render report')
    } finally {
      setRenderingId('')
    }
  }

  const remove = async (r: Report) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete report "${r.name}"? This cannot be undone.`)) return
    setDeletingId(r.id)
    setError('')
    try {
      await api.deleteReport(r.id)
      setReports((prev) => prev.filter((x) => x.id !== r.id))
      if (viewReport?.id === r.id) setViewReport(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete report')
    } finally {
      setDeletingId('')
    }
  }

  const exportReport = (r: Report) => {
    if (r.output == null) return
    const blob = new Blob([JSON.stringify(r.output, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${r.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'report'}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports.filter((r) => {
      if (kindFilter && (r.kind || '') !== kindFilter) return false
      if (q && !`${r.name} ${kindLabel(r.kind)}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [reports, search, kindFilter])

  const renderedCount = useMemo(() => reports.filter((r) => lastRendered(r)).length, [reports])
  const scheduledCount = useMemo(() => reports.filter((r) => r.schedule).length, [reports])
  const kindsPresent = useMemo(() => Array.from(new Set(reports.map((r) => r.kind).filter(Boolean))) as string[], [reports])

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading reports..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Reports</h1>
          <p className="mt-1 text-sm text-slate-400">
            Saved report definitions — render on demand or on a schedule, then export the JSON bundle for sharing.
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
          <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>New report</Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading reports..." />
      ) : !workspaceId ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace from the dashboard to start saving reports."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Saved reports" value={reports.length} tone="sky" />
            <Stat label="Rendered" value={renderedCount} tone="green" hint={`${reports.length - renderedCount} never rendered`} />
            <Stat label="Scheduled" value={scheduledCount} tone="amber" hint="Auto-rendered on a cadence" />
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-semibold text-white">Saved reports</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search reports..."
                  className="w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                />
                <select
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  <option value="">All kinds</option>
                  {KINDS.filter((k) => kindsPresent.includes(k.value)).map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {reports.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    title="No reports yet"
                    description="Create a report definition to capture deliverability, revenue-at-risk, or executive summaries."
                    action={<Button onClick={() => setCreateOpen(true)}>New report</Button>}
                  />
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500">No reports match your filters.</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Kind</TH>
                      <TH>Schedule</TH>
                      <TH>Last rendered</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => {
                      const rendered = lastRendered(r)
                      return (
                        <TR key={r.id}>
                          <TD>
                            <button onClick={() => setViewReport(r)} className="font-medium text-slate-100 hover:text-sky-300">
                              {r.name}
                            </button>
                          </TD>
                          <TD><Badge tone="sky">{kindLabel(r.kind)}</Badge></TD>
                          <TD>{r.schedule ? <Badge tone="amber">{r.schedule}</Badge> : <span className="text-slate-600">Manual</span>}</TD>
                          <TD>{rendered ? <span className="text-slate-300">{fmtDateTime(rendered)}</span> : <span className="text-slate-600">Never</span>}</TD>
                          <TD className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => render(r)} disabled={renderingId === r.id}>
                                {renderingId === r.id ? <><Spinner className="mr-1.5 h-3.5 w-3.5" /> Rendering</> : 'Render'}
                              </Button>
                              <Button
                                variant="ghost"
                                className="px-3 py-1.5 text-xs"
                                onClick={() => exportReport(r)}
                                disabled={r.output == null}
                                title={r.output == null ? 'Render the report first' : 'Export JSON'}
                              >
                                Export
                              </Button>
                              <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => remove(r)} disabled={deletingId === r.id}>
                                {deletingId === r.id ? '...' : 'Delete'}
                              </Button>
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

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New report"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={create} disabled={saving || !form.name.trim()}>
              {saving ? <><Spinner className="mr-2 h-4 w-4" /> Creating</> : 'Create report'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Q3 deliverability review"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Kind</label>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-500">{KINDS.find((k) => k.value === form.kind)?.description}</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Schedule</label>
            <select
              value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              {SCHEDULES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!viewReport}
        onClose={() => setViewReport(null)}
        title={viewReport?.name}
        className="max-w-2xl"
        footer={
          viewReport && (
            <>
              <Button variant="secondary" onClick={() => render(viewReport)} disabled={renderingId === viewReport.id}>
                {renderingId === viewReport.id ? <><Spinner className="mr-2 h-4 w-4" /> Rendering</> : 'Re-render'}
              </Button>
              <Button onClick={() => exportReport(viewReport)} disabled={viewReport.output == null}>Export JSON</Button>
            </>
          )
        }
      >
        {viewReport && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="sky">{kindLabel(viewReport.kind)}</Badge>
              {viewReport.schedule && <Badge tone="amber">{viewReport.schedule}</Badge>}
              <Badge tone={lastRendered(viewReport) ? 'green' : 'slate'}>
                {lastRendered(viewReport) ? `Rendered ${fmtDateTime(lastRendered(viewReport))}` : 'Not rendered'}
              </Badge>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Output</div>
              {viewReport.output == null ? (
                <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/60 px-4 py-6 text-center text-sm text-slate-500">
                  No output yet. Render this report to generate its payload.
                </div>
              ) : (
                <pre className="max-h-80 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300">
                  {JSON.stringify(viewReport.output, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
