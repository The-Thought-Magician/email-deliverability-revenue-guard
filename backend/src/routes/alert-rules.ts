import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { alert_rules, workspace_members, senders, segments } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

const METRICS = [
  'complaint_rate',
  'bounce_rate',
  'hard_bounce_rate',
  'engagement_rate',
  'placement_score',
  'revenue_at_risk_cents',
] as const

const COMPARISONS = ['gt', 'gte', 'lt', 'lte', 'eq'] as const

const createSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1).optional().nullable(),
  segmentId: z.string().min(1).optional().nullable(),
  metric: z.enum(METRICS),
  threshold: z.number().finite(),
  comparison: z.enum(COMPARISONS).optional().default('gt'),
  enabled: z.boolean().optional().default(true),
})

const updateSchema = z.object({
  metric: z.enum(METRICS).optional(),
  threshold: z.number().finite().optional(),
  comparison: z.enum(COMPARISONS).optional(),
  enabled: z.boolean().optional(),
  senderId: z.string().min(1).optional().nullable(),
  segmentId: z.string().min(1).optional().nullable(),
})

// ---------------------------------------------------------------------------
// GET / — list rules for a workspace
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(alert_rules)
    .where(eq(alert_rules.workspace_id, workspaceId))
    .orderBy(desc(alert_rules.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — create a rule
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Validate scoped sender/segment belong to the same workspace.
  if (body.senderId) {
    const [s] = await db.select().from(senders).where(eq(senders.id, body.senderId))
    if (!s || s.workspace_id !== body.workspaceId)
      return c.json({ error: 'Sender not in workspace' }, 400)
  }
  if (body.segmentId) {
    const [seg] = await db.select().from(segments).where(eq(segments.id, body.segmentId))
    if (!seg || seg.workspace_id !== body.workspaceId)
      return c.json({ error: 'Segment not in workspace' }, 400)
  }

  const [created] = await db
    .insert(alert_rules)
    .values({
      workspace_id: body.workspaceId,
      sender_id: body.senderId ?? null,
      segment_id: body.segmentId ?? null,
      metric: body.metric,
      threshold: body.threshold,
      comparison: body.comparison,
      enabled: body.enabled,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update a rule
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(alert_rules).where(eq(alert_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  if (body.senderId) {
    const [s] = await db.select().from(senders).where(eq(senders.id, body.senderId))
    if (!s || s.workspace_id !== existing.workspace_id)
      return c.json({ error: 'Sender not in workspace' }, 400)
  }
  if (body.segmentId) {
    const [seg] = await db.select().from(segments).where(eq(segments.id, body.segmentId))
    if (!seg || seg.workspace_id !== existing.workspace_id)
      return c.json({ error: 'Segment not in workspace' }, 400)
  }

  const patch: Record<string, unknown> = {}
  if (body.metric !== undefined) patch.metric = body.metric
  if (body.threshold !== undefined) patch.threshold = body.threshold
  if (body.comparison !== undefined) patch.comparison = body.comparison
  if (body.enabled !== undefined) patch.enabled = body.enabled
  if (body.senderId !== undefined) patch.sender_id = body.senderId
  if (body.segmentId !== undefined) patch.segment_id = body.segmentId

  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db
    .update(alert_rules)
    .set(patch)
    .where(eq(alert_rules.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete a rule
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alert_rules).where(eq(alert_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(alert_rules).where(eq(alert_rules.id, id))
  return c.json({ success: true })
})

export default router
