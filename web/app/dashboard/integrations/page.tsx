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
type Integration = {
  id: string
  provider?: string
  display_name?: string
  displayName?: string
  config?: Record<string, unknown> | null
  status?: string
  last_synced_at?: string | null
  lastSyncedAt?: string | null
  created_at?: string
  createdAt?: string
}

const PROVIDERS: { value: string; label: string; blurb: string }[] = [
  { value: 'sendgrid', label: 'SendGrid', blurb: 'Pull event webhooks and message activity.' },
  { value: 'mailgun', label: 'Mailgun', blurb: 'Sync events API and suppression lists.' },
  { value: 'postmark', label: 'Postmark', blurb: 'Import message streams and bounce data.' },
  { value: 'amazon_ses', label: 'Amazon SES', blurb: 'Ingest SNS feedback notifications.' },
  { value: 'klaviyo', label: 'Klaviyo', blurb: 'Pull campaign and flow engagement events.' },
  { value: 'braze', label: 'Braze', blurb: 'Sync messaging engagement exports.' },
  { value: 'iterable', label: 'Iterable', blurb: 'Import campaign send and engagement events.' },
  { value: 'custom', label: 'Custom / CSV endpoint', blurb: 'Any HTTP export endpoint returning event rows.' },
]

function providerLabel(p?: string) {
  return PROVIDERS.find((x) => x.value === p)?.label || (p ? p.replace(/_/g, ' ') : 'Unknown')
}
function displayName(i: Integration) {
  return i.display_name || i.displayName || providerLabel(i.provider)
}
function lastSynced(i: Integration) {
  return i.last_synced_at || i.lastSyncedAt || null
}
function fmtDateTime(s?: string | null) {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function statusTone(status?: string): 'green' | 'amber' | 'rose' | 'slate' {
  switch ((status || '').toLowerCase()) {
    case 'connected':
    case 'active':
    case 'ok':
      return 'green'
    case 'pending':
    case 'syncing':
      return 'amber'
    case 'error':
    case 'failed':
    case 'disconnected':
      return 'rose'
    default:
      return 'slate'
  }
}

export default function IntegrationsPage() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [notice, setNotice] = useState<string>('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ provider: 'sendgrid', displayName: '', apiKey: '', endpoint: '' })
  const [saving, setSaving] = useState(false)

  const [pullingId, setPullingId] = useState<string>('')
  const [deletingId, setDeletingId] = useState<string>('')

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
      const res: Integration[] = (await api.listIntegrations(wsId)) || []
      setIntegrations(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integrations')
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
    if (!workspaceId) return
    setSaving(true)
    setError('')
    try {
      const config: Record<string, unknown> = {}
      if (form.apiKey.trim()) config.apiKey = form.apiKey.trim()
      if (form.endpoint.trim()) config.endpoint = form.endpoint.trim()
      await api.createIntegration({
        workspaceId,
        provider: form.provider,
        displayName: form.displayName.trim() || providerLabel(form.provider),
        config,
      })
      setCreateOpen(false)
      setForm({ provider: 'sendgrid', displayName: '', apiKey: '', endpoint: '' })
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create integration')
    } finally {
      setSaving(false)
    }
  }

  const pull = async (i: Integration) => {
    setPullingId(i.id)
    setError('')
    setNotice('')
    try {
      const res = await api.pullIntegration(i.id)
      const imp = (res?.import ?? res) as { rows_imported?: number; rowsImported?: number; status?: string } | undefined
      const rows = imp?.rows_imported ?? imp?.rowsImported
      setNotice(
        `Pull started for ${displayName(i)}${typeof rows === 'number' ? ` — ${rows} events imported` : ''}. ` +
        `Track progress on the Imports page.`
      )
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to trigger pull')
    } finally {
      setPullingId('')
    }
  }

  const remove = async (i: Integration) => {
    if (typeof window !== 'undefined' && !window.confirm(`Remove connector "${displayName(i)}"?`)) return
    setDeletingId(i.id)
    setError('')
    try {
      await api.deleteIntegration(i.id)
      setIntegrations((prev) => prev.filter((x) => x.id !== i.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove integration')
    } finally {
      setDeletingId('')
    }
  }

  const connectedCount = useMemo(() => integrations.filter((i) => statusTone(i.status) === 'green').length, [integrations])
  const syncedCount = useMemo(() => integrations.filter((i) => lastSynced(i)).length, [integrations])
  const selectedProvider = PROVIDERS.find((p) => p.value === form.provider)

  if (loading && !workspaceId && workspaces.length === 0 && !error) {
    return <PageLoader label="Loading integrations..." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Integrations</h1>
          <p className="mt-1 text-sm text-slate-400">
            Connect your ESP and pull send events on demand. Each pull creates an import job that normalizes events into the platform.
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
          <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>Connect ESP</Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-sky-400 hover:text-sky-200" aria-label="Dismiss">✕</button>
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading integrations..." />
      ) : !workspaceId ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace from the dashboard to connect an ESP."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Connectors" value={integrations.length} tone="sky" />
            <Stat label="Connected" value={connectedCount} tone="green" hint={`${integrations.length - connectedCount} need attention`} />
            <Stat label="Ever synced" value={syncedCount} tone="amber" hint="Connectors with at least one pull" />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Connectors</h2>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {integrations.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    title="No connectors yet"
                    description="Connect SendGrid, Mailgun, Postmark, SES, or a custom endpoint to start pulling events automatically."
                    action={<Button onClick={() => setCreateOpen(true)}>Connect ESP</Button>}
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Connector</TH>
                      <TH>Provider</TH>
                      <TH>Status</TH>
                      <TH>Last synced</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {integrations.map((i) => {
                      const synced = lastSynced(i)
                      return (
                        <TR key={i.id}>
                          <TD className="font-medium text-slate-100">{displayName(i)}</TD>
                          <TD>{providerLabel(i.provider)}</TD>
                          <TD><Badge tone={statusTone(i.status)}>{i.status || 'unknown'}</Badge></TD>
                          <TD>{synced ? <span className="text-slate-300">{fmtDateTime(synced)}</span> : <span className="text-slate-600">Never</span>}</TD>
                          <TD className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => pull(i)} disabled={pullingId === i.id}>
                                {pullingId === i.id ? <><Spinner className="mr-1.5 h-3.5 w-3.5" /> Pulling</> : 'Pull now'}
                              </Button>
                              <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => remove(i)} disabled={deletingId === i.id}>
                                {deletingId === i.id ? '...' : 'Remove'}
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

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Available providers</h2>
              <p className="text-xs text-slate-500">Supported ESP connectors you can add to this workspace.</p>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => { setForm({ provider: p.value, displayName: '', apiKey: '', endpoint: '' }); setCreateOpen(true) }}
                    className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-left transition-colors hover:border-sky-500/40 hover:bg-slate-900"
                  >
                    <div className="text-sm font-medium text-slate-100">{p.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{p.blurb}</div>
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="Connect ESP"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={create} disabled={saving}>
              {saving ? <><Spinner className="mr-2 h-4 w-4" /> Connecting</> : 'Connect'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Provider</label>
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {selectedProvider && <p className="mt-1.5 text-xs text-slate-500">{selectedProvider.blurb}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Display name</label>
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder={providerLabel(form.provider)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
          </div>
          {form.provider === 'custom' ? (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Export endpoint URL</label>
              <input
                value={form.endpoint}
                onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                placeholder="https://example.com/exports/events.csv"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">API key</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="Paste your provider API key"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-slate-500">Stored against the connector config. Used when you trigger a pull.</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
