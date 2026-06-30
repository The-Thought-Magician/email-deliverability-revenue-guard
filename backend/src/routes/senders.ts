import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  senders,
  workspace_members,
  workspaces,
  send_events,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

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
      entity_type: 'sender',
      entity_id: entityId,
      detail,
    })
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  workspaceId: z.string().min(1),
  domain: z.string().min(1),
  subdomain: z.string().optional(),
  friendly_name: z.string().min(1),
  status: z.enum(['active', 'warming', 'paused', 'archived']).optional(),
  revenue_per_send_cents: z.number().int().nonnegative().nullable().optional(),
})

const updateSchema = z.object({
  domain: z.string().min(1).optional(),
  subdomain: z.string().nullable().optional(),
  friendly_name: z.string().min(1).optional(),
  status: z.enum(['active', 'warming', 'paused', 'archived']).optional(),
  revenue_per_send_cents: z.number().int().nonnegative().nullable().optional(),
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — list senders for ?workspaceId
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(senders)
    .where(eq(senders.workspace_id, workspaceId))
    .orderBy(desc(senders.created_at))
  return c.json(rows)
})

// POST / — create sender
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [s] = await db
    .insert(senders)
    .values({
      workspace_id: body.workspaceId,
      domain: body.domain,
      subdomain: body.subdomain,
      friendly_name: body.friendly_name,
      status: body.status ?? 'active',
      revenue_per_send_cents: body.revenue_per_send_cents ?? null,
      created_by: userId,
    })
    .returning()
  await logActivity(body.workspaceId, userId, 'create', s.id, { domain: s.domain })
  return c.json(s, 201)
})

// GET /:id — detail + summary metrics + per-sender revenue override
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [s] = await db.select().from(senders).where(eq(senders.id, id))
  if (!s) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(s.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Compute summary metrics from send_events for this sender.
  const events = await db
    .select({ event_type: send_events.event_type })
    .from(send_events)
    .where(eq(send_events.sender_id, id))

  const counts: Record<string, number> = {}
  for (const e of events) counts[e.event_type] = (counts[e.event_type] ?? 0) + 1

  const sent = counts['sent'] ?? 0
  const delivered = counts['delivered'] ?? sent
  const opens = counts['open'] ?? 0
  const clicks = counts['click'] ?? 0
  const bounces = counts['bounce'] ?? 0
  const complaints = counts['complaint'] ?? 0
  const unsubscribes = counts['unsubscribe'] ?? 0
  const denom = sent || delivered || 1

  // Effective revenue-per-send: explicit per-sender override, else workspace default.
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, s.workspace_id))
  const revenuePerSendCents = s.revenue_per_send_cents ?? null

  const summary = {
    total_sends: sent,
    total_delivered: delivered,
    total_opens: opens,
    total_clicks: clicks,
    total_bounces: bounces,
    total_complaints: complaints,
    total_unsubscribes: unsubscribes,
    open_rate: opens / denom,
    click_rate: clicks / denom,
    bounce_rate: bounces / denom,
    complaint_rate: complaints / denom,
    unsubscribe_rate: unsubscribes / denom,
    estimated_revenue_cents: revenuePerSendCents != null ? revenuePerSendCents * sent : null,
  }

  return c.json({
    ...s,
    revenue_per_send_cents: revenuePerSendCents,
    currency: ws?.currency ?? 'USD',
    summary,
  })
})

// PUT /:id — update (status, friendly_name, revenue_per_send, etc.)
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(senders).where(eq(senders.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(senders)
    .set({ ...body, updated_at: new Date() })
    .where(eq(senders.id, id))
    .returning()
  await logActivity(existing.workspace_id, userId, 'update', id, body)
  return c.json(updated)
})

// DELETE /:id — archive/delete
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(senders).where(eq(senders.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  // Soft-archive if the sender has events tied to it; hard-delete otherwise.
  const [hasEvent] = await db
    .select({ id: send_events.id })
    .from(send_events)
    .where(eq(send_events.sender_id, id))
    .limit(1)
  if (hasEvent) {
    await db
      .update(senders)
      .set({ status: 'archived', updated_at: new Date() })
      .where(eq(senders.id, id))
    await logActivity(existing.workspace_id, userId, 'archive', id, {})
  } else {
    await db.delete(senders).where(eq(senders.id, id))
    await logActivity(existing.workspace_id, userId, 'delete', id, {})
  }
  return c.json({ success: true })
})

export default router
