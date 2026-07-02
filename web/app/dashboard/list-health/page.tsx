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

type Workspace = { id: string; name: string }
type Sender = { id: string; domain?: string; friendly_name?: string; friendlyName?: string }
type Snapshot = {
  id: string
  sender_id?: string
  senderId?: string
  snapshot_at?: string
  snapshotAt?: string
  grade?: string
  active_count?: number
  activeCount?: number
  dormant_count?: number
  dormantCount?: number
  role_account_count?: number
  roleAccountCount?: number
  hard_bounce_rate?: number
  hardBounceRate?: number
  soft_bounce_rate?: number
  softBounceRate?: number
  drivers?: Array<{ label?: string; reason?: string; detail?: string; impact?: string }> | Record<string, unknown> | null
}

function senderName(s?: Sender) {
  if (!s) return 'Unknown sender'
  return s.friendly_name || s.friendlyName || s.domain || s.id
}
function num(...vals: (number | undefined)[]) {
  for (const v of vals) if (typeof v === 'number' && !Number.isNaN(v)) return v
  return undefined
}
function ratePct(v?: number) {
  if (typeof v !== 'number') return '—'
  const n = v <= 1 ? v * 100 : v
  return `${n.toFixed(2)}%`
}
function gradeTone(g?: string): 'green' | 'sky' | 'amber' | 'rose' | 'slate' {
  if (!g) return 'slate'
  const u = g.toUpperCase()
  if (u.startsWith('A')) return 'green'
  if (u.startsWith('B')) return 'sky'
  if (u.startsWith('C')) return 'amber'
  return 'rose'
}
function fmtDateTime(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function driverList(drivers: Snapshot['drivers']): Array<{ label: string; detail?: string }> {
  if (!drivers) return []
  if (Array.isArray(drivers)) {
    return drivers.map((d) => ({
      label: d.label || d.reason || 'Driver',
      detail: d.detail || d.impact,
    }))
  }
  return Object.entries(drivers).map(([k, v]) => ({ label: k, detail: String(v) }))
}

export default function ListHealthPage() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [selectedSender, setSelectedSender] = useState<string>('')
  const [latest, setLatest] = useState<Snapshot | null>(null)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string>('')

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

  const loadHealth = useCallback(async (wsId: string, senderId: string) => {
    if (!senderId) {
      setLatest(null)
      setHistory([])
      return
    }
    try {
      const res = await api.getListHealth(wsId, senderId)
      setLatest(res?.latest ?? null)
      setHistory(res?.history ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load list health')
      setLatest(null)
      setHistory([])
    }
  }, [])

  const loadSenders = useCallback(async (wsId: string) => {
    setLoading(true)
    setError('')
    try {
      const sList: Sender[] = (await api.listSenders(wsId)) || []
      setSenders(sList)
      const effective = sList[0]?.id ?? ''
      setSelectedSender(effective)
      await loadHealth(wsId, effective)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load senders')
    } finally {
      setLoading(false)
    }
  }, [loadHealth])

  useEffect(() => {
    if (workspaceId) {
      if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, workspaceId)
      loadSenders(workspaceId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const onSenderChange = async (id: string) => {
    setSelectedSender(id)
    setLoading(true)
    setError('')
    await loadHealth(workspaceId, id)
    setLoading(false)
  }

  const compute = async () => {
    if (!workspaceId || !selectedSender) return
    setComputing(true)
    setError('')
    try {
      await api.computeListHealth({ workspaceId, senderId: selectedSender })
      await loadHealth(workspaceId, selectedSender)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compute snapshot')
    } finally {
      setComputing(false)
    }
  }

  const senderById = useMemo(() => new Map(senders.map((s) => [s.id, s])), [senders])
  const drivers = useMemo(() => driverList(latest?.drivers), [latest])

  const totalRecipients = latest
    ? (num(latest.active_count, latest.activeCount) ?? 0) +
      (num(latest.dormant_count, latest.dormantCount) ?? 0)
    : 0
  const activePct = latest && totalRecipients > 0
    ? (((num(latest.active_count, latest.activeCount) ?? 0) / totalRecipients) * 100)
    : 0

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading list health..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">List Health Ledger</h1>
          <p className="mt-1 text-sm text-stone-400">
            Active vs dormant balance, role accounts, and bounce pressure with a graded snapshot history.
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
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
          <select
            value={selectedSender}
            onChange={(e) => onSenderChange(e.target.value)}
            disabled={senders.length === 0}
            className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none disabled:opacity-50"
          >
            {senders.length === 0 && <option value="">No senders</option>}
            {senders.map((s) => (
              <option key={s.id} value={s.id}>{senderName(s)}</option>
            ))}
          </select>
          <Button onClick={compute} disabled={!selectedSender || computing}>
            {computing ? <><Spinner className="mr-2 h-4 w-4" /> Computing</> : 'Compute snapshot'}
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading list health..." />
      ) : !workspaceId ? (
        <EmptyState title="No workspace yet" description="Create a workspace from the dashboard to track list health." />
      ) : senders.length === 0 ? (
        <EmptyState title="No senders configured" description="Add a sender and import recipients to compute a list-health snapshot." />
      ) : !latest ? (
        <EmptyState
          title="No snapshot yet"
          description={`Compute a list-health snapshot for ${senderName(senderById.get(selectedSender))} to populate the ledger.`}
          action={<Button onClick={compute} disabled={computing}>{computing ? 'Computing...' : 'Compute snapshot'}</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Health grade"
              value={<Badge tone={gradeTone(latest.grade)}>{latest.grade || '—'}</Badge>}
              hint={`As of ${fmtDateTime(latest.snapshot_at || latest.snapshotAt)}`}
            />
            <Stat
              label="Active recipients"
              value={(num(latest.active_count, latest.activeCount) ?? 0).toLocaleString()}
              tone="green"
              hint={`${activePct.toFixed(1)}% of mailable`}
            />
            <Stat
              label="Dormant"
              value={(num(latest.dormant_count, latest.dormantCount) ?? 0).toLocaleString()}
              tone="amber"
              hint="No engagement in window"
            />
            <Stat
              label="Role accounts"
              value={(num(latest.role_account_count, latest.roleAccountCount) ?? 0).toLocaleString()}
              tone="rose"
              hint="info@, support@, etc."
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <h2 className="text-base font-semibold text-white">Bounce pressure</h2>
              </CardHeader>
              <CardBody className="space-y-4">
                <BounceBar label="Hard bounce rate" value={num(latest.hard_bounce_rate, latest.hardBounceRate)} tone="rose" />
                <BounceBar label="Soft bounce rate" value={num(latest.soft_bounce_rate, latest.softBounceRate)} tone="amber" />
                <div className="pt-2">
                  <div className="mb-1 flex justify-between text-xs text-stone-500">
                    <span>Active</span><span>Dormant</span>
                  </div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-stone-800">
                    <div className="bg-emerald-500" style={{ width: `${activePct}%` }} />
                    <div className="bg-amber-500/70" style={{ width: `${100 - activePct}%` }} />
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <h2 className="text-base font-semibold text-white">Grade drivers</h2>
              </CardHeader>
              <CardBody>
                {drivers.length === 0 ? (
                  <p className="text-sm text-stone-500">No specific drivers recorded for this snapshot.</p>
                ) : (
                  <ul className="space-y-3">
                    {drivers.map((d, i) => (
                      <li key={i} className="flex items-start gap-3 rounded-lg border border-stone-800 bg-stone-900/40 px-4 py-3">
                        <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-rose-400" />
                        <div>
                          <div className="text-sm font-medium text-stone-200">{d.label}</div>
                          {d.detail && <div className="text-xs text-stone-500">{d.detail}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Snapshot history</h2>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {history.length === 0 ? (
                <div className="px-5 py-8 text-sm text-stone-500">Only one snapshot so far. Compute again over time to build trend history.</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Taken</TH>
                      <TH>Grade</TH>
                      <TH className="text-right">Active</TH>
                      <TH className="text-right">Dormant</TH>
                      <TH className="text-right">Role</TH>
                      <TH className="text-right">Hard bounce</TH>
                      <TH className="text-right">Soft bounce</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {history.map((h) => (
                      <TR key={h.id}>
                        <TD>{fmtDateTime(h.snapshot_at || h.snapshotAt)}</TD>
                        <TD><Badge tone={gradeTone(h.grade)}>{h.grade || '—'}</Badge></TD>
                        <TD className="text-right">{(num(h.active_count, h.activeCount) ?? 0).toLocaleString()}</TD>
                        <TD className="text-right">{(num(h.dormant_count, h.dormantCount) ?? 0).toLocaleString()}</TD>
                        <TD className="text-right">{(num(h.role_account_count, h.roleAccountCount) ?? 0).toLocaleString()}</TD>
                        <TD className="text-right">{ratePct(num(h.hard_bounce_rate, h.hardBounceRate))}</TD>
                        <TD className="text-right">{ratePct(num(h.soft_bounce_rate, h.softBounceRate))}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

function BounceBar({ label, value, tone }: { label: string; value?: number; tone: 'rose' | 'amber' }) {
  const n = typeof value === 'number' ? (value <= 1 ? value * 100 : value) : 0
  const width = Math.min(100, n * 10) // bounce rates are small; amplify for visibility
  const color = tone === 'rose' ? 'bg-rose-500' : 'bg-amber-500'
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-stone-400">{label}</span>
        <span className="text-stone-200">{n.toFixed(2)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-800">
        <div className={color} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}
