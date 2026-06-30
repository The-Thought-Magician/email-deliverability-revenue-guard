import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  scorecards,
  workspace_members,
  senders,
  placement_scores,
  list_health_snapshots,
  revenue_at_risk,
  send_events,
  authentication_checks,
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

/** Map a 0..100 placement score to a letter grade. */
function gradeForScore(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

const generateSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1),
})

// ---------------------------------------------------------------------------
// GET / — list scorecards for a workspace
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(scorecards)
    .where(eq(scorecards.workspace_id, workspaceId))
    .orderBy(desc(scorecards.generated_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — full scorecard payload
// ---------------------------------------------------------------------------

router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [card] = await db.select().from(scorecards).where(eq(scorecards.id, id))
  if (!card) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(card.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  return c.json(card)
})

// ---------------------------------------------------------------------------
// POST /generate — assemble a point-in-time scorecard bundle for a sender
//
// Bundles the latest placement score, latest list-health snapshot, the
// complaint rate over the trailing window, total open revenue-at-risk, and
// authentication posture into a single graded card with prioritised actions.
// ---------------------------------------------------------------------------

router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const { workspaceId, senderId } = c.req.valid('json')
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [sender] = await db.select().from(senders).where(eq(senders.id, senderId))
  if (!sender || sender.workspace_id !== workspaceId)
    return c.json({ error: 'Sender not in workspace' }, 400)

  // Latest placement score.
  const [placement] = await db
    .select()
    .from(placement_scores)
    .where(and(eq(placement_scores.workspace_id, workspaceId), eq(placement_scores.sender_id, senderId)))
    .orderBy(desc(placement_scores.period_end))
    .limit(1)

  // Latest list-health snapshot.
  const [health] = await db
    .select()
    .from(list_health_snapshots)
    .where(
      and(
        eq(list_health_snapshots.workspace_id, workspaceId),
        eq(list_health_snapshots.sender_id, senderId),
      ),
    )
    .orderBy(desc(list_health_snapshots.snapshot_at))
    .limit(1)

  // Latest authentication posture.
  const [authCheck] = await db
    .select()
    .from(authentication_checks)
    .where(
      and(
        eq(authentication_checks.workspace_id, workspaceId),
        eq(authentication_checks.sender_id, senderId),
      ),
    )
    .orderBy(desc(authentication_checks.checked_at))
    .limit(1)

  // Complaint rate from events for this sender.
  const events = await db
    .select()
    .from(send_events)
    .where(and(eq(send_events.workspace_id, workspaceId), eq(send_events.sender_id, senderId)))

  let sends = 0
  let complaints = 0
  for (const e of events) {
    const t = e.event_type
    if (t === 'send' || t === 'delivery' || t === 'delivered') sends += 1
    else if (t === 'complaint' || t === 'spam') complaints += 1
  }
  const complaintRate = sends > 0 ? complaints / sends : 0

  // Open revenue-at-risk for this sender.
  const riskRows = await db
    .select()
    .from(revenue_at_risk)
    .where(and(eq(revenue_at_risk.workspace_id, workspaceId), eq(revenue_at_risk.sender_id, senderId)))
  const revenueAtRiskCents = riskRows.reduce((sum, r) => sum + (r.at_risk_cents ?? 0), 0)

  const placementScore = placement?.score ?? 0
  const grade = gradeForScore(placementScore)
  const listHealthGrade = health?.grade ?? 'N/A'

  // Prioritised actions, severity-ordered.
  const topActions: string[] = []
  if (complaintRate >= 0.003)
    topActions.push(
      `Complaint rate ${(complaintRate * 100).toFixed(3)}% exceeds the 0.3% Gmail/Yahoo enforcement line; suppress complainers and slow cadence.`,
    )
  if (placementScore < 70)
    topActions.push(
      `Placement score ${placementScore.toFixed(1)} is below target; rebuild reputation by mailing engaged cohorts only.`,
    )
  if (health && (health.grade === 'D' || health.grade === 'F'))
    topActions.push(
      `List-health grade ${health.grade}; run suppression and a sunset plan on dormant recipients.`,
    )
  if (authCheck) {
    if (authCheck.dmarc_status !== 'pass' || authCheck.dmarc_policy === 'none')
      topActions.push('Strengthen DMARC to an enforcing policy (quarantine/reject).')
    if (authCheck.spf_status !== 'pass') topActions.push('Fix SPF alignment for the sending domain.')
    if (authCheck.dkim_status !== 'pass') topActions.push('Fix DKIM signing for the sending domain.')
    if (!authCheck.one_click_unsub)
      topActions.push('Enable one-click list-unsubscribe (RFC 8058) to meet bulk-sender rules.')
  } else {
    topActions.push('Record an authentication posture check (SPF/DKIM/DMARC).')
  }
  if (revenueAtRiskCents > 0)
    topActions.push(
      `$${(revenueAtRiskCents / 100).toFixed(2)} of send revenue is at risk; address the top causes in Revenue at Risk.`,
    )
  if (topActions.length === 0)
    topActions.push('Deliverability is healthy; maintain engagement-based segmentation and cadence.')

  const generatedAt = new Date()
  const payload = {
    sender: {
      id: sender.id,
      domain: sender.domain,
      subdomain: sender.subdomain,
      friendly_name: sender.friendly_name,
    },
    placement: placement
      ? {
          score: placement.score,
          period_start: placement.period_start,
          period_end: placement.period_end,
          engagement_component: placement.engagement_component,
          complaint_component: placement.complaint_component,
          bounce_component: placement.bounce_component,
          components: placement.components,
        }
      : null,
    list_health: health
      ? {
          grade: health.grade,
          active_count: health.active_count,
          dormant_count: health.dormant_count,
          role_account_count: health.role_account_count,
          hard_bounce_rate: health.hard_bounce_rate,
          soft_bounce_rate: health.soft_bounce_rate,
          drivers: health.drivers,
          snapshot_at: health.snapshot_at,
        }
      : null,
    authentication: authCheck
      ? {
          spf_status: authCheck.spf_status,
          dkim_status: authCheck.dkim_status,
          dmarc_status: authCheck.dmarc_status,
          dmarc_policy: authCheck.dmarc_policy,
          one_click_unsub: authCheck.one_click_unsub,
          checked_at: authCheck.checked_at,
        }
      : null,
    metrics: {
      placement_score: placementScore,
      grade,
      list_health_grade: listHealthGrade,
      complaint_rate: Number(complaintRate.toFixed(5)),
      total_sends: sends,
      total_complaints: complaints,
      revenue_at_risk_cents: revenueAtRiskCents,
    },
    top_actions: topActions,
    generated_at: generatedAt.toISOString(),
  }

  const [created] = await db
    .insert(scorecards)
    .values({
      workspace_id: workspaceId,
      sender_id: senderId,
      generated_at: generatedAt,
      grade,
      placement_score: placementScore,
      list_health_grade: listHealthGrade,
      complaint_rate: Number(complaintRate.toFixed(5)),
      revenue_at_risk_cents: revenueAtRiskCents,
      top_actions: topActions,
      payload,
      created_by: userId,
    })
    .returning()

  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// GET /:id/export — export the scorecard payload as a JSON bundle
// ---------------------------------------------------------------------------

router.get('/:id/export', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [card] = await db.select().from(scorecards).where(eq(scorecards.id, id))
  if (!card) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(card.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const payload = {
    id: card.id,
    workspace_id: card.workspace_id,
    sender_id: card.sender_id,
    generated_at: card.generated_at,
    grade: card.grade,
    placement_score: card.placement_score,
    list_health_grade: card.list_health_grade,
    complaint_rate: card.complaint_rate,
    revenue_at_risk_cents: card.revenue_at_risk_cents,
    top_actions: card.top_actions,
    ...(card.payload as Record<string, unknown>),
  }
  return c.json({ payload })
})

export default router
