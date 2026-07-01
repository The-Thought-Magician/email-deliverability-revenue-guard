import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  imports,
  senders,
  campaigns,
  recipients,
  send_events,
  workspace_members,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Canonical event vocabulary used across the platform.
const EVENT_TYPES = ['sent', 'delivered', 'open', 'click', 'bounce', 'complaint', 'unsubscribe']
const BOUNCE_TYPES = ['hard', 'soft']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return !!m
}

async function logActivity(
  workspaceId: string,
  userId: string,
  action: string,
  entityId: string,
  detail: Record<string, unknown> = {},
) {
  try {
    await db.insert(activity_log).values({
      workspace_id: workspaceId,
      user_id: userId,
      action,
      entity_type: 'import',
      entity_id: entityId,
      detail,
    })
  } catch {
    // best-effort
  }
}

const ROLE_LOCALPARTS = new Set([
  'admin',
  'info',
  'support',
  'sales',
  'contact',
  'hello',
  'help',
  'noreply',
  'no-reply',
  'postmaster',
  'abuse',
  'billing',
  'office',
  'team',
])

function isRoleAccount(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? ''
  return ROLE_LOCALPARTS.has(local)
}

/**
 * Resolve a recipient row for (workspace, email), creating it if absent.
 * Returns the recipient id. Uses the UNIQUE(workspace_id,email) constraint to
 * stay idempotent under concurrent inserts.
 */
async function upsertRecipient(workspaceId: string, email: string): Promise<string> {
  const normalized = email.trim().toLowerCase()
  const [existing] = await db
    .select()
    .from(recipients)
    .where(and(eq(recipients.workspace_id, workspaceId), eq(recipients.email, normalized)))
  if (existing) return existing.id
  try {
    const [created] = await db
      .insert(recipients)
      .values({
        workspace_id: workspaceId,
        email: normalized,
        is_role_account: isRoleAccount(normalized),
      })
      .returning()
    return created.id
  } catch {
    // Lost a race: row now exists, re-read it.
    const [row] = await db
      .select()
      .from(recipients)
      .where(and(eq(recipients.workspace_id, workspaceId), eq(recipients.email, normalized)))
    return row.id
  }
}

interface NormalizedRow {
  message_id: string
  email: string
  event_type: string
  bounce_type: string | null
  event_at: Date
  campaign_name?: string
  subject?: string
}

/** Apply a column mapping to a raw row, producing a normalized event row or an error. */
function normalizeRow(
  raw: Record<string, unknown>,
  mapping: Record<string, string>,
  index: number,
): { ok: true; value: NormalizedRow } | { ok: false; message: string } {
  const pick = (logical: string): string | undefined => {
    const col = mapping[logical] ?? logical
    const v = raw[col]
    if (v === undefined || v === null) return undefined
    return String(v).trim()
  }

  const email = pick('email')
  if (!email) return { ok: false, message: 'missing email' }

  const rawType = (pick('event_type') ?? '').toLowerCase()
  if (!rawType) return { ok: false, message: 'missing event_type' }
  // Normalize a few common synonyms.
  const typeAliases: Record<string, string> = {
    send: 'sent',
    sends: 'sent',
    sent: 'sent',
    deliver: 'delivered',
    delivered: 'delivered',
    delivery: 'delivered',
    open: 'open',
    opens: 'open',
    opened: 'open',
    click: 'click',
    clicks: 'click',
    clicked: 'click',
    bounce: 'bounce',
    bounced: 'bounce',
    complaint: 'complaint',
    complained: 'complaint',
    spam: 'complaint',
    unsubscribe: 'unsubscribe',
    unsub: 'unsubscribe',
    unsubscribed: 'unsubscribe',
  }
  const event_type = typeAliases[rawType] ?? rawType
  if (!EVENT_TYPES.includes(event_type)) {
    return { ok: false, message: `unknown event_type "${rawType}"` }
  }

  let bounce_type: string | null = null
  if (event_type === 'bounce') {
    const bt = (pick('bounce_type') ?? '').toLowerCase()
    bounce_type = BOUNCE_TYPES.includes(bt) ? bt : 'hard'
  }

  const rawAt = pick('event_at')
  const event_at = rawAt ? new Date(rawAt) : new Date()
  if (Number.isNaN(event_at.getTime())) {
    return { ok: false, message: `invalid event_at "${rawAt}"` }
  }

  const message_id = pick('message_id') ?? `imp-${index}-${email}-${event_type}-${event_at.getTime()}`

  return {
    ok: true,
    value: {
      message_id,
      email: email.toLowerCase(),
      event_type,
      bounce_type,
      event_at,
      campaign_name: pick('campaign'),
      subject: pick('subject'),
    },
  }
}

