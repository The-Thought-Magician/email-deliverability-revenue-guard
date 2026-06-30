import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspace_members,
  senders,
  recipients,
  engagement_cohorts,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

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

// Standard recency/frequency cohorts. recencyDays = max days since last
// engagement; minFrequency = minimum total sends to qualify.
const STANDARD_COHORTS: Array<{ name: string; recencyDays: number; minFrequency: number }> = [
  { name: 'Highly Engaged (0-30d)', recencyDays: 30, minFrequency: 3 },
  { name: 'Engaged (31-90d)', recencyDays: 90, minFrequency: 2 },
  { name: 'Lapsing (91-180d)', recencyDays: 180, minFrequency: 1 },
  { name: 'Dormant (180d+)', recencyDays: 100000, minFrequency: 1 },
]

// ---------------------------------------------------------------------------
// GET / — list cohorts ?workspaceId&senderId?
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  const senderId = c.req.query('senderId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const conds = [eq(engagement_cohorts.workspace_id, workspaceId)]
  if (senderId) conds.push(eq(engagement_cohorts.sender_id, senderId))

  const rows = await db
    .select()
    .from(engagement_cohorts)
    .where(and(...conds))
    .orderBy(desc(engagement_cohorts.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /compute — (re)compute standard cohorts {workspaceId,senderId?}
// ---------------------------------------------------------------------------

const computeSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().optional(),
})

router.post('/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const { workspaceId, senderId } = c.req.valid('json')
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

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

  const recips = await db
    .select()
    .from(recipients)
    .where(eq(recipients.workspace_id, workspaceId))

  const NOW = Date.now()

  function daysSinceEngaged(lastEngaged: Date | null): number {
    if (!lastEngaged) return Number.POSITIVE_INFINITY
    return (NOW - new Date(lastEngaged).getTime()) / 86_400_000
  }

  // Assign each recipient to the first matching (narrowest) recency band so
  // cohorts are mutually exclusive.
  const buckets = STANDARD_COHORTS.map(() => [] as typeof recips)
  for (const r of recips) {
    const days = daysSinceEngaged(r.last_engaged_at)
    const freq = r.total_sends ?? 0
    for (let i = 0; i < STANDARD_COHORTS.length; i++) {
      const spec = STANDARD_COHORTS[i]
      const lowerBound = i === 0 ? 0 : STANDARD_COHORTS[i - 1].recencyDays
      if (days >= lowerBound && days < spec.recencyDays && freq >= spec.minFrequency) {
        buckets[i].push(r)
        break
      }
      if (i === STANDARD_COHORTS.length - 1 && freq >= spec.minFrequency && days >= lowerBound) {
        buckets[i].push(r)
      }
    }
  }

  // Replace prior cohorts for this scope (idempotent recompute).
  await db
    .delete(engagement_cohorts)
    .where(
      and(
        eq(engagement_cohorts.workspace_id, workspaceId),
        ...(senderId
          ? [eq(engagement_cohorts.sender_id, senderId)]
          : []),
      ),
    )

  const toInsert: Array<typeof engagement_cohorts.$inferInsert> = []
  for (let i = 0; i < STANDARD_COHORTS.length; i++) {
    const spec = STANDARD_COHORTS[i]
    const members = buckets[i]
    const memberCount = members.length

    let totalSends = 0
    let totalOpens = 0
    let totalClicks = 0
    for (const m of members) {
      totalSends += m.total_sends ?? 0
      totalOpens += m.total_opens ?? 0
      totalClicks += m.total_clicks ?? 0
    }
    const engagementRate = totalSends > 0 ? (totalOpens + totalClicks) / totalSends : 0
    const revenueContribution = revenuePerSendCents * totalSends

    toInsert.push({
      workspace_id: workspaceId,
      sender_id: senderId ?? null,
      name: spec.name,
      recency_days: spec.recencyDays === 100000 ? null : spec.recencyDays,
      min_frequency: spec.minFrequency,
      member_count: memberCount,
      engagement_rate: engagementRate,
      revenue_contribution_cents: revenueContribution,
    })
  }

  if (toInsert.length) {
    await db.insert(engagement_cohorts).values(toInsert)
  }

  const rows = await db
    .select()
    .from(engagement_cohorts)
    .where(
      and(
        eq(engagement_cohorts.workspace_id, workspaceId),
        ...(senderId ? [eq(engagement_cohorts.sender_id, senderId)] : []),
      ),
    )
    .orderBy(desc(engagement_cohorts.created_at))
  return c.json(rows, 201)
})

export default router
