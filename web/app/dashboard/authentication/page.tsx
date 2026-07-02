'use client'

import type { ReactNode } from 'react'
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
type Sender = { id: string; domain?: string; friendly_name?: string; friendlyName?: string }
type AuthCheck = {
  id: string
  sender_id?: string
  senderId?: string
  spf_status?: string
  spfStatus?: string
  dkim_status?: string
  dkimStatus?: string
  dmarc_status?: string
  dmarcStatus?: string
  dmarc_policy?: string
  dmarcPolicy?: string
  one_click_unsub?: boolean
  oneClickUnsub?: boolean
  notes?: string
  checked_at?: string
  checkedAt?: string
  created_at?: string
  createdAt?: string
}

const STATUS_OPTIONS = ['pass', 'partial', 'fail', 'unknown']
const DMARC_POLICIES = ['none', 'quarantine', 'reject']

function senderName(s?: Sender) {
  if (!s) return 'Unknown sender'
  return s.friendly_name || s.friendlyName || s.domain || s.id
}
function spf(c: AuthCheck) { return (c.spf_status || c.spfStatus || 'unknown').toLowerCase() }
function dkim(c: AuthCheck) { return (c.dkim_status || c.dkimStatus || 'unknown').toLowerCase() }
function dmarc(c: AuthCheck) { return (c.dmarc_status || c.dmarcStatus || 'unknown').toLowerCase() }
function policy(c: AuthCheck) { return (c.dmarc_policy || c.dmarcPolicy || 'none').toLowerCase() }
function oneClick(c: AuthCheck) { return Boolean(c.one_click_unsub ?? c.oneClickUnsub) }
function statusTone(s: string): 'green' | 'amber' | 'rose' | 'slate' {
  const v = s.toLowerCase()
  if (v === 'pass' || v === 'ok' || v === 'valid' || v === 'aligned') return 'green'
  if (v === 'warn' || v === 'partial') return 'amber'
  if (v === 'fail' || v === 'missing' || v === 'invalid') return 'rose'
  return 'slate'
}
function policyTone(p: string): 'green' | 'amber' | 'rose' | 'slate' {
  const v = p.toLowerCase()
  if (v === 'reject') return 'green'
  if (v === 'quarantine') return 'amber'
  if (v === 'none') return 'rose'
  return 'slate'
}
function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function isPassing(c: AuthCheck) {
  return statusTone(spf(c)) === 'green' && statusTone(dkim(c)) === 'green' && statusTone(dmarc(c)) === 'green'
}
// Gmail/Yahoo 2024 bulk-sender enforcement: SPF+DKIM, DMARC at least p=none, one-click unsubscribe.
function compliant(c: AuthCheck) {
  return statusTone(spf(c)) === 'green' && statusTone(dkim(c)) === 'green' && statusTone(dmarc(c)) === 'green' && oneClick(c)
}

type FormState = {
  spf_status: string
  dkim_status: string
  dmarc_status: string
  dmarc_policy: string
  one_click_unsub: boolean
  notes: string
}
const blankForm: FormState = {
  spf_status: 'pass',
  dkim_status: 'pass',
  dmarc_status: 'pass',
  dmarc_policy: 'none',
  one_click_unsub: false,
  notes: '',
}

