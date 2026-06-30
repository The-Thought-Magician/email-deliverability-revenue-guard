import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  fatigue_analyses,
  workspace_members,
  senders,
  segments,
  send_events,
} from '../db/schema.js'
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

const computeSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1).optional().nullable(),
  segmentId: z.string().min(1).optional().nullable(),
  name: z.string().min(1).optional(),
})

interface CurvePoint {
  frequency: number
  engagement_rate: number
}

// ---------------------------------------------------------------------------
// GET / — list fatigue analyses
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(fatigue_analyses)
    .where(eq(fatigue_analyses.workspace_id, workspaceId))
    .orderBy(desc(fatigue_analyses.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /compute — compute frequency/engagement curve
//
// Method: bucket recipients by their weekly send frequency (sends within the
// observed window divided by the number of weeks the window spans). For each
// frequency bucket compute the engagement rate (opens+clicks per send) and the
// complaint rate. Engagement typically declines as send frequency rises; the
// recommended cadence is the frequency bucket that maximises a value proxy
// (engagement) before fatigue sets in. Over-mailing is flagged when engagement
// at the highest-frequency bucket has dropped materially vs the peak.
// ---------------------------------------------------------------------------

router.post('/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Validate scope.
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

  // Pull all events in scope.
  const conds = [eq(send_events.workspace_id, body.workspaceId)]
  if (body.senderId) conds.push(eq(send_events.sender_id, body.senderId))
  if (body.segmentId) conds.push(eq(send_events.segment_id, body.segmentId))

  const events = await db
    .select()
    .from(send_events)
    .where(conds.length === 1 ? conds[0] : and(...conds))

  // Aggregate per recipient.
  interface RecAgg {
    sends: number
    engagements: number
    complaints: number
    firstAt: number
    lastAt: number
  }
  const perRecipient = new Map<string, RecAgg>()
  let globalMin = Infinity
  let globalMax = -Infinity

  for (const e of events) {
    const rid = e.recipient_id ?? `msg:${e.message_id}`
    const at = e.event_at ? new Date(e.event_at).getTime() : Date.now()
    if (at < globalMin) globalMin = at
    if (at > globalMax) globalMax = at
    let agg = perRecipient.get(rid)
    if (!agg) {
      agg = { sends: 0, engagements: 0, complaints: 0, firstAt: at, lastAt: at }
      perRecipient.set(rid, agg)
    }
    if (at < agg.firstAt) agg.firstAt = at
    if (at > agg.lastAt) agg.lastAt = at
    const type = e.event_type
    if (type === 'send' || type === 'delivery' || type === 'delivered') agg.sends += 1
    else if (type === 'open' || type === 'click') agg.engagements += 1
    else if (type === 'complaint' || type === 'spam') agg.complaints += 1
  }

  // Window length in weeks (>= 1 to avoid divide-by-zero).
  const spanMs = globalMax > globalMin ? globalMax - globalMin : 0
  const weeks = Math.max(1, spanMs / (7 * 86_400_000))

  // Bucket by integer weekly cadence: 1,2,3,4,5+ sends/week.
  interface Bucket {
    sends: number
    engagements: number
    complaints: number
    recipients: number
  }
  const buckets = new Map<number, Bucket>()
  for (const agg of perRecipient.values()) {
    if (agg.sends === 0) continue
    const perWeek = agg.sends / weeks
    let cadence = Math.round(perWeek)
    if (cadence < 1) cadence = 1
    if (cadence > 5) cadence = 5
    let b = buckets.get(cadence)
    if (!b) {
      b = { sends: 0, engagements: 0, complaints: 0, recipients: 0 }
      buckets.set(cadence, b)
    }
    b.sends += agg.sends
    b.engagements += agg.engagements
    b.complaints += agg.complaints
    b.recipients += 1
  }

  const curve: CurvePoint[] = []
  const complaintByFreq = new Map<number, number>()
  for (let f = 1; f <= 5; f++) {
    const b = buckets.get(f)
    if (!b || b.sends === 0) continue
    const engagementRate = b.engagements / b.sends
    const complaintRate = b.complaints / b.sends
    curve.push({ frequency: f, engagement_rate: Number(engagementRate.toFixed(4)) })
    complaintByFreq.set(f, complaintRate)
  }

  // Recommended cadence = frequency with the highest engagement rate.
  let recommended = 1
  let peakEngagement = 0
  for (const p of curve) {
    if (p.engagement_rate > peakEngagement) {
      peakEngagement = p.engagement_rate
      recommended = p.frequency
    }
  }
  if (curve.length === 0) recommended = 1

  // Over-mailing: highest observed frequency engagement is materially below peak.
  const maxFreq = curve.length ? curve[curve.length - 1].frequency : 1
  const engagementAtMax = curve.length ? curve[curve.length - 1].engagement_rate : 0
  const isOvermailing =
    curve.length > 1 && maxFreq > recommended && engagementAtMax < peakEngagement * 0.75

  // Projected complaint reduction if cadence is dialed back to recommended.
  const complaintAtMax = complaintByFreq.get(maxFreq) ?? 0
  const complaintAtRec = complaintByFreq.get(recommended) ?? complaintAtMax
  const projectedComplaintReduction =
    complaintAtMax > 0 ? Math.max(0, (complaintAtMax - complaintAtRec) / complaintAtMax) : 0

  const name =
    body.name ??
    `Fatigue analysis ${new Date().toISOString().slice(0, 10)}${body.senderId ? '' : ' (all senders)'}`

  const [created] = await db
    .insert(fatigue_analyses)
    .values({
      workspace_id: body.workspaceId,
      sender_id: body.senderId ?? null,
      segment_id: body.segmentId ?? null,
      name,
      curve,
      recommended_cadence_per_week: recommended,
      projected_complaint_reduction: Number(projectedComplaintReduction.toFixed(4)),
      is_overmailing: isOvermailing,
    })
    .returning()

  return c.json(created, 201)
})

export default router
