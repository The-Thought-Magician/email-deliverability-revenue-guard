import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { placement_scores, send_events, senders, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

router.use('*', authMiddleware)

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

const computeSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1),
})

/**
 * Inbox-placement proxy score in [0,100]. We have no direct seed-list data, so
 * we model placement from observable engagement/complaint/bounce signals over a
 * trailing window — the same signals mailbox providers weight.
 */
function scoreFromCounts(counts: {
  sends: number
  opens: number
  clicks: number
  bounces: number
  complaints: number
}): {
  score: number
  engagement_component: number
  complaint_component: number
  bounce_component: number
  components: Record<string, number>
} {
  const sends = Math.max(counts.sends, 0)
  const denom = sends > 0 ? sends : 1
  const openRate = counts.opens / denom
  const clickRate = counts.clicks / denom
  const complaintRate = counts.complaints / denom
  const bounceRate = counts.bounces / denom

  // Engagement: opens + weighted clicks, capped at 1.0, scaled to 50 pts.
  const engagementSignal = Math.min(openRate + clickRate * 1.5, 1)
  const engagement_component = engagementSignal * 50

  // Complaint: providers punish complaints harshly. 0.3% ≈ full penalty.
  const complaintPenalty = Math.min(complaintRate / 0.003, 1)
  const complaint_component = (1 - complaintPenalty) * 30

  // Bounce: 5% ≈ full penalty.
  const bouncePenalty = Math.min(bounceRate / 0.05, 1)
  const bounce_component = (1 - bouncePenalty) * 20

  const score = Math.max(
    0,
    Math.min(100, engagement_component + complaint_component + bounce_component),
  )

  return {
    score,
    engagement_component,
    complaint_component,
    bounce_component,
    components: {
      open_rate: openRate,
      click_rate: clickRate,
      complaint_rate: complaintRate,
      bounce_rate: bounceRate,
      engagement: engagement_component,
      complaint: complaint_component,
      bounce: bounce_component,
    },
  }
}

// GET / — list placement scores ?workspaceId&senderId? → PlacementScore[]
router.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId') ?? ''
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const senderId = c.req.query('senderId')
  const conds = [eq(placement_scores.workspace_id, workspaceId)]
  if (senderId) conds.push(eq(placement_scores.sender_id, senderId))
  const where = conds.length === 1 ? conds[0] : and(...conds)

  const rows = await db
    .select()
    .from(placement_scores)
    .where(where)
    .orderBy(desc(placement_scores.period_end), desc(placement_scores.created_at))

  return c.json(rows)
})

// POST /compute — compute placement score for a sender/period → PlacementScore
router.post('/compute', zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const { workspaceId, senderId } = c.req.valid('json')
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [sender] = await db
    .select()
    .from(senders)
    .where(and(eq(senders.id, senderId), eq(senders.workspace_id, workspaceId)))
  if (!sender) return c.json({ error: 'Sender not found' }, 404)

  // Trailing 30-day window.
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - 30 * 86_400_000)

  const events = await db
    .select({ event_type: send_events.event_type, event_at: send_events.event_at })
    .from(send_events)
    .where(
      and(
        eq(send_events.workspace_id, workspaceId),
        eq(send_events.sender_id, senderId),
      ),
    )

  const counts = { sends: 0, opens: 0, clicks: 0, bounces: 0, complaints: 0 }
  for (const e of events) {
    const at = e.event_at instanceof Date ? e.event_at : new Date(e.event_at as unknown as string)
    if (at < periodStart || at > periodEnd) continue
    switch (e.event_type) {
      case 'send':
      case 'delivered':
        counts.sends++
        break
      case 'open':
        counts.opens++
        break
      case 'click':
        counts.clicks++
        break
      case 'bounce':
        counts.bounces++
        break
      case 'complaint':
      case 'spamreport':
        counts.complaints++
        break
    }
  }

  const s = scoreFromCounts(counts)

  const [inserted] = await db
    .insert(placement_scores)
    .values({
      workspace_id: workspaceId,
      sender_id: senderId,
      period_start: periodStart,
      period_end: periodEnd,
      score: s.score,
      engagement_component: s.engagement_component,
      complaint_component: s.complaint_component,
      bounce_component: s.bounce_component,
      components: s.components,
    })
    .returning()

  return c.json(inserted, 201)
})

// GET /trend — score trend series ?workspaceId&senderId → { points: [] }
router.get('/trend', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId') ?? ''
  const senderId = c.req.query('senderId') ?? ''
  if (!workspaceId || !senderId)
    return c.json({ error: 'workspaceId and senderId are required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(placement_scores)
    .where(
      and(
        eq(placement_scores.workspace_id, workspaceId),
        eq(placement_scores.sender_id, senderId),
      ),
    )
    .orderBy(placement_scores.period_end)

  const points = rows.map((r) => ({
    period_start: r.period_start,
    period_end: r.period_end,
    score: r.score,
    engagement_component: r.engagement_component,
    complaint_component: r.complaint_component,
    bounce_component: r.bounce_component,
  }))

  return c.json({ points })
})

export default router
