'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { PageLoader, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Sender {
  id: string
  domain: string | null
  subdomain: string | null
  friendly_name: string | null
  status: string | null
}

interface Workspace {
  id: string
  name: string
}

const WS_KEY = 'activeWorkspaceId'

// Canonical target fields the backend understands for send-event normalization.
const TARGET_FIELDS: { key: string; label: string; required?: boolean; hint?: string }[] = [
  { key: 'email', label: 'Recipient email', required: true, hint: 'Address that received the message' },
  { key: 'event_type', label: 'Event type', required: true, hint: 'send, open, click, bounce, complaint, unsubscribe' },
  { key: 'event_at', label: 'Event timestamp', hint: 'ISO date/time of the event' },
  { key: 'message_id', label: 'Message ID', hint: 'Unique per message (dedupes events)' },
  { key: 'campaign', label: 'Campaign name', hint: 'Groups events into a campaign rollup' },
  { key: 'subject', label: 'Subject line' },
  { key: 'segment', label: 'Segment name' },
  { key: 'bounce_type', label: 'Bounce type', hint: 'hard / soft (for bounce events)' },
]

const IGNORE = '__ignore__'

const SAMPLE_CSV = `email,event,sent_at,message_id,campaign,subject
ava@example.com,send,2026-06-01T09:00:00Z,m-1001,June Newsletter,Your June digest
ava@example.com,open,2026-06-01T11:14:00Z,m-1001,June Newsletter,Your June digest
sam@example.com,send,2026-06-01T09:00:00Z,m-1002,June Newsletter,Your June digest
sam@example.com,bounce,2026-06-01T09:01:00Z,m-1002,June Newsletter,Your June digest`

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }

  const parseLine = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"'
            i++
          } else {
            inQuotes = false
          }
        } else {
          cur += ch
        }
      } else if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        out.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
    out.push(cur)
    return out.map((c) => c.trim())
  }

  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map(parseLine)
  return { headers, rows }
}

// Best-effort auto-mapping from a source header to a target field.
function autoMap(header: string): string {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, '')
  const table: Record<string, string> = {
    email: 'email',
    emailaddress: 'email',
    recipient: 'email',
    recipientemail: 'email',
    to: 'email',
    event: 'event_type',
    eventtype: 'event_type',
    type: 'event_type',
    action: 'event_type',
    eventat: 'event_at',
    timestamp: 'event_at',
    time: 'event_at',
    date: 'event_at',
    sentat: 'event_at',
    occurredat: 'event_at',
    messageid: 'message_id',
    msgid: 'message_id',
    mid: 'message_id',
    campaign: 'campaign',
    campaignname: 'campaign',
    subject: 'subject',
    subjectline: 'subject',
    segment: 'segment',
    segmentname: 'segment',
    list: 'segment',
    bouncetype: 'bounce_type',
    bounce: 'bounce_type',
  }
  return table[h] ?? IGNORE
}

