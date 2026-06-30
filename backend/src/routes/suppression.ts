import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspace_members,
  senders,
  recipients,
  suppression_recommendations,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if `userId` is a member of `workspaceId`. */
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
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

const REASON_BACKOFFS: Record<string, number> = {
  hard_bounce: 1.0,
  complaint: 1.0,
  repeated_soft_bounce: 0.6,
  dormant: 0.4,
  role_account: 0.3,
}

// ---------------------------------------------------------------------------
// GET / — list recommendations ?workspaceId&status?
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  const status = c.req.query('status')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const conds = [eq(suppression_recommendations.workspace_id, workspaceId)]
  if (status) conds.push(eq(suppression_recommendations.status, status))

  const rows = await db
    .select()
    .from(suppression_recommendations)
    .where(and(...conds))
    .orderBy(desc(suppression_recommendations.revenue_impact_cents))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /compute — regenerate recommendations {workspaceId,senderId?}
// ---------------------------------------------------------------------------

const computeSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().optional(),
})

router.post('/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const { workspaceId, senderId } = c.req.valid('json')
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Resolve a per-send revenue figure for impact estimation.
  let revenuePerSendCents = 0
  if (senderId) {
    const [s] = await db
      .select()
      .from(senders)
      .where(and(eq(senders.id, senderId), eq(senders.workspace_id, workspaceId)))
    if (!s) return c.json({ error: 'Sender not found' }, 404)
    revenuePerSendCents = s.revenue_per_send_cents ?? 0
  } else {
    const sList = await db.select().from(senders).where(eq(senders.workspace_id, workspaceId))
    const vals = sList.map((s) => s.revenue_per_send_cents ?? 0).filter((v) => v > 0)
    revenuePerSendCents = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
  }

  // Pull recipients for the workspace and derive candidates.
  const recips = await db
    .select()
    .from(recipients)
    .where(eq(recipients.workspace_id, workspaceId))

  const NOW = Date.now()
  const DORMANT_MS = 90 * 86_400_000

  // Clear any prior pending recommendations for this scope so recompute is idempotent.
  await db
    .delete(suppression_recommendations)
    .where(
      and(
        eq(suppression_recommendations.workspace_id, workspaceId),
        eq(suppression_recommendations.status, 'pending'),
        ...(senderId ? [eq(suppression_recommendations.sender_id, senderId)] : []),
      ),
    )

  const toInsert: Array<typeof suppression_recommendations.$inferInsert> = []

  for (const r of recips) {
    let reasonCode: string | null = null
    let reason = ''

    if ((r.total_complaints ?? 0) > 0) {
      reasonCode = 'complaint'
      reason = `Recipient registered ${r.total_complaints} complaint(s); suppress to protect reputation.`
    } else if ((r.total_bounces ?? 0) >= 2) {
      reasonCode = 'repeated_soft_bounce'
      reason = `Recipient bounced ${r.total_bounces} time(s); repeated delivery failures.`
    } else if (r.status === 'bounced') {
      reasonCode = 'hard_bounce'
      reason = 'Recipient address hard-bounced and is undeliverable.'
    } else if (r.is_role_account) {
      reasonCode = 'role_account'
      reason = 'Role-based address (info@, support@, etc.) — low engagement, high complaint risk.'
    } else if (
      r.last_engaged_at &&
      NOW - new Date(r.last_engaged_at).getTime() > DORMANT_MS
    ) {
      reasonCode = 'dormant'
      reason = 'No engagement in over 90 days; dormant recipient dragging deliverability.'
    } else if (!r.last_engaged_at && (r.total_sends ?? 0) >= 5) {
      reasonCode = 'dormant'
      reason = `Never engaged across ${r.total_sends} sends; chronically unengaged.`
    }

    if (!reasonCode) continue

    // Revenue impact = expected forfeited revenue from removing this recipient,
    // weighted down by how unlikely the recipient is to ever convert.
    const backoff = REASON_BACKOFFS[reasonCode] ?? 0.5
    const expectedSends = Math.max(1, r.total_sends ?? 1)
    const impact = Math.round(revenuePerSendCents * expectedSends * backoff)

    toInsert.push({
      workspace_id: workspaceId,
      sender_id: senderId ?? null,
      recipient_id: r.id,
      target_email: r.email,
      reason_code: reasonCode,
      reason,
      revenue_impact_cents: impact,
      status: 'pending',
    })
  }

  if (toInsert.length) {
    await db.insert(suppression_recommendations).values(toInsert)
  }

  const rows = await db
    .select()
    .from(suppression_recommendations)
    .where(
      and(
        eq(suppression_recommendations.workspace_id, workspaceId),
        ...(senderId ? [eq(suppression_recommendations.sender_id, senderId)] : []),
      ),
    )
    .orderBy(desc(suppression_recommendations.revenue_impact_cents))
  return c.json(rows, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — accept/dismiss {status}
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  status: z.enum(['pending', 'accepted', 'dismissed']),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { status } = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(suppression_recommendations)
    .where(eq(suppression_recommendations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(suppression_recommendations)
    .set({ status })
    .where(eq(suppression_recommendations.id, id))
    .returning()

  // Mirror an accepted suppression onto the recipient record.
  if (status === 'accepted' && existing.recipient_id) {
    await db
      .update(recipients)
      .set({ status: 'suppressed' })
      .where(eq(recipients.id, existing.recipient_id))
  }

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// GET /export — accepted suppression list ?workspaceId
// ---------------------------------------------------------------------------

router.get('/export', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select({
      target_email: suppression_recommendations.target_email,
      recipient_id: suppression_recommendations.recipient_id,
    })
    .from(suppression_recommendations)
    .where(
      and(
        eq(suppression_recommendations.workspace_id, workspaceId),
        eq(suppression_recommendations.status, 'accepted'),
      ),
    )

  const emails = new Set<string>()
  const missingIds: string[] = []
  for (const r of rows) {
    if (r.target_email) emails.add(r.target_email)
    else if (r.recipient_id) missingIds.push(r.recipient_id)
  }

  // Backfill emails for rows that only carried a recipient_id.
  if (missingIds.length) {
    const recs = await db
      .select({ id: recipients.id, email: recipients.email })
      .from(recipients)
      .where(inArray(recipients.id, missingIds))
    for (const r of recs) if (r.email) emails.add(r.email)
  }

  return c.json({ emails: Array.from(emails).sort() })
})

export default router
