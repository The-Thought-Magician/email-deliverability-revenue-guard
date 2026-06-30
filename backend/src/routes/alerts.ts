import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  alerts,
  alert_rules,
  send_events,
  workspace_members,
  activity_log,
  notifications,
} from '../db/schema.js'
import { and, desc, eq } from 'drizzle-orm'
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
    .limit(1)
  return !!m
}

/** Window (days) over which spike metrics are evaluated. */
const SCAN_WINDOW_DAYS = 7

interface MetricCounts {
  sends: number
  complaints: number
  unsubs: number
  bounces: number
  hardBounces: number
}

function emptyCounts(): MetricCounts {
  return { sends: 0, complaints: 0, unsubs: 0, bounces: 0, hardBounces: 0 }
}

/** Compute a rate (0..1) for a given metric name from counts. */
function rateFor(metric: string, counts: MetricCounts): number {
  const denom = counts.sends > 0 ? counts.sends : counts.complaints + counts.unsubs + counts.bounces
  if (denom <= 0) return 0
  switch (metric) {
    case 'complaint_rate':
      return counts.complaints / denom
    case 'unsub_rate':
    case 'unsubscribe_rate':
      return counts.unsubs / denom
    case 'bounce_rate':
      return counts.bounces / denom
    case 'hard_bounce_rate':
      return counts.hardBounces / denom
    default:
      return 0
  }
}

/** Evaluate a comparison operator. */
function breached(observed: number, comparison: string, threshold: number): boolean {
  switch (comparison) {
    case 'gt':
      return observed > threshold
    case 'gte':
      return observed >= threshold
    case 'lt':
      return observed < threshold
    case 'lte':
      return observed <= threshold
    case 'eq':
      return observed === threshold
    default:
      return observed > threshold
  }
}

function severityFor(observed: number, threshold: number): 'info' | 'warning' | 'critical' {
  if (threshold <= 0) return 'warning'
  const ratio = observed / threshold
  if (ratio >= 2) return 'critical'
  if (ratio >= 1.25) return 'warning'
  return 'info'
}

const scanSchema = z.object({
  workspaceId: z.string().min(1),
})

const updateSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']),
})

// ---------------------------------------------------------------------------
// GET / — alert feed for ?workspaceId&status?
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  const status = c.req.query('status')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const conds = [eq(alerts.workspace_id, workspaceId)]
  if (status) conds.push(eq(alerts.status, status))
  const rows = await db
    .select()
    .from(alerts)
    .where(and(...conds))
    .orderBy(desc(alerts.triggered_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /scan — run detection vs enabled rules
// ---------------------------------------------------------------------------

router.post('/scan', authMiddleware, zValidator('json', scanSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rules = await db
    .select()
    .from(alert_rules)
    .where(and(eq(alert_rules.workspace_id, body.workspaceId), eq(alert_rules.enabled, true)))

  if (rules.length === 0) return c.json([])

  // Load events within the scan window once, then bucket per (sender, segment).
  const since = new Date(Date.now() - SCAN_WINDOW_DAYS * 86_400_000)
  const events = await db
    .select({
      event_type: send_events.event_type,
      bounce_type: send_events.bounce_type,
      sender_id: send_events.sender_id,
      segment_id: send_events.segment_id,
      event_at: send_events.event_at,
    })
    .from(send_events)
    .where(eq(send_events.workspace_id, body.workspaceId))

  // Aggregate counts keyed by sender and by segment, plus a global bucket.
  const bySender = new Map<string, MetricCounts>()
  const bySegment = new Map<string, MetricCounts>()
  const global = emptyCounts()

  for (const e of events) {
    const at = e.event_at instanceof Date ? e.event_at : new Date(e.event_at as unknown as string)
    if (at < since) continue
    const tally = (cnt: MetricCounts) => {
      if (e.event_type === 'delivered' || e.event_type === 'sent') cnt.sends++
      else if (e.event_type === 'complaint') cnt.complaints++
      else if (e.event_type === 'unsubscribe' || e.event_type === 'unsub') cnt.unsubs++
      else if (e.event_type === 'bounce') {
        cnt.bounces++
        if (e.bounce_type === 'hard') cnt.hardBounces++
      }
    }
    tally(global)
    if (e.sender_id) {
      let s = bySender.get(e.sender_id)
      if (!s) {
        s = emptyCounts()
        bySender.set(e.sender_id, s)
      }
      tally(s)
    }
    if (e.segment_id) {
      let sg = bySegment.get(e.segment_id)
      if (!sg) {
        sg = emptyCounts()
        bySegment.set(e.segment_id, sg)
      }
      tally(sg)
    }
  }

  const now = new Date()
  const created: Array<typeof alerts.$inferSelect> = []

  for (const rule of rules) {
    // Pick the counts scope: segment-scoped > sender-scoped > global.
    let counts: MetricCounts
    if (rule.segment_id) counts = bySegment.get(rule.segment_id) ?? emptyCounts()
    else if (rule.sender_id) counts = bySender.get(rule.sender_id) ?? emptyCounts()
    else counts = global

    const observed = rateFor(rule.metric, counts)
    if (!breached(observed, rule.comparison, rule.threshold)) continue

    // De-dupe: skip if an open alert for this rule already exists.
    const [existingOpen] = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.workspace_id, body.workspaceId),
          eq(alerts.rule_id, rule.id),
          eq(alerts.status, 'open'),
        ),
      )
      .limit(1)
    if (existingOpen) continue

    const severity = severityFor(observed, rule.threshold)
    const pct = (observed * 100).toFixed(2)
    const thrPct = (rule.threshold * 100).toFixed(2)
    const message = `${rule.metric} at ${pct}% breached threshold ${rule.comparison} ${thrPct}% over the last ${SCAN_WINDOW_DAYS}d`

    const [alert] = await db
      .insert(alerts)
      .values({
        workspace_id: body.workspaceId,
        rule_id: rule.id,
        sender_id: rule.sender_id,
        segment_id: rule.segment_id,
        campaign_id: null,
        metric: rule.metric,
        observed_value: observed,
        threshold: rule.threshold,
        severity,
        message,
        status: 'open',
        triggered_at: now,
      })
      .returning()
    created.push(alert)

    await db.insert(notifications).values({
      workspace_id: body.workspaceId,
      user_id: userId,
      kind: 'alert',
      title: `${rule.metric} spike (${severity})`,
      body: message,
      link: '/dashboard/alerts',
    })
  }

  await db.insert(activity_log).values({
    workspace_id: body.workspaceId,
    user_id: userId,
    action: 'alerts.scan',
    entity_type: 'alert',
    entity_id: null,
    detail: { rules_evaluated: rules.length, alerts_created: created.length },
  })

  return c.json(created)
})

// ---------------------------------------------------------------------------
// PUT /:id — acknowledge / resolve
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(alerts)
    .set({ status: body.status })
    .where(eq(alerts.id, id))
    .returning()

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    user_id: userId,
    action: `alerts.${body.status}`,
    entity_type: 'alert',
    entity_id: id,
    detail: { from: existing.status, to: body.status },
  })

  return c.json(updated)
})

export default router
