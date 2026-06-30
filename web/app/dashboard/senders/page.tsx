'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'edrg.workspaceId'

interface Workspace { id: string; name: string }
interface Sender {
  id: string
  workspace_id?: string
  domain?: string
  subdomain?: string | null
  friendly_name?: string | null
  status?: string
  revenue_per_send_cents?: number | null
  created_at?: string
}

const STATUS_OPTIONS = ['active', 'warming', 'paused', 'archived']

function statusTone(status?: string): 'green' | 'sky' | 'amber' | 'rose' | 'slate' {
  switch ((status ?? '').toLowerCase()) {
    case 'active': return 'green'
    case 'warming': return 'sky'
    case 'paused': return 'amber'
    case 'archived': return 'slate'
    default: return 'slate'
  }
}

interface FormState {
  domain: string
  subdomain: string
  friendly_name: string
  status: string
  revenue_per_send: string // dollars, as typed
}

const EMPTY_FORM: FormState = { domain: '', subdomain: '', friendly_name: '', status: 'active', revenue_per_send: '' }

export default function SendersPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [senders, setSenders] = useState<Sender[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Sender | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<Sender | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Resolve active workspace from localStorage, fall back to first workspace.
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
        const first = Array.isArray(list) ? list[0] : undefined
        if (first) {
          window.localStorage.setItem(WS_KEY, first.id)
          setWorkspaceId(first.id)
        } else {
          setNoWorkspace(true)
          setLoading(false)
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to resolve workspace')
          setLoading(false)
        }
      }
    })()
    return () => { active = false }
  }, [])

  const load = useCallback(async (wsId: string) => {
    setLoading(true)
    setError(null)
    try {
      const list: Sender[] = await api.listSenders(wsId)
      setSenders(Array.isArray(list) ? list : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load senders')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) load(workspaceId)
  }, [workspaceId, load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return senders.filter((s) => {
      if (statusFilter !== 'all' && (s.status ?? '').toLowerCase() !== statusFilter) return false
      if (!q) return true
      return (
        (s.domain ?? '').toLowerCase().includes(q) ||
        (s.subdomain ?? '').toLowerCase().includes(q) ||
        (s.friendly_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [senders, query, statusFilter])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = async (sender: Sender) => {
    setEditing(sender)
    setFormError(null)
    setForm({
      domain: sender.domain ?? '',
      subdomain: sender.subdomain ?? '',
      friendly_name: sender.friendly_name ?? '',
      status: sender.status ?? 'active',
      revenue_per_send: sender.revenue_per_send_cents != null ? (sender.revenue_per_send_cents / 100).toString() : '',
    })
    setModalOpen(true)
    // Refresh with detail (revenue + metrics) if available.
    try {
      const detail: Sender = await api.getSender(sender.id)
      if (detail) {
        setForm((f) => ({
          ...f,
          domain: detail.domain ?? f.domain,
          subdomain: detail.subdomain ?? f.subdomain,
          friendly_name: detail.friendly_name ?? f.friendly_name,
          status: detail.status ?? f.status,
          revenue_per_send: detail.revenue_per_send_cents != null ? (detail.revenue_per_send_cents / 100).toString() : f.revenue_per_send,
        }))
      }
    } catch {
      // detail fetch is best-effort; the row values already populate the form
    }
  }

  const save = async () => {
    setFormError(null)
    const domain = form.domain.trim()
    if (!editing && !domain) {
      setFormError('Domain is required.')
      return
    }
    const revCents = form.revenue_per_send.trim() === ''
      ? undefined
      : Math.round(parseFloat(form.revenue_per_send) * 100)
    if (revCents != null && Number.isNaN(revCents)) {
      setFormError('Revenue per send must be a number.')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const body: Record<string, unknown> = {
          friendly_name: form.friendly_name.trim() || null,
          status: form.status,
        }
        if (revCents != null) body.revenue_per_send_cents = revCents
        const updated: Sender = await api.updateSender(editing.id, body)
        setSenders((prev) => prev.map((s) => (s.id === editing.id ? { ...s, ...updated } : s)))
      } else {
        const body: Record<string, unknown> = {
          workspaceId,
          domain,
          subdomain: form.subdomain.trim() || null,
          friendly_name: form.friendly_name.trim() || null,
          status: form.status,
        }
        if (revCents != null) body.revenue_per_send_cents = revCents
        const created: Sender = await api.createSender(body)
        setSenders((prev) => [created, ...prev])
      }
      setModalOpen(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save sender')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteSender(deleteTarget.id)
      setSenders((prev) => prev.filter((s) => s.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete sender')
    } finally {
      setDeleting(false)
    }
  }

  if (noWorkspace) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Create or select a workspace from the dashboard first, then add senders here."
        action={<a href="/dashboard" className="text-sm text-sky-400 hover:text-sky-300">Go to dashboard →</a>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Senders</h1>
          <p className="mt-1 text-sm text-slate-500">Sending domains and subdomains tracked for deliverability and revenue.</p>
        </div>
        <Button onClick={openCreate}>Add sender</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by domain or name..."
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30 sm:max-w-xs"
            />
            <div className="flex flex-wrap gap-2">
              {['all', ...STATUS_OPTIONS].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    statusFilter === s
                      ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <PageLoader label="Loading senders..." />
          ) : senders.length === 0 ? (
            <EmptyState
              title="No senders yet"
              description="Add a sending domain to start tracking its inbox placement, list health, and revenue exposure."
              action={<Button onClick={openCreate}>Add your first sender</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState title="No matching senders" description="Adjust your search or status filter." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Sender</TH>
                  <TH>Domain</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Revenue / send</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <div className="font-medium text-slate-100">{s.friendly_name || s.domain || 'Untitled sender'}</div>
                      {s.created_at && <div className="text-xs text-slate-600">Added {new Date(s.created_at).toLocaleDateString()}</div>}
                    </TD>
                    <TD>
                      <span className="font-mono text-slate-300">{s.subdomain ? `${s.subdomain}.${s.domain}` : s.domain}</span>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(s.status)}>{s.status ?? 'unknown'}</Badge>
                    </TD>
                    <TD className="text-right font-mono text-slate-300">
                      {s.revenue_per_send_cents != null ? `$${(s.revenue_per_send_cents / 100).toFixed(4)}` : '—'}
                    </TD>
                    <TD className="text-right">
                      <div className="inline-flex gap-2">
                        <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(s)}>Edit</Button>
                        <Button variant="ghost" className="px-2 py-1 text-rose-400 hover:text-rose-300" onClick={() => setDeleteTarget(s)}>Delete</Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit sender' : 'Add sender'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <span className="flex items-center gap-2"><Spinner className="h-4 w-4" /> Saving...</span> : editing ? 'Save changes' : 'Add sender'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</div>
          )}
          <Field label="Domain" hint={editing ? 'Domain cannot be changed after creation.' : 'Root sending domain, e.g. mail.acme.com'}>
            <input
              value={form.domain}
              disabled={!!editing}
              onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
              placeholder="acme.com"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-50"
            />
          </Field>
          {!editing && (
            <Field label="Subdomain" hint="Optional dedicated subdomain.">
              <input
                value={form.subdomain}
                onChange={(e) => setForm((f) => ({ ...f, subdomain: e.target.value }))}
                placeholder="news"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </Field>
          )}
          <Field label="Friendly name">
            <input
              value={form.friendly_name}
              onChange={(e) => setForm((f) => ({ ...f, friendly_name: e.target.value }))}
              placeholder="Marketing newsletter"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s} className="capitalize">{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Revenue / send ($)" hint="Per-send value, used for revenue-at-risk.">
              <input
                value={form.revenue_per_send}
                onChange={(e) => setForm((f) => ({ ...f, revenue_per_send: e.target.value }))}
                placeholder="0.12"
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </Field>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete sender"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <span className="font-medium text-white">{deleteTarget?.friendly_name || deleteTarget?.domain}</span>?
          This archives the sender and its associated analytics.
        </p>
      </Modal>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-300">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
