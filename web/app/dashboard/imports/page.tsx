'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ImportJob {
  id: string
  workspace_id: string
  sender_id: string | null
  source: string | null
  status: string | null
  filename: string | null
  column_mapping?: Record<string, string> | null
  rows_total: number | null
  rows_imported: number | null
  rows_failed: number | null
  errors?: unknown
  is_sample: boolean | null
  created_by?: string | null
  created_at: string | null
}

interface Workspace {
  id: string
  name: string
}

const WS_KEY = 'activeWorkspaceId'

function statusTone(status: string | null): 'sky' | 'green' | 'amber' | 'rose' | 'slate' {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
    case 'complete':
    case 'done':
    case 'succeeded':
      return 'green'
    case 'processing':
    case 'running':
    case 'pending':
    case 'queued':
      return 'sky'
    case 'partial':
      return 'amber'
    case 'failed':
    case 'error':
      return 'rose'
    default:
      return 'slate'
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ImportsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [imports, setImports] = useState<ImportJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [seeding, setSeeding] = useState(false)
  const [deleting, setDeleting] = useState<ImportJob | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Resolve active workspace.
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        if (stored) {
          if (active) setWorkspaceId(stored)
          return
        }
        const list: Workspace[] = await api.listWorkspaces()
        if (!active) return
        if (Array.isArray(list) && list.length > 0) {
          window.localStorage.setItem(WS_KEY, list[0].id)
          setWorkspaceId(list[0].id)
        } else {
          setWorkspaceId('')
          setLoading(false)
        }
      } catch (e) {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Failed to resolve workspace')
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const load = useMemo(
    () => async (wsId: string) => {
      setLoading(true)
      setError(null)
      try {
        const rows: ImportJob[] = await api.listImports(wsId)
        setImports(Array.isArray(rows) ? rows : [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load imports')
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (workspaceId) load(workspaceId)
  }, [workspaceId, load])

  const handleSeed = async () => {
    if (!workspaceId) return
    setSeeding(true)
    setActionError(null)
    try {
      await api.seedSample(workspaceId)
      await load(workspaceId)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setActionError(null)
    try {
      await api.deleteImport(deleting.id)
      setImports((prev) => prev.filter((i) => i.id !== deleting.id))
      setDeleting(null)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete import')
    } finally {
      setDeleteBusy(false)
    }
  }

  const statuses = useMemo(() => {
    const set = new Set<string>()
    imports.forEach((i) => i.status && set.add(i.status))
    return Array.from(set).sort()
  }, [imports])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return imports.filter((i) => {
      if (statusFilter !== 'all' && (i.status ?? '') !== statusFilter) return false
      if (!q) return true
      return (
        (i.filename ?? '').toLowerCase().includes(q) ||
        (i.source ?? '').toLowerCase().includes(q) ||
        (i.status ?? '').toLowerCase().includes(q)
      )
    })
  }, [imports, search, statusFilter])

  const totals = useMemo(() => {
    return imports.reduce(
      (acc, i) => {
        acc.jobs += 1
        acc.imported += i.rows_imported ?? 0
        acc.failed += i.rows_failed ?? 0
        if (statusTone(i.status) === 'green') acc.completed += 1
        return acc
      },
      { jobs: 0, imported: 0, failed: 0, completed: 0 }
    )
  }, [imports])

  if (loading && imports.length === 0) {
    return <PageLoader label="Loading import jobs..." />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Imports</h1>
          <p className="mt-1 text-sm text-stone-500">
            Upload ESP exports or seed sample data to populate send events, campaigns, and recipients.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleSeed} disabled={seeding || !workspaceId}>
            {seeding ? (
              <span className="flex items-center gap-2">
                <Spinner className="h-4 w-4" /> Seeding...
              </span>
            ) : (
              'Seed sample data'
            )}
          </Button>
          <Link href="/dashboard/imports/new">
            <Button variant="primary">New import</Button>
          </Link>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{actionError}</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Import jobs" value={totals.jobs} />
        <Stat label="Completed" value={totals.completed} tone="green" />
        <Stat label="Rows imported" value={totals.imported.toLocaleString()} tone="sky" />
        <Stat label="Rows failed" value={totals.failed.toLocaleString()} tone={totals.failed > 0 ? 'rose' : 'default'} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-stone-200">Import history</span>
            <Badge tone="slate">{filtered.length}</Badge>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search filename, source..."
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-rose-500 focus:outline-none sm:w-56"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={imports.length === 0 ? 'No imports yet' : 'No imports match your filters'}
                description={
                  imports.length === 0
                    ? 'Seed sample data to explore the platform, or start a new import from an ESP export.'
                    : 'Try clearing the search or status filter.'
                }
                action={
                  imports.length === 0 ? (
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" onClick={handleSeed} disabled={seeding}>
                        {seeding ? 'Seeding...' : 'Seed sample data'}
                      </Button>
                      <Link href="/dashboard/imports/new">
                        <Button variant="primary">New import</Button>
                      </Link>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSearch('')
                        setStatusFilter('all')
                      }}
                    >
                      Clear filters
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Source / File</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Imported</TH>
                  <TH className="text-right">Failed</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((job) => {
                  const total = job.rows_total ?? 0
                  const imported = job.rows_imported ?? 0
                  const pct = total > 0 ? Math.round((imported / total) * 100) : 0
                  return (
                    <TR key={job.id}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-stone-200">{job.filename || job.source || 'Untitled import'}</span>
                          {job.is_sample && <Badge tone="sky">sample</Badge>}
                        </div>
                        <div className="text-xs text-stone-500">{job.source || 'manual upload'}</div>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(job.status)}>{job.status || 'unknown'}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{total.toLocaleString()}</TD>
                      <TD className="text-right">
                        <div className="tabular-nums text-stone-200">{imported.toLocaleString()}</div>
                        {total > 0 && (
                          <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-stone-800">
                            <div className="h-full rounded-full bg-rose-500" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">
                        <span className={job.rows_failed ? 'text-rose-300' : 'text-stone-500'}>
                          {(job.rows_failed ?? 0).toLocaleString()}
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-stone-400">{fmtDate(job.created_at)}</TD>
                      <TD className="text-right">
                        <Button variant="ghost" className="text-rose-300 hover:bg-rose-500/10" onClick={() => setDeleting(job)}>
                          Delete
                        </Button>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={deleting !== null}
        onClose={() => (deleteBusy ? null : setDeleting(null))}
        title="Delete import"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting...' : 'Delete import'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-stone-300">
          Delete <span className="font-medium text-white">{deleting?.filename || deleting?.source || 'this import'}</span>? All
          send events created by this import will also be removed. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
