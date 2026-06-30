import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, gte, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  reports,
  workspace_members,
  placement_scores,
  list_health_snapshots,
  revenue_at_risk,
  suppression_recommendations,
  alerts,
  send_events,
  senders,
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

const REPORT_KINDS = [
  'placement_summary',
  'list_health',
  'revenue_at_risk',
  'suppression',
  'alerts',
  'deliverability_overview',
] as const

const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(REPORT_KINDS),
  config: z.record(z.unknown()).optional().default({}),
  schedule: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Render engine — builds report output JSON from live data
// ---------------------------------------------------------------------------

async function renderReport(
  workspaceId: string,
  kind: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const senderId = typeof config.senderId === 'string' ? config.senderId : undefined
  const generatedAt = new Date().toISOString()

  if (kind === 'placement_summary') {
    const conds = [eq(placement_scores.workspace_id, workspaceId)]
    if (senderId) conds.push(eq(placement_scores.sender_id, senderId))
    const rows = await db
      .select()
      .from(placement_scores)
      .where(and(...conds))
      .orderBy(desc(placement_scores.created_at))
      .limit(100)
    const avg = rows.length ? rows.reduce((s, r) => s + (r.score ?? 0), 0) / rows.length : 0
    return {
      kind,
      generatedAt,
      summary: { count: rows.length, averageScore: Math.round(avg * 100) / 100 },
      scores: rows,
    }
  }

  if (kind === 'list_health') {
    const conds = [eq(list_health_snapshots.workspace_id, workspaceId)]
    if (senderId) conds.push(eq(list_health_snapshots.sender_id, senderId))
    const rows = await db
      .select()
      .from(list_health_snapshots)
      .where(and(...conds))
      .orderBy(desc(list_health_snapshots.snapshot_at))
      .limit(100)
    return {
      kind,
      generatedAt,
      summary: { snapshots: rows.length, latestGrade: rows[0]?.grade ?? null },
      snapshots: rows,
    }
  }

  if (kind === 'revenue_at_risk') {
    const conds = [eq(revenue_at_risk.workspace_id, workspaceId)]
    if (senderId) conds.push(eq(revenue_at_risk.sender_id, senderId))
    const rows = await db
      .select()
      .from(revenue_at_risk)
      .where(and(...conds))
      .orderBy(desc(revenue_at_risk.created_at))
      .limit(500)
    const byCause: Record<string, number> = {}
    let total = 0
    for (const r of rows) {
      byCause[r.cause] = (byCause[r.cause] ?? 0) + (r.at_risk_cents ?? 0)
      total += r.at_risk_cents ?? 0
    }
    return { kind, generatedAt, summary: { totalAtRiskCents: total, byCause }, records: rows }
  }

  if (kind === 'suppression') {
    const conds = [eq(suppression_recommendations.workspace_id, workspaceId)]
    if (senderId) conds.push(eq(suppression_recommendations.sender_id, senderId))
    const rows = await db
      .select()
      .from(suppression_recommendations)
      .where(and(...conds))
      .orderBy(desc(suppression_recommendations.created_at))
      .limit(1000)
    const byStatus: Record<string, number> = {}
    let impact = 0
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
      impact += r.revenue_impact_cents ?? 0
    }
    return {
      kind,
      generatedAt,
      summary: { count: rows.length, byStatus, totalRevenueImpactCents: impact },
      recommendations: rows,
    }
  }

  if (kind === 'alerts') {
    const conds = [eq(alerts.workspace_id, workspaceId)]
    if (senderId) conds.push(eq(alerts.sender_id, senderId))
    const rows = await db
      .select()
      .from(alerts)
      .where(and(...conds))
      .orderBy(desc(alerts.triggered_at))
      .limit(500)
    const bySeverity: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    for (const r of rows) {
      bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    }
    return { kind, generatedAt, summary: { count: rows.length, bySeverity, byStatus }, alerts: rows }
  }

  // deliverability_overview — combined snapshot across signals
  const placementConds = [eq(placement_scores.workspace_id, workspaceId)]
  if (senderId) placementConds.push(eq(placement_scores.sender_id, senderId))
  const [latestPlacement] = await db
    .select()
    .from(placement_scores)
    .where(and(...placementConds))
    .orderBy(desc(placement_scores.created_at))
    .limit(1)

  const healthConds = [eq(list_health_snapshots.workspace_id, workspaceId)]
  if (senderId) healthConds.push(eq(list_health_snapshots.sender_id, senderId))
  const [latestHealth] = await db
    .select()
    .from(list_health_snapshots)
    .where(and(...healthConds))
    .orderBy(desc(list_health_snapshots.snapshot_at))
    .limit(1)

  const riskConds = [eq(revenue_at_risk.workspace_id, workspaceId)]
  if (senderId) riskConds.push(eq(revenue_at_risk.sender_id, senderId))
  const [riskAgg] = await db
    .select({ total: sql<number>`coalesce(sum(${revenue_at_risk.at_risk_cents}), 0)` })
    .from(revenue_at_risk)
    .where(and(...riskConds))

  const since = new Date(Date.now() - 30 * 86_400_000)
  const eventConds = [eq(send_events.workspace_id, workspaceId), gte(send_events.event_at, since)]
  if (senderId) eventConds.push(eq(send_events.sender_id, senderId))
  const eventRows = await db
    .select({ event_type: send_events.event_type, n: sql<number>`count(*)` })
    .from(send_events)
    .where(and(...eventConds))
    .groupBy(send_events.event_type)
  const eventCounts: Record<string, number> = {}
  for (const r of eventRows) eventCounts[r.event_type] = Number(r.n)

  const senderRows = await db
    .select()
    .from(senders)
    .where(eq(senders.workspace_id, workspaceId))

  return {
    kind,
    generatedAt,
    placementScore: latestPlacement?.score ?? null,
    listHealthGrade: latestHealth?.grade ?? null,
    revenueAtRiskCents: Number(riskAgg?.total ?? 0),
    eventCounts30d: eventCounts,
    senderCount: senderRows.length,
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — list saved reports for a workspace
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.workspace_id, workspaceId))
    .orderBy(desc(reports.created_at))
  return c.json(rows)
})

// POST / — create a report definition
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [created] = await db
    .insert(reports)
    .values({
      workspace_id: body.workspaceId,
      name: body.name,
      kind: body.kind,
      config: body.config,
      schedule: body.schedule ?? null,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// POST /:id/render — render report output and persist it
router.post('/:id/render', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reports).where(eq(reports.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const output = await renderReport(existing.workspace_id, existing.kind, existing.config ?? {})
  const [updated] = await db
    .update(reports)
    .set({ output, last_rendered_at: new Date() })
    .where(eq(reports.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — delete a report
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reports).where(eq(reports.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(reports).where(eq(reports.id, id))
  return c.json({ success: true })
})

export default router
