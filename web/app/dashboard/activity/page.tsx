'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'edrg.workspaceId'
const PAGE_SIZE = 25

type Workspace = { id: string; name: string }
type Activity = {
  id: string
  user_id?: string
  userId?: string
  action?: string
  entity_type?: string
  entityType?: string
  entity_id?: string
  entityId?: string
  detail?: Record<string, unknown> | null
  created_at?: string
  createdAt?: string
}

function fmtDateTime(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function actionTone(action?: string): 'green' | 'sky' | 'amber' | 'rose' | 'slate' {
  const a = (action || '').toLowerCase()
  if (a.includes('delete') || a.includes('remove') || a.includes('archive')) return 'rose'
  if (a.includes('create') || a.includes('add') || a.includes('invite') || a.includes('import')) return 'green'
  if (a.includes('update') || a.includes('edit') || a.includes('rename') || a.includes('compute') || a.includes('generate')) return 'sky'
  if (a.includes('dismiss') || a.includes('resolve') || a.includes('ack')) return 'amber'
  return 'slate'
}

function entityType(a: Activity) {
  return a.entity_type || a.entityType || ''
}
function entityId(a: Activity) {
  return a.entity_id || a.entityId || ''
}
function actorId(a: Activity) {
  return a.user_id || a.userId || ''
}

function detailSummary(detail: Activity['detail']): string {
  if (!detail || typeof detail !== 'object') return ''
  const parts = Object.entries(detail)
    .slice(0, 4)
    .map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return `${k}: ${val.length > 40 ? val.slice(0, 40) + '…' : val}`
    })
  return parts.join('  •  ')
}

export default function ActivityPage() {
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [entries, setEntries] = useState<Activity[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [entityFilter, setEntityFilter] = useState('all')
  const [search, setSearch] = useState('')

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
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async (wsId: string, pageIndex: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await api.listActivity({ workspaceId: wsId, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE })
      setEntries(res?.entries ?? [])
      setTotal(typeof res?.total === 'number' ? res.total : (res?.entries?.length ?? 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity')
      setEntries([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) {
      if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, workspaceId)
      setPage(0)
      load(workspaceId, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => {
    if (workspaceId) load(workspaceId, page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const actionOptions = useMemo(() => {
    const set = new Set<string>()
    entries.forEach((e) => e.action && set.add(e.action))
    return Array.from(set).sort()
  }, [entries])

  const entityOptions = useMemo(() => {
    const set = new Set<string>()
    entries.forEach((e) => {
      const t = entityType(e)
      if (t) set.add(t)
    })
    return Array.from(set).sort()
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (actionFilter !== 'all' && e.action !== actionFilter) return false
      if (entityFilter !== 'all' && entityType(e) !== entityFilter) return false
      if (q) {
        const hay = `${e.action || ''} ${entityType(e)} ${entityId(e)} ${actorId(e)} ${detailSummary(e.detail)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, actionFilter, entityFilter, search])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading activity..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Activity Log</h1>
          <p className="mt-1 text-sm text-stone-400">
            A chronological audit trail of every change made across this workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {workspaces.length > 1 && (
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={() => workspaceId && load(workspaceId, page)} disabled={loading || !workspaceId}>
            {loading ? (
              <>
                <Spinner className="mr-2 h-4 w-4" /> Refreshing
              </>
            ) : (
              'Refresh'
            )}
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {!loading && workspaceId && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Total events" value={total.toLocaleString()} />
          <Stat label="On this page" value={entries.length.toLocaleString()} tone="sky" />
          <Stat label="Distinct actions" value={actionOptions.length.toLocaleString()} tone="green" />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
            >
              <option value="all">All actions</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
            >
              <option value="all">All entities</option>
              {entityOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, entity, actor..."
            className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-rose-500 focus:outline-none lg:w-72"
          />
        </CardHeader>
        <CardBody className="px-0 py-0">
          {loading ? (
            <div className="px-5 py-10">
              <PageLoader label="Loading activity..." />
            </div>
          ) : !workspaceId ? (
            <div className="px-5 py-8">
              <EmptyState title="No workspace yet" description="Create a workspace from the dashboard to start logging activity." />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title={entries.length === 0 ? 'No activity yet' : 'Nothing matches'}
                description={
                  entries.length === 0
                    ? 'Actions like creating senders, running scans, and importing data will appear here.'
                    : 'Adjust the filters or search to see more entries.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Actor</TH>
                  <TH>Detail</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap text-stone-400">{fmtDateTime(e.created_at || e.createdAt)}</TD>
                    <TD>
                      <Badge tone={actionTone(e.action)}>{e.action || '—'}</Badge>
                    </TD>
                    <TD>
                      {entityType(e) ? (
                        <span className="text-stone-300">
                          {entityType(e)}
                          {entityId(e) && (
                            <span className="ml-1 font-mono text-xs text-stone-600">{entityId(e).slice(0, 8)}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-stone-600">—</span>
                      )}
                    </TD>
                    <TD className="font-mono text-xs text-stone-500">{actorId(e) ? actorId(e).slice(0, 12) : '—'}</TD>
                    <TD className="max-w-md text-xs text-stone-500">
                      <span className="block max-w-md truncate" title={detailSummary(e.detail)}>{detailSummary(e.detail) || '—'}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
        {!loading && workspaceId && total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-stone-800 px-5 py-3 text-sm text-stone-400">
            <span>
              Page {page + 1} of {totalPages} · {total.toLocaleString()} events
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                Previous
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