export default function NewImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [senders, setSenders] = useState<Sender[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [senderId, setSenderId] = useState('')
  const [filename, setFilename] = useState('')
  const [rawText, setRawText] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({}) // header -> target field
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        let wsId = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        if (!wsId) {
          const list: Workspace[] = await api.listWorkspaces()
          if (Array.isArray(list) && list.length > 0) {
            wsId = list[0].id
            window.localStorage.setItem(WS_KEY, wsId)
          }
        }
        if (!active) return
        setWorkspaceId(wsId ?? '')
        if (wsId) {
          const s: Sender[] = await api.listSenders(wsId)
          if (!active) return
          const arr = Array.isArray(s) ? s : []
          setSenders(arr)
          if (arr.length > 0) setSenderId(arr[0].id)
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load senders')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const ingest = (text: string, name: string) => {
    const { headers: hs, rows } = parseCsv(text)
    setHeaders(hs)
    setDataRows(rows)
    setFilename(name)
    setRawText(text)
    const m: Record<string, string> = {}
    hs.forEach((h) => {
      m[h] = autoMap(h)
    })
    setMapping(m)
    if (hs.length > 0) setStep(2)
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => ingest(String(reader.result ?? ''), f.name)
    reader.readAsText(f)
  }

  const onPaste = () => {
    if (!rawText.trim()) return
    ingest(rawText, filename || 'pasted.csv')
  }

  const mappedTargets = useMemo(() => new Set(Object.values(mapping).filter((v) => v !== IGNORE)), [mapping])
  const hasEmail = mappedTargets.has('email')
  const hasEventType = mappedTargets.has('event_type')
  const canSubmit = hasEmail && hasEventType && dataRows.length > 0 && !!senderId && !!workspaceId

  // Build normalized row objects keyed by target field.
  const buildRows = (): Record<string, string>[] => {
    const headerIndex = new Map<string, number>()
    headers.forEach((h, i) => headerIndex.set(h, i))
    return dataRows.map((cells) => {
      const obj: Record<string, string> = {}
      for (const [header, target] of Object.entries(mapping)) {
        if (target === IGNORE) continue
        const idx = headerIndex.get(header)
        if (idx === undefined) continue
        const val = cells[idx]
        if (val !== undefined && val !== '') obj[target] = val
      }
      return obj
    })
  }

  const handleSubmit = async () => {
    if (!canSubmit || !workspaceId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Persist columnMapping as target -> source for the backend record.
      const columnMapping: Record<string, string> = {}
      for (const [header, target] of Object.entries(mapping)) {
        if (target !== IGNORE) columnMapping[target] = header
      }
      await api.createImport({
        workspaceId,
        senderId,
        filename: filename || 'import.csv',
        columnMapping,
        rows: buildRows(),
      })
      router.push('/dashboard/imports')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Import failed')
      setSubmitting(false)
    }
  }

  if (loading) return <PageLoader label="Loading import wizard..." />

  if (workspaceId === '') {
    return (
      <EmptyState
        title="No workspace selected"
        description="Create a workspace from the dashboard before importing data."
        action={
          <Link href="/dashboard">
            <Button variant="primary">Go to dashboard</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">New import</h1>
          <p className="mt-1 text-sm text-slate-500">Upload an ESP export, map columns to send-event fields, and ingest.</p>
        </div>
        <Link href="/dashboard/imports">
          <Button variant="ghost">Cancel</Button>
        </Link>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-xs">
        {[
          { n: 1, label: 'Source' },
          { n: 2, label: 'Map columns' },
          { n: 3, label: 'Review' },
        ].map((s, idx) => (
          <div key={s.n} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold ${
                step >= (s.n as 1 | 2 | 3)
                  ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                  : 'border-slate-700 bg-slate-900 text-slate-500'
              }`}
            >
              {s.n}
            </span>
            <span className={step >= (s.n as 1 | 2 | 3) ? 'text-slate-200' : 'text-slate-600'}>{s.label}</span>
            {idx < 2 && <span className="mx-1 h-px w-8 bg-slate-800" />}
          </div>
        ))}
      </div>

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

      {/* Step 1: source */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-slate-200">1. Choose sender and data source</span>
          </CardHeader>
          <CardBody className="space-y-5">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Sender</label>
              {senders.length === 0 ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                  No senders yet. Create a sender first, then return here to import its events.{' '}
                  <Link href="/dashboard/senders" className="underline">
                    Manage senders
                  </Link>
                </div>
              ) : (
                <select
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none sm:max-w-md"
                >
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.friendly_name || s.domain || s.id}
                      {s.subdomain ? ` (${s.subdomain}.${s.domain})` : s.domain ? '' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                <div className="text-sm font-medium text-slate-200">Upload a CSV file</div>
                <p className="mt-1 text-xs text-slate-500">First row must be the header.</p>
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => fileRef.current?.click()}
                  disabled={senders.length === 0}
                >
                  Choose file
                </Button>
                {filename && <div className="mt-2 text-xs text-slate-400">Selected: {filename}</div>}
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-200">Paste CSV</div>
                  <button
                    type="button"
                    onClick={() => setRawText(SAMPLE_CSV)}
                    className="text-xs text-sky-400 hover:text-sky-300"
                  >
                    Use example
                  </button>
                </div>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="email,event,sent_at..."
                  rows={5}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                />
                <Button variant="secondary" className="mt-3" onClick={onPaste} disabled={!rawText.trim() || senders.length === 0}>
                  Parse pasted rows
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Step 2: mapping */}
      {step === 2 && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">2. Map columns ({headers.length})</span>
            <Badge tone="slate">{dataRows.length} rows</Badge>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-xs text-slate-500">
              Match each source column to a send-event field. <span className="text-slate-300">Recipient email</span> and{' '}
              <span className="text-slate-300">Event type</span> are required.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm text-slate-200">{h}</div>
                    <div className="truncate text-xs text-slate-600">
                      e.g. {dataRows[0]?.[headers.indexOf(h)] ?? '—'}
                    </div>
                  </div>
                  <span className="text-slate-600">→</span>
                  <select
                    value={mapping[h] ?? IGNORE}
                    onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value={IGNORE}>Ignore</option>
                    {TARGET_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="text-slate-500">Required:</span>
              <Badge tone={hasEmail ? 'green' : 'rose'}>email {hasEmail ? '✓' : 'missing'}</Badge>
              <Badge tone={hasEventType ? 'green' : 'rose'}>event_type {hasEventType ? '✓' : 'missing'}</Badge>
            </div>

            <div className="flex justify-between border-t border-slate-800 pt-4">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button variant="primary" onClick={() => setStep(3)} disabled={!hasEmail || !hasEventType}>
                Review
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Step 3: review */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-slate-200">3. Review and import</span>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Sender</div>
                <div className="mt-0.5 truncate text-slate-200">
                  {senders.find((s) => s.id === senderId)?.friendly_name ||
                    senders.find((s) => s.id === senderId)?.domain ||
                    senderId}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">File</div>
                <div className="mt-0.5 truncate text-slate-200">{filename || 'import.csv'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Rows</div>
                <div className="mt-0.5 text-slate-200">{dataRows.length.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Mapped fields</div>
                <div className="mt-0.5 text-slate-200">{mappedTargets.size}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Preview (first 5 rows)</div>
              {dataRows.length === 0 ? (
                <EmptyState title="No rows to import" description="Go back and supply data." />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      {TARGET_FIELDS.filter((f) => mappedTargets.has(f.key)).map((f) => (
                        <TH key={f.key}>{f.label}</TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {buildRows()
                      .slice(0, 5)
                      .map((row, i) => (
                        <TR key={i}>
                          {TARGET_FIELDS.filter((f) => mappedTargets.has(f.key)).map((f) => (
                            <TD key={f.key} className="max-w-[16rem] truncate">
                              {row[f.key] ?? <span className="text-slate-600">—</span>}
                            </TD>
                          ))}
                        </TR>
                      ))}
                  </TBody>
                </Table>
              )}
            </div>

            {submitError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{submitError}</div>
            )}

            <div className="flex justify-between border-t border-slate-800 pt-4">
              <Button variant="ghost" onClick={() => setStep(2)} disabled={submitting}>
                Back
              </Button>
              <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || submitting}>
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Spinner className="h-4 w-4" /> Importing...
                  </span>
                ) : (
                  `Import ${dataRows.length.toLocaleString()} rows`
                )}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