/** Bump a recipient's rolled-up counters for one event. */
function counterPatch(eventType: string): Partial<typeof recipients.$inferInsert> {
  switch (eventType) {
    case 'sent':
      return { total_sends: 1 } as never
    case 'open':
      return { total_opens: 1 } as never
    case 'click':
      return { total_clicks: 1 } as never
    case 'bounce':
      return { total_bounces: 1 } as never
    case 'complaint':
      return { total_complaints: 1 } as never
    default:
      return {}
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1).optional(),
  filename: z.string().optional(),
  source: z.string().optional(),
  columnMapping: z.record(z.string(), z.string()).optional().default({}),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
})

const sampleSchema = z.object({
  workspaceId: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — list import jobs for ?workspaceId
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(imports)
    .where(eq(imports.workspace_id, workspaceId))
    .orderBy(desc(imports.created_at))
  return c.json(rows)
})

// GET /:id — import detail + errors
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [imp] = await db.select().from(imports).where(eq(imports.id, id))
  if (!imp) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(imp.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  return c.json(imp)
})

// POST / — create import from uploaded+mapped rows; normalize into send_events
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Validate sender (if supplied) belongs to the workspace.
  if (body.senderId) {
    const [s] = await db.select().from(senders).where(eq(senders.id, body.senderId))
    if (!s || s.workspace_id !== body.workspaceId) {
      return c.json({ error: 'sender not in workspace' }, 400)
    }
  }

  const mapping = body.columnMapping ?? {}

  // Create the import job in 'processing' state first so the FK is available.
  const [imp] = await db
    .insert(imports)
    .values({
      workspace_id: body.workspaceId,
      sender_id: body.senderId ?? null,
      source: body.source ?? 'csv',
      status: 'processing',
      filename: body.filename ?? null,
      column_mapping: mapping,
      rows_total: body.rows.length,
      created_by: userId,
    })
    .returning()

  const errors: Array<{ row: number; message: string }> = []
  let imported = 0
  // Cache campaigns we create during this import keyed by name.
  const campaignCache = new Map<string, string>()
  // Track recipient counter deltas to apply in one pass at the end.
  const recipientDeltas = new Map<
    string,
    { sends: number; opens: number; clicks: number; bounces: number; complaints: number; lastEngaged: Date | null }
  >()

  for (let i = 0; i < body.rows.length; i++) {
    const result = normalizeRow(body.rows[i], mapping, i)
    if (!result.ok) {
      errors.push({ row: i, message: result.message })
      continue
    }
    const row = result.value
    try {
      const recipientId = await upsertRecipient(body.workspaceId, row.email)

      // Resolve / create campaign if a name was provided.
      let campaignId: string | null = null
      if (row.campaign_name) {
        const cached = campaignCache.get(row.campaign_name)
        if (cached) {
          campaignId = cached
        } else {
          const [existingCampaign] = await db
            .select()
            .from(campaigns)
            .where(
              and(
                eq(campaigns.workspace_id, body.workspaceId),
                eq(campaigns.name, row.campaign_name),
              ),
            )
          if (existingCampaign) {
            campaignId = existingCampaign.id
          } else {
            const [createdCampaign] = await db
              .insert(campaigns)
              .values({
                workspace_id: body.workspaceId,
                sender_id: body.senderId ?? null,
                name: row.campaign_name,
                subject: row.subject ?? null,
                sent_at: row.event_at,
              })
              .returning()
            campaignId = createdCampaign.id
          }
          campaignCache.set(row.campaign_name, campaignId)
        }
      }

      await db
        .insert(send_events)
        .values({
          workspace_id: body.workspaceId,
          sender_id: body.senderId ?? null,
          campaign_id: campaignId,
          recipient_id: recipientId,
          import_id: imp.id,
          message_id: row.message_id,
          event_type: row.event_type,
          bounce_type: row.bounce_type,
          event_at: row.event_at,
        })
        .onConflictDoNothing({
          target: [send_events.workspace_id, send_events.message_id, send_events.event_type],
        })

      // Accumulate recipient counter deltas.
      const d =
        recipientDeltas.get(recipientId) ??
        { sends: 0, opens: 0, clicks: 0, bounces: 0, complaints: 0, lastEngaged: null }
      const patch = counterPatch(row.event_type)
      if ('total_sends' in patch) d.sends += 1
      if ('total_opens' in patch) d.opens += 1
      if ('total_clicks' in patch) d.clicks += 1
      if ('total_bounces' in patch) d.bounces += 1
      if ('total_complaints' in patch) d.complaints += 1
      if (row.event_type === 'open' || row.event_type === 'click') {
        if (!d.lastEngaged || row.event_at > d.lastEngaged) d.lastEngaged = row.event_at
      }
      recipientDeltas.set(recipientId, d)

      imported++
    } catch (e: unknown) {
      errors.push({ row: i, message: e instanceof Error ? e.message : String(e) })
    }
  }

  // Apply recipient counter deltas.
  for (const [recipientId, d] of recipientDeltas) {
    const [r] = await db.select().from(recipients).where(eq(recipients.id, recipientId))
    if (!r) continue
    await db
      .update(recipients)
      .set({
        total_sends: r.total_sends + d.sends,
        total_opens: r.total_opens + d.opens,
        total_clicks: r.total_clicks + d.clicks,
        total_bounces: r.total_bounces + d.bounces,
        total_complaints: r.total_complaints + d.complaints,
        last_engaged_at:
          d.lastEngaged && (!r.last_engaged_at || d.lastEngaged > r.last_engaged_at)
            ? d.lastEngaged
            : r.last_engaged_at,
      })
      .where(eq(recipients.id, recipientId))
  }

  const [updated] = await db
    .update(imports)
    .set({
      status: errors.length === body.rows.length ? 'failed' : 'completed',
      rows_imported: imported,
      rows_failed: errors.length,
      errors,
    })
    .where(eq(imports.id, imp.id))
    .returning()

  await logActivity(body.workspaceId, userId, 'import', imp.id, {
    rows_imported: imported,
    rows_failed: errors.length,
  })

  return c.json(updated, 201)
})