export default function AuthenticationPage() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [checks, setChecks] = useState<AuthCheck[]>([])
  const [filterSender, setFilterSender] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editSenderId, setEditSenderId] = useState<string>('')
  const [form, setForm] = useState<FormState>(blankForm)
  const [saving, setSaving] = useState(false)

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
      const [sendersRes, checksRes] = await Promise.all([
        api.listSenders(wsId),
        api.listAuthChecks(wsId),
      ])
      setSenders(sendersRes || [])
      setChecks(checksRes || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load authentication checks')
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

  const senderById = useMemo(() => new Map(senders.map((s) => [s.id, s])), [senders])
  // latest check per sender
  const latestBySender = useMemo(() => {
    const m = new Map<string, AuthCheck>()
    for (const c of checks) {
      const sid = c.sender_id || c.senderId || ''
      const cur = m.get(sid)
      const ct = new Date(c.checked_at || c.checkedAt || c.created_at || c.createdAt || 0).getTime()
      const pt = cur ? new Date(cur.checked_at || cur.checkedAt || cur.created_at || cur.createdAt || 0).getTime() : -1
      if (!cur || ct >= pt) m.set(sid, c)
    }
    return m
  }, [checks])

  const rows = useMemo(() => {
    const list = filterSender
      ? senders.filter((s) => s.id === filterSender)
      : senders
    return list.map((s) => ({ sender: s, check: latestBySender.get(s.id) }))
  }, [senders, filterSender, latestBySender])

  const compliantCount = useMemo(
    () => rows.filter((r) => r.check && compliant(r.check)).length,
    [rows],
  )
  const checkedCount = useMemo(() => rows.filter((r) => r.check).length, [rows])

  const openEdit = (senderId: string) => {
    const existing = latestBySender.get(senderId)
    setEditSenderId(senderId)
    setForm(existing ? {
      spf_status: spf(existing),
      dkim_status: dkim(existing),
      dmarc_status: dmarc(existing),
      dmarc_policy: policy(existing),
      one_click_unsub: oneClick(existing),
      notes: existing.notes || '',
    } : { ...blankForm })
    setModalOpen(true)
  }

  const save = async () => {
    if (!workspaceId || !editSenderId) return
    setSaving(true)
    setError('')
    try {
      await api.saveAuthCheck({
        workspaceId,
        senderId: editSenderId,
        spfStatus: form.spf_status,
        dkimStatus: form.dkim_status,
        dmarcStatus: form.dmarc_status,
        dmarcPolicy: form.dmarc_policy,
        oneClickUnsub: form.one_click_unsub,
        notes: form.notes || undefined,
      })
      setModalOpen(false)
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save authentication check')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading authentication..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Authentication Posture</h1>
          <p className="mt-1 text-sm text-stone-400">
            SPF, DKIM, and DMARC status per sending domain plus one-click unsubscribe, checked against Gmail and Yahoo bulk-sender requirements.
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
            value={filterSender}
            onChange={(e) => setFilterSender(e.target.value)}
            disabled={senders.length === 0}
            className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none disabled:opacity-50"
          >
            <option value="">All senders</option>
            {senders.map((s) => (
              <option key={s.id} value={s.id}>{senderName(s)}</option>
            ))}
          </select>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading authentication checks..." />
      ) : !workspaceId ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace from the dashboard to track authentication posture."
        />
      ) : senders.length === 0 ? (
        <EmptyState
          title="No senders configured"
          description="Add a sending domain first, then record its SPF/DKIM/DMARC posture."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label="Bulk-sender compliant"
              value={`${compliantCount} / ${rows.length}`}
              tone={compliantCount === rows.length && rows.length > 0 ? 'green' : compliantCount === 0 ? 'rose' : 'amber'}
              hint="SPF + DKIM + DMARC + one-click unsubscribe"
            />
            <Stat
              label="Senders checked"
              value={`${checkedCount} / ${rows.length}`}
              tone="sky"
              hint="Have a recorded posture check"
            />
            <Stat
              label="Unchecked"
              value={(rows.length - checkedCount).toString()}
              tone={rows.length - checkedCount > 0 ? 'amber' : 'green'}
              hint="No authentication record yet"
            />
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Posture checklist</h2>
                <p className="text-xs text-stone-500">One row per sending domain. Record or update a check to keep posture current.</p>
              </div>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {rows.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState title="No senders match this filter" description="Clear the sender filter to see all domains." />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Sender</TH>
                      <TH className="text-center">SPF</TH>
                      <TH className="text-center">DKIM</TH>
                      <TH className="text-center">DMARC</TH>
                      <TH className="text-center">Policy</TH>
                      <TH className="text-center">1-click unsub</TH>
                      <TH className="text-center">Compliant</TH>
                      <TH>Checked</TH>
                      <TH className="text-right">Action</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map(({ sender, check }) => (
                      <TR key={sender.id}>
                        <TD className="font-medium text-stone-200">
                          {senderName(sender)}
                          {sender.domain && <div className="text-xs text-stone-500">{sender.domain}</div>}
                        </TD>
                        {check ? (
                          <>
                            <TD className="text-center"><Badge tone={statusTone(spf(check))}>{spf(check)}</Badge></TD>
                            <TD className="text-center"><Badge tone={statusTone(dkim(check))}>{dkim(check)}</Badge></TD>
                            <TD className="text-center"><Badge tone={statusTone(dmarc(check))}>{dmarc(check)}</Badge></TD>
                            <TD className="text-center"><Badge tone={policyTone(policy(check))}>p={policy(check)}</Badge></TD>
                            <TD className="text-center">
                              <Badge tone={oneClick(check) ? 'green' : 'rose'}>{oneClick(check) ? 'yes' : 'no'}</Badge>
                            </TD>
                            <TD className="text-center">
                              <Badge tone={compliant(check) ? 'green' : 'rose'}>{compliant(check) ? 'Pass' : 'Gaps'}</Badge>
                            </TD>
                            <TD className="text-stone-500">{fmtDate(check.checked_at || check.checkedAt || check.created_at || check.createdAt)}</TD>
                            <TD className="text-right">
                              <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => openEdit(sender.id)}>Update</Button>
                            </TD>
                          </>
                        ) : (
                          <>
                            <TD className="text-center text-stone-600">—</TD>
                            <TD className="text-center text-stone-600">—</TD>
                            <TD className="text-center text-stone-600">—</TD>
                            <TD className="text-center text-stone-600">—</TD>
                            <TD className="text-center text-stone-600">—</TD>
                            <TD className="text-center"><Badge tone="slate">No data</Badge></TD>
                            <TD className="text-stone-500"><span className="text-xs">Not checked</span></TD>
                            <TD className="text-right">
                              <Button variant="primary" className="px-2.5 py-1 text-xs" onClick={() => openEdit(sender.id)}>Record</Button>
                            </TD>
                          </>
                        )}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Why this matters</h2>
            </CardHeader>
            <CardBody className="space-y-2 text-sm text-stone-400">
              <p>Gmail and Yahoo require bulk senders to authenticate with SPF and DKIM, publish a DMARC record, and support one-click unsubscribe. A sender shows <span className="text-emerald-300">Pass</span> only when all three authentication checks are green and one-click unsubscribe is enabled.</p>
              <p>A DMARC policy of <span className="text-rose-300">p=none</span> only monitors; move toward <span className="text-amber-300">quarantine</span> and then <span className="text-emerald-300">reject</span> to fully protect the domain.</p>
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`${latestBySender.has(editSenderId) ? 'Update' : 'Record'} posture · ${senderName(senderById.get(editSenderId))}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <><Spinner className="mr-2 h-4 w-4" /> Saving</> : 'Save check'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="SPF">
              <Select value={form.spf_status} onChange={(v) => setForm((f) => ({ ...f, spf_status: v }))} options={STATUS_OPTIONS} />
            </Field>
            <Field label="DKIM">
              <Select value={form.dkim_status} onChange={(v) => setForm((f) => ({ ...f, dkim_status: v }))} options={STATUS_OPTIONS} />
            </Field>
            <Field label="DMARC">
              <Select value={form.dmarc_status} onChange={(v) => setForm((f) => ({ ...f, dmarc_status: v }))} options={STATUS_OPTIONS} />
            </Field>
          </div>
          <Field label="DMARC policy">
            <Select value={form.dmarc_policy} onChange={(v) => setForm((f) => ({ ...f, dmarc_policy: v }))} options={DMARC_POLICIES} prefix="p=" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-stone-300">
            <input
              type="checkbox"
              checked={form.one_click_unsub}
              onChange={(e) => setForm((f) => ({ ...f, one_click_unsub: e.target.checked }))}
              className="h-4 w-4 rounded border-stone-600 bg-stone-900 text-rose-500 focus:ring-rose-500"
            />
            One-click unsubscribe (RFC 8058) enabled
          </label>
          <Field label="Notes (optional)">
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
              placeholder="e.g. DKIM key rotated; DMARC aggregate reports forwarded to ops@"
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">{label}</label>
      {children}
    </div>
  )
}

function Select({ value, onChange, options, prefix = '' }: { value: string; onChange: (v: string) => void; options: string[]; prefix?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rose-500 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>{prefix}{o}</option>
      ))}
    </select>
  )
}
