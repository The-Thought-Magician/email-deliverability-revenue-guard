import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  revenue_models,
  workspace_members,
  send_events,
  campaigns,
  activity_log,
} from '../db/schema.js'
import { and, desc, eq, max } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if the user is a member of the workspace. */
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
    .limit(1)
  return !!m
}

/**
 * Derive per-send economic value from historical send events.
 *
 * Strategy: count delivered/open/click events as proxies for revenue-bearing
 * sends and conversions. We treat `delivered` (or `sent`) events as the send
 * denominator and `click` events as conversions. AOV is taken from any campaign
 * metadata `aov_cents` when present, otherwise a sane default. Per-send value is
 * conversionRate * aovCents (rounded to whole cents).
 */
async function deriveFromHistory(
  workspaceId: string,
  senderId: string | null,
): Promise<{ revenuePerSendCents: number; conversionRate: number; aovCents: number; basis: Record<string, number> }> {
  const conds = [eq(send_events.workspace_id, workspaceId)]
  if (senderId) conds.push(eq(send_events.sender_id, senderId))
  const rows = await db
    .select({ event_type: send_events.event_type })
    .from(send_events)
    .where(and(...conds))

  let sends = 0
  let clicks = 0
  let opens = 0
  for (const r of rows) {
    const t = r.event_type
    if (t === 'delivered' || t === 'sent') sends++
    else if (t === 'click') clicks++
    else if (t === 'open') opens++
  }
  // If no explicit delivered/sent events, fall back to opens+clicks as sends proxy.
  if (sends === 0) sends = opens + clicks

  // Pull AOV from campaign metadata if available.
  const camps = await db
    .select({ metadata: campaigns.metadata })
    .from(campaigns)
    .where(eq(campaigns.workspace_id, workspaceId))
  let aovSum = 0
  let aovCount = 0
  for (const cp of camps) {
    const md = (cp.metadata ?? {}) as Record<string, unknown>
    const v = md.aov_cents
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      aovSum += v
      aovCount++
    }
  }
  const aovCents = aovCount > 0 ? Math.round(aovSum / aovCount) : 5000

  const conversionRate = sends > 0 ? clicks / sends : 0
  const revenuePerSendCents = Math.round(conversionRate * aovCents)

  return {
    revenuePerSendCents,
    conversionRate,
    aovCents,
    basis: { sends, clicks, opens },
  }
}

const createSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1).optional(),
  revenuePerSendCents: z.number().int().min(0),
  conversionRate: z.number().min(0).max(1).optional(),
  aovCents: z.number().int().min(0).optional(),
  source: z.string().min(1).optional().default('manual'),
})

const deriveSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1).optional(),
})

// ---------------------------------------------------------------------------
// GET / — active model + versions for ?workspaceId&senderId?
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  const senderId = c.req.query('senderId') ?? null
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const conds = [eq(revenue_models.workspace_id, workspaceId)]
  if (senderId) conds.push(eq(revenue_models.sender_id, senderId))

  const versions = await db
    .select()
    .from(revenue_models)
    .where(and(...conds))
    .orderBy(desc(revenue_models.version))

  const active = versions.find((v) => v.is_active) ?? null
  return c.json({ active, versions })
})

// ---------------------------------------------------------------------------
// POST / — create a new model version (deactivates prior active models)
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const senderId = body.senderId ?? null

  // Compute the next version number scoped to workspace+sender.
  const scopeConds = [eq(revenue_models.workspace_id, body.workspaceId)]
  if (senderId) scopeConds.push(eq(revenue_models.sender_id, senderId))
  const [{ maxVersion } = { maxVersion: null }] = await db
    .select({ maxVersion: max(revenue_models.version) })
    .from(revenue_models)
    .where(and(...scopeConds))
  const nextVersion = (maxVersion ?? 0) + 1

  // Deactivate prior active models within the same scope.
  const deactivateConds = [
    eq(revenue_models.workspace_id, body.workspaceId),
    eq(revenue_models.is_active, true),
  ]
  if (senderId) deactivateConds.push(eq(revenue_models.sender_id, senderId))
  await db
    .update(revenue_models)
    .set({ is_active: false })
    .where(and(...deactivateConds))

  const [created] = await db
    .insert(revenue_models)
    .values({
      workspace_id: body.workspaceId,
      sender_id: senderId,
      version: nextVersion,
      revenue_per_send_cents: body.revenuePerSendCents,
      conversion_rate: body.conversionRate ?? null,
      aov_cents: body.aovCents ?? null,
      source: body.source,
      is_active: true,
      created_by: userId,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: body.workspaceId,
    user_id: userId,
    action: 'revenue_model.create',
    entity_type: 'revenue_model',
    entity_id: created.id,
    detail: { version: nextVersion, revenue_per_send_cents: body.revenuePerSendCents },
  })

  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// POST /derive — derive per-send value from history (does not persist)
// ---------------------------------------------------------------------------

router.post('/derive', authMiddleware, zValidator('json', deriveSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const derived = await deriveFromHistory(body.workspaceId, body.senderId ?? null)
  return c.json(derived)
})

export default router