// POST /sample — seed sample data: senders + campaigns + 90d of events
router.post('/sample', authMiddleware, zValidator('json', sampleSchema), async (c) => {
  const userId = getUserId(c)
  const { workspaceId } = c.req.valid('json')
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Create two sample senders.
  const senderSpecs = [
    { domain: 'mail.acmestore.com', friendly_name: 'Acme Store Marketing', rps: 42 },
    { domain: 'news.acmestore.com', friendly_name: 'Acme Store Newsletter', rps: 18 },
  ]
  const createdSenders: string[] = []
  for (const spec of senderSpecs) {
    const [s] = await db
      .insert(senders)
      .values({
        workspace_id: workspaceId,
        domain: spec.domain,
        subdomain: null,
        friendly_name: spec.friendly_name,
        status: 'active',
        revenue_per_send_cents: spec.rps,
        created_by: userId,
      })
      .returning()
    createdSenders.push(s.id)
  }

  // Create the import job (sample).
  const [imp] = await db
    .insert(imports)
    .values({
      workspace_id: workspaceId,
      sender_id: createdSenders[0],
      source: 'sample',
      status: 'processing',
      filename: 'sample-90d.csv',
      is_sample: true,
      created_by: userId,
    })
    .returning()

  // Deterministic-ish PRNG for repeatable shapes.
  let seed = 0x5eed
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }

  // Build a recipient pool.
  const RECIPIENT_COUNT = 120
  const recipientIds: string[] = []
  for (let i = 0; i < RECIPIENT_COUNT; i++) {
    const isRole = i % 25 === 0
    const email = isRole
      ? `support${i}@example${i % 7}.com`
      : `user${i}@example${i % 7}.com`
    const id = await upsertRecipient(workspaceId, email)
    recipientIds.push(id)
  }

  const now = Date.now()
  const DAY = 86_400_000
  let totalEvents = 0
  let counter = 0

  // 90 days, a campaign every ~3 days per sender.
  for (const senderId of createdSenders) {
    for (let day = 90; day >= 0; day -= 3) {
      const sentAt = new Date(now - day * DAY)
      const [campaign] = await db
        .insert(campaigns)
        .values({
          workspace_id: workspaceId,
          sender_id: senderId,
          name: `Campaign ${sentAt.toISOString().slice(0, 10)}`,
          subject: `Weekly offers ${sentAt.toISOString().slice(0, 10)}`,
          sent_at: sentAt,
        })
        .returning()

      // Each campaign goes to a random subset of recipients.
      const audienceSize = 40 + Math.floor(rand() * 60)
      for (let r = 0; r < audienceSize; r++) {
        const recipientId = recipientIds[Math.floor(rand() * recipientIds.length)]
        const base = `${campaign.id}-${recipientId}-${counter++}`

        // Engagement decays slightly over recency (older days lower engagement).
        const openP = 0.22 + rand() * 0.18
        const clickP = openP * (0.25 + rand() * 0.2)
        const bounceP = 0.01 + rand() * 0.02
        const complaintP = 0.0005 + rand() * 0.0015

        const ev = async (type: string, bounceType: string | null = null, offsetMin = 0) => {
          await db
            .insert(send_events)
            .values({
              workspace_id: workspaceId,
              sender_id: senderId,
              campaign_id: campaign.id,
              recipient_id: recipientId,
              import_id: imp.id,
              message_id: `${base}-${type}`,
              event_type: type,
              bounce_type: bounceType,
              event_at: new Date(sentAt.getTime() + offsetMin * 60_000),
            })
            .onConflictDoNothing({
              target: [send_events.workspace_id, send_events.message_id, send_events.event_type],
            })
          totalEvents++
        }

        await ev('sent')
        const roll = rand()
        if (roll < bounceP) {
          await ev('bounce', rand() < 0.6 ? 'hard' : 'soft', 5)
          continue
        }
        await ev('delivered', null, 1)
        if (rand() < openP) {
          await ev('open', null, 30)
          if (rand() < clickP / openP) await ev('click', null, 35)
        }
        if (rand() < complaintP) await ev('complaint', null, 60)
        else if (rand() < 0.01) await ev('unsubscribe', null, 90)
      }
    }
  }

  // Roll up recipient counters from the events we generated.
  for (const recipientId of recipientIds) {
    const evs = await db
      .select({ event_type: send_events.event_type, event_at: send_events.event_at })
      .from(send_events)
      .where(
        and(eq(send_events.workspace_id, workspaceId), eq(send_events.recipient_id, recipientId)),
      )
    let sends = 0
    let opens = 0
    let clicks = 0
    let bounces = 0
    let complaints = 0
    let lastEngaged: Date | null = null
    for (const e of evs) {
      if (e.event_type === 'sent') sends++
      else if (e.event_type === 'open') opens++
      else if (e.event_type === 'click') clicks++
      else if (e.event_type === 'bounce') bounces++
      else if (e.event_type === 'complaint') complaints++
      if ((e.event_type === 'open' || e.event_type === 'click') && e.event_at) {
        if (!lastEngaged || e.event_at > lastEngaged) lastEngaged = e.event_at
      }
    }
    await db
      .update(recipients)
      .set({
        total_sends: sends,
        total_opens: opens,
        total_clicks: clicks,
        total_bounces: bounces,
        total_complaints: complaints,
        last_engaged_at: lastEngaged,
        status: bounces >= 2 ? 'bounced' : lastEngaged ? 'active' : 'dormant',
      })
      .where(eq(recipients.id, recipientId))
  }

  const [updated] = await db
    .update(imports)
    .set({
      status: 'completed',
      rows_total: totalEvents,
      rows_imported: totalEvents,
      rows_failed: 0,
    })
    .where(eq(imports.id, imp.id))
    .returning()

  await logActivity(workspaceId, userId, 'seed_sample', imp.id, {
    senders: createdSenders.length,
    events: totalEvents,
  })

  return c.json({ import: updated })
})

// DELETE /:id — delete an import and its events
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [imp] = await db.select().from(imports).where(eq(imports.id, id))
  if (!imp) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(imp.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  // Remove the events ingested by this import first (FK to imports).
  await db.delete(send_events).where(eq(send_events.import_id, id))
  await db.delete(imports).where(eq(imports.id, id))
  await logActivity(imp.workspace_id, userId, 'delete', id, { filename: imp.filename })
  return c.json({ success: true })
})

export default router
