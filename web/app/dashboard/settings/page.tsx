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

type Workspace = {
  id: string
  name: string
  owner_id?: string
  ownerId?: string
  currency?: string
  fiscal_start_month?: number
  fiscalStartMonth?: number
  default_sender_id?: string | null
  defaultSenderId?: string | null
}
type Member = {
  id: string
  user_id?: string
  userId?: string
  email?: string
  role?: string
  created_at?: string
  createdAt?: string
}
type Sender = { id: string; domain?: string; friendly_name?: string; friendlyName?: string }
type BillingInfo = {
  subscription?: { plan_id?: string; planId?: string; status?: string; current_period_end?: string; currentPeriodEnd?: string } | null
  plan?: { id?: string; name?: string; price_cents?: number; priceCents?: number } | null
  stripeEnabled?: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR']
const ROLES = ['admin', 'editor', 'viewer']

function senderName(s?: Sender) {
  if (!s) return ''
  return s.friendly_name || s.friendlyName || s.domain || s.id
}
function fiscal(ws?: Workspace) {
  const n = ws?.fiscal_start_month ?? ws?.fiscalStartMonth
  return typeof n === 'number' ? n : 1
}
function defaultSender(ws?: Workspace) {
  return ws?.default_sender_id ?? ws?.defaultSenderId ?? ''
}
function ownerId(ws?: Workspace) {
  return ws?.owner_id ?? ws?.ownerId ?? ''
}
function roleTone(role?: string): 'sky' | 'green' | 'slate' {
  const r = (role || '').toLowerCase()
  if (r === 'owner') return 'green'
  if (r === 'admin') return 'sky'
  return 'slate'
}
function fmtMoney(cents?: number, currency = 'USD') {
  if (typeof cents !== 'number') return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `$${(cents / 100).toFixed(2)}`
  }
}
function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SettingsPage() {
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [ws, setWs] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [billing, setBilling] = useState<BillingInfo | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // general form
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [fiscalMonth, setFiscalMonth] = useState(1)
  const [defaultSenderId, setDefaultSenderId] = useState('')
  const [savingGeneral, setSavingGeneral] = useState(false)

  // invite
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviting, setInviting] = useState(false)
  const [removingId, setRemovingId] = useState('')

  // billing
  const [billingBusy, setBillingBusy] = useState('')

  // delete
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const list: Workspace[] = await api.listWorkspaces()
        if (!active) return
        setWorkspaces(list || [])
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : ''
        const chosen = (stored && (list || []).some((w) => w.id === stored) ? stored : list?.[0]?.id) || ''
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
      const [wsRes, membersRes, sendersRes, billingRes] = await Promise.all([
        api.getWorkspace(wsId),
        api.listMembers(wsId).catch(() => []),
        api.listSenders(wsId).catch(() => []),
        api.getBillingPlan().catch(() => null),
      ])
      setWs(wsRes ?? null)
      setMembers(membersRes ?? [])
      setSenders(sendersRes ?? [])
      setBilling(billingRes ?? null)
      setName(wsRes?.name ?? '')
      setCurrency(wsRes?.currency ?? 'USD')
      setFiscalMonth(fiscal(wsRes))
      setDefaultSenderId(defaultSender(wsRes))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace settings')
      setWs(null)
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

  const dirty = useMemo(() => {
    if (!ws) return false
    return (
      name.trim() !== (ws.name ?? '') ||
      currency !== (ws.currency ?? 'USD') ||
      fiscalMonth !== fiscal(ws) ||
      defaultSenderId !== defaultSender(ws)
    )
  }, [ws, name, currency, fiscalMonth, defaultSenderId])

  const saveGeneral = async () => {
    if (!workspaceId || !name.trim()) return
    setSavingGeneral(true)
    setError('')
    setNotice('')
    try {
      const updated: Workspace = await api.updateWorkspace(workspaceId, {
        name: name.trim(),
        currency,
        fiscalStartMonth: fiscalMonth,
        defaultSenderId: defaultSenderId || null,
      })
      setWs(updated)
      setWorkspaces((prev) => prev.map((w) => (w.id === workspaceId ? { ...w, name: updated.name } : w)))
      setNotice('Workspace settings saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSavingGeneral(false)
    }
  }

  const invite = async () => {
    if (!workspaceId || !inviteEmail.trim()) return
    setInviting(true)
    setError('')
    try {
      const m: Member = await api.inviteMember(workspaceId, { email: inviteEmail.trim(), role: inviteRole })
      setMembers((prev) => [...prev, m])
      setInviteOpen(false)
      setInviteEmail('')
      setInviteRole('viewer')
      setNotice('Invitation sent.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to invite member')
    } finally {
      setInviting(false)
    }
  }

  const removeMember = async (memberId: string) => {
    if (!workspaceId) return
    setRemovingId(memberId)
    setError('')
    try {
      await api.removeMember(workspaceId, memberId)
      setMembers((prev) => prev.filter((m) => m.id !== memberId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member')
    } finally {
      setRemovingId('')
    }
  }

  const checkout = async () => {
    setBillingBusy('checkout')
    setError('')
    try {
      const res = await api.startCheckout()
      if (res?.url) window.location.href = res.url
      else setError('Checkout is not available right now.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout is unavailable (billing not configured)')
    } finally {
      setBillingBusy('')
    }
  }

  const portal = async () => {
    setBillingBusy('portal')
    setError('')
    try {
      const res = await api.openPortal()
      if (res?.url) window.location.href = res.url
      else setError('Billing portal is not available right now.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Billing portal is unavailable')
    } finally {
      setBillingBusy('')
    }
  }

  const doDelete = async () => {
    if (!workspaceId || deleteConfirm !== (ws?.name ?? '')) return
    setDeleting(true)
    setError('')
    try {
      await api.deleteWorkspace(workspaceId)
      const remaining = workspaces.filter((w) => w.id !== workspaceId)
      setWorkspaces(remaining)
      setDeleteOpen(false)
      setDeleteConfirm('')
      const next = remaining[0]?.id ?? ''
      if (typeof window !== 'undefined') {
        if (next) localStorage.setItem(WS_KEY, next)
        else localStorage.removeItem(WS_KEY)
      }
      setWorkspaceId(next)
      if (!next) {
        setWs(null)
        setLoading(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete workspace')
    } finally {
      setDeleting(false)
    }
  }

  const planName = billing?.plan?.name || billing?.subscription?.plan_id || billing?.subscription?.planId || 'Free'
  const planPrice = billing?.plan?.price_cents ?? billing?.plan?.priceCents
  const subStatus = billing?.subscription?.status
  const periodEnd = billing?.subscription?.current_period_end || billing?.subscription?.currentPeriodEnd
  const isPaid = !!planPrice && planPrice > 0

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading settings..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">Workspace configuration, team members, and billing.</p>
        </div>
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
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading settings..." />
      ) : !workspaceId || !ws ? (
        <EmptyState title="No workspace yet" description="Create a workspace from the dashboard to manage its settings." />
      ) : (
        <>
          {/* General */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">General</h2>
              <p className="mt-0.5 text-sm text-slate-500">Name, currency, fiscal calendar, and default sender.</p>
            </CardHeader>
            <CardBody className="space-y-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Workspace name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                  />
                </Field>
                <Field label="Reporting currency">
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Fiscal year start month">
                  <select
                    value={fiscalMonth}
                    onChange={(e) => setFiscalMonth(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Default sender">
                  <select
                    value={defaultSenderId}
                    onChange={(e) => setDefaultSenderId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="">None</option>
                    {senders.map((s) => (
                      <option key={s.id} value={s.id}>
                        {senderName(s)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={saveGeneral} disabled={!dirty || savingGeneral || !name.trim()}>
                  {savingGeneral ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" /> Saving
                    </>
                  ) : (
                    'Save changes'
                  )}
                </Button>
                {dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}
              </div>
            </CardBody>
          </Card>

          {/* Members */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Members</h2>
                <p className="mt-0.5 text-sm text-slate-500">{members.length} member{members.length === 1 ? '' : 's'} in this workspace.</p>
              </div>
              <Button onClick={() => setInviteOpen(true)}>Invite member</Button>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {members.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState
                    title="No members"
                    description="Invite teammates to collaborate on deliverability and revenue."
                    action={<Button onClick={() => setInviteOpen(true)}>Invite member</Button>}
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Email</TH>
                      <TH>Role</TH>
                      <TH>Joined</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {members.map((m) => {
                      const isOwner = (m.user_id || m.userId) === ownerId(ws) || (m.role || '').toLowerCase() === 'owner'
                      return (
                        <TR key={m.id}>
                          <TD className="text-slate-200">{m.email || (m.user_id || m.userId || '').slice(0, 16) || '—'}</TD>
                          <TD>
                            <Badge tone={roleTone(isOwner ? 'owner' : m.role)}>{isOwner ? 'owner' : m.role || 'member'}</Badge>
                          </TD>
                          <TD className="text-slate-400">{fmtDate(m.created_at || m.createdAt)}</TD>
                          <TD className="text-right">
                            {isOwner ? (
                              <span className="text-xs text-slate-600">—</span>
                            ) : (
                              <button
                                onClick={() => removeMember(m.id)}
                                disabled={removingId === m.id}
                                className="text-xs font-medium text-rose-400 hover:text-rose-300 disabled:opacity-50"
                              >
                                {removingId === m.id ? 'Removing...' : 'Remove'}
                              </button>
                            )}
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* Billing */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Plan & Billing</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {billing?.stripeEnabled ? 'Manage your subscription via Stripe.' : 'Billing is not configured for this deployment.'}
              </p>
            </CardHeader>
            <CardBody className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Current plan" value={<span className="capitalize">{planName}</span>} tone={isPaid ? 'sky' : 'default'} />
                <Stat
                  label="Price"
                  value={planPrice ? `${fmtMoney(planPrice, currency)}/mo` : 'Free'}
                />
                <Stat
                  label="Status"
                  value={subStatus ? <Badge tone={subStatus === 'active' ? 'green' : 'amber'}>{subStatus}</Badge> : <span className="text-slate-500">—</span>}
                  hint={periodEnd ? `Renews ${fmtDate(periodEnd)}` : undefined}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {isPaid ? (
                  <Button onClick={portal} disabled={billingBusy === 'portal' || !billing?.stripeEnabled}>
                    {billingBusy === 'portal' ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" /> Opening
                      </>
                    ) : (
                      'Manage billing'
                    )}
                  </Button>
                ) : (
                  <Button onClick={checkout} disabled={billingBusy === 'checkout' || !billing?.stripeEnabled}>
                    {billingBusy === 'checkout' ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" /> Redirecting
                      </>
                    ) : (
                      'Upgrade to Pro'
                    )}
                  </Button>
                )}
                {!billing?.stripeEnabled && (
                  <span className="text-xs text-slate-500">Set Stripe keys in the backend to enable checkout.</span>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Danger zone */}
          <Card className="border-rose-500/30">
            <CardHeader className="border-rose-500/20">
              <h2 className="text-base font-semibold text-rose-300">Danger zone</h2>
              <p className="mt-0.5 text-sm text-slate-500">Permanently delete this workspace and all of its data.</p>
            </CardHeader>
            <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-400">
                Deleting <span className="font-semibold text-slate-200">{ws.name}</span> removes senders, imports, events, and
                every analysis. This cannot be undone.
              </div>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Delete workspace
              </Button>
            </CardBody>
          </Card>
        </>
      )}

      {/* Invite modal */}
      <Modal
        open={inviteOpen}
        onClose={() => !inviting && setInviteOpen(false)}
        title="Invite member"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)} disabled={inviting}>
              Cancel
            </Button>
            <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
              {inviting ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" /> Inviting
                </>
              ) : (
                'Send invite'
              )}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Email address">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
          </Field>
          <Field label="Role">
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r} className="capitalize">
                  {r}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Modal>

      {/* Delete modal */}
      <Modal
        open={deleteOpen}
        onClose={() => !deleting && setDeleteOpen(false)}
        title="Delete workspace"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doDelete} disabled={deleting || deleteConfirm !== (ws?.name ?? '')}>
              {deleting ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" /> Deleting
                </>
              ) : (
                'Delete permanently'
              )}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            This will permanently delete <span className="font-semibold text-slate-200">{ws?.name}</span> and all associated
            data. To confirm, type the workspace name below.
          </p>
          <input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={ws?.name}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-rose-500 focus:outline-none"
          />
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}
