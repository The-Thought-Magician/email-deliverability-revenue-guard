'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader, Spinner } from '@/components/ui/Spinner'

const WS_KEY = 'edrg.workspaceId'

type Workspace = { id: string; name: string }
type Notification = {
  id: string
  kind?: string
  title?: string
  body?: string
  link?: string
  read?: boolean
  created_at?: string
  createdAt?: string
}

type Filter = 'all' | 'unread' | 'read'

function fmtDateTime(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function relTime(s?: string) {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return fmtDateTime(s)
}

function kindTone(kind?: string): 'sky' | 'green' | 'amber' | 'rose' | 'slate' {
  const k = (kind || '').toLowerCase()
  if (k.includes('alert') || k.includes('risk') || k.includes('error') || k.includes('critical')) return 'rose'
  if (k.includes('warn') || k.includes('fatigue') || k.includes('suppress')) return 'amber'
  if (k.includes('success') || k.includes('complete') || k.includes('done') || k.includes('import')) return 'green'
  if (k.includes('info') || k.includes('report') || k.includes('scorecard')) return 'sky'
  return 'slate'
}

function isRead(n: Notification) {
  return n.read === true
}

export default function NotificationsPage() {
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string>('')
  const [markingAll, setMarkingAll] = useState(false)

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

  const load = useCallback(async (wsId: string) => {
    setLoading(true)
    setError('')
    try {
      const list: Notification[] = (await api.listNotifications(wsId)) || []
      setItems(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
      setItems([])
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

  const markRead = async (id: string) => {
    setBusyId(id)
    setError('')
    try {
      await api.markNotificationRead(id)
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark notification read')
    } finally {
      setBusyId('')
    }
  }

  const markAll = async () => {
    if (!workspaceId) return
    setMarkingAll(true)
    setError('')
    try {
      await api.markAllNotificationsRead({ workspaceId })
      setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all read')
    } finally {
      setMarkingAll(false)
    }
  }

  const unreadCount = useMemo(() => items.filter((n) => !isRead(n)).length, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((n) => {
        if (filter === 'unread' && isRead(n)) return false
        if (filter === 'read' && !isRead(n)) return false
        return true
      })
      .filter((n) => {
        if (!q) return true
        return (
          (n.title || '').toLowerCase().includes(q) ||
          (n.body || '').toLowerCase().includes(q) ||
          (n.kind || '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const ta = new Date(a.created_at || a.createdAt || 0).getTime()
        const tb = new Date(b.created_at || b.createdAt || 0).getTime()
        return tb - ta
      })
  }, [items, filter, search])

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading notifications..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Notifications</h1>
          <p className="mt-1 text-sm text-slate-400">
            Deliverability alerts, import results, and revenue signals delivered to your inbox.
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
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={markAll} disabled={markingAll || unreadCount === 0}>
            {markingAll ? (
              <>
                <Spinner className="mr-2 h-4 w-4" /> Marking
              </>
            ) : (
              `Mark all read${unreadCount ? ` (${unreadCount})` : ''}`
            )}
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {!loading && workspaceId && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Total" value={items.length.toLocaleString()} />
          <Stat label="Unread" value={unreadCount.toLocaleString()} tone={unreadCount > 0 ? 'sky' : 'default'} />
          <Stat
            label="Read"
            value={(items.length - unreadCount).toLocaleString()}
            tone="green"
          />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
            {(['all', 'unread', 'read'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  filter === f ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notifications..."
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none sm:w-64"
          />
        </CardHeader>
        <CardBody className="px-0 py-0">
          {loading ? (
            <div className="px-5 py-10">
              <PageLoader label="Loading notifications..." />
            </div>
          ) : !workspaceId ? (
            <div className="px-5 py-8">
              <EmptyState title="No workspace yet" description="Create a workspace from the dashboard to receive notifications." />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title={items.length === 0 ? 'No notifications yet' : 'Nothing matches'}
                description={
                  items.length === 0
                    ? 'Alerts, imports, and scorecard updates will land here as they happen.'
                    : 'Try a different filter or search term.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {filtered.map((n) => {
                const read = isRead(n)
                return (
                  <li
                    key={n.id}
                    className={`flex items-start gap-4 px-5 py-4 transition-colors hover:bg-slate-900/50 ${
                      read ? '' : 'bg-sky-500/[0.04]'
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${read ? 'bg-slate-700' : 'bg-sky-400'}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {n.kind && <Badge tone={kindTone(n.kind)}>{n.kind}</Badge>}
                        <span className={`text-sm font-semibold ${read ? 'text-slate-300' : 'text-white'}`}>
                          {n.title || 'Notification'}
                        </span>
                        <span className="text-xs text-slate-600">{relTime(n.created_at || n.createdAt)}</span>
                      </div>
                      {n.body && <p className="mt-1 text-sm text-slate-400">{n.body}</p>}
                      {n.link && (
                        <a
                          href={n.link}
                          className="mt-1 inline-block text-xs font-medium text-sky-400 hover:text-sky-300"
                        >
                          View details →
                        </a>
                      )}
                    </div>
                    {!read && (
                      <button
                        onClick={() => markRead(n.id)}
                        disabled={busyId === n.id}
                        className="flex-shrink-0 text-xs font-medium text-slate-500 hover:text-sky-300 disabled:opacity-50"
                      >
                        {busyId === n.id ? 'Marking...' : 'Mark read'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
