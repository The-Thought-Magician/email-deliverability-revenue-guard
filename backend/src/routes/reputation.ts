import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  reputation_timeline,
  send_events,
  workspace_members,
  senders,
} from '../db/schema.js'
import { eq, and, asc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

router.use('*', authMiddleware)

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

// Truncate an instant to its UTC day boundary.
function dayBucket(d: Date): Date {
  const b = new Date(d.getTime())
  b.setUTCHours(0, 0, 0, 0)
  return b
}

interface BucketAgg {
  sends: number
  deliveries: number
  opens: number
  clicks: number
  bounces: number
  complaints: number
}

// GET / — reputation timeline ?workspaceId&senderId — ascending series of points.
router.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  const senderId = c.req.query('senderId')
  if (!workspaceId || !senderId) {
    return c.json({ error: 'workspaceId and senderId required' }, 400)
  }
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(reputation_timeline)
    .where(
      and(
        eq(reputation_timeline.workspace_id, workspaceId),
        eq(reputation_timeline.sender_id, senderId),
      ),
    )
    .orderBy(asc(reputation_timeline.bucket_at))

  const points = rows.map((r) => ({
    bucketAt: r.bucket_at,
    complaintRate: r.complaint_rate,
    bounceRate: r.bounce_rate,
    engagementRate: r.engagement_rate,
    placementScore: r.placement_score,
    annotation: r.annotation,
  }))
  return c.json({ points })
})

const rebuildSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1),
})

// POST /rebuild — rebuild the timeline from send_events for a sender.
router.post('/rebuild', zValidator('json', rebuildSchema), async (c) => {
  const userId = getUserId(c)
  const { workspaceId, senderId } = c.req.valid('json')
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [sender] = await db
    .select()
    .from(senders)
    .where(and(eq(senders.id, senderId), eq(senders.workspace_id, workspaceId)))
  if (!sender) return c.json({ error: 'Sender not found in workspace' }, 404)

  // Pull all events for this sender and bucket them by UTC day.
  const events = await db
    .select()
    .from(send_events)
    .where(
      and(
        eq(send_events.workspace_id, workspaceId),
        eq(send_events.sender_id, senderId),
      ),
    )

  const buckets = new Map<string, BucketAgg>()
  for (const e of events) {
    if (!e.event_at) continue
    const key = dayBucket(new Date(e.event_at)).toISOString()
    let agg = buckets.get(key)
    if (!agg) {
      agg = { sends: 0, deliveries: 0, opens: 0, clicks: 0, bounces: 0, complaints: 0 }
      buckets.set(key, agg)
    }
    switch (e.event_type) {
      case 'send':
      case 'sent':
        agg.sends += 1
        break
      case 'delivery':
      case 'delivered':
        agg.deliveries += 1
        break
      case 'open':
      case 'opened':
        agg.opens += 1
        break
      case 'click':
      case 'clicked':
        agg.clicks += 1
        break
      case 'bounce':
      case 'bounced':
        agg.bounces += 1
        break
      case 'complaint':
      case 'complained':
      case 'spam':
        agg.complaints += 1
        break
      default:
        break
    }
  }

  // Replace any prior timeline rows for this sender.
  await db
    .delete(reputation_timeline)
    .where(
      and(
        eq(reputation_timeline.workspace_id, workspaceId),
        eq(reputation_timeline.sender_id, senderId),
      ),
    )

  const orderedKeys = Array.from(buckets.keys()).sort((a, b) => a.localeCompare(b))
  const inserted: typeof reputation_timeline.$inferSelect[] = []

  for (const key of orderedKeys) {
    const agg = buckets.get(key)!
    // Denominator for rates: prefer delivered, fall back to sends, then to any volume.
    const denom = agg.deliveries > 0 ? agg.deliveries : agg.sends > 0 ? agg.sends : agg.opens + agg.clicks + agg.bounces + agg.complaints
    const safeDenom = denom > 0 ? denom : 1
    const complaintRate = agg.complaints / safeDenom
    const bounceRate = agg.bounces / safeDenom
    const engagementRate = (agg.opens + agg.clicks) / safeDenom

    // Placement score 0..100: start at 100, penalise complaints and bounces heavily,
    // reward engagement. Complaints are by far the worst signal at Gmail/Yahoo.
    let score = 100
    score -= Math.min(60, complaintRate * 100 * 200) // 0.3% complaints ≈ -60
    score -= Math.min(30, bounceRate * 100 * 5) // 6% bounce ≈ -30
    score += Math.min(15, engagementRate * 100 * 0.5) // engagement nudge
    score = Math.max(0, Math.min(100, score))

    const [row] = await db
      .insert(reputation_timeline)
      .values({
        workspace_id: workspaceId,
        sender_id: senderId,
        bucket_at: new Date(key),
        complaint_rate: complaintRate,
        bounce_rate: bounceRate,
        engagement_rate: engagementRate,
        placement_score: score,
        annotation: null,
      })
      .returning()
    inserted.push(row)
  }

  const points = inserted.map((r) => ({
    bucketAt: r.bucket_at,
    complaintRate: r.complaint_rate,
    bounceRate: r.bounce_rate,
    engagementRate: r.engagement_rate,
    placementScore: r.placement_score,
    annotation: r.annotation,
  }))
  return c.json({ points })
})

export default router
