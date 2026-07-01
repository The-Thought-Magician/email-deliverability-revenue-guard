import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  revenue_at_risk,
  revenue_models,
  senders,
  send_events,
  campaigns,
  segments,
  workspace_members,
  activity_log,
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

/** Resolve the per-send value (cents) used to monetize at-risk volume. */
async function resolvePerSendCents(workspaceId: string, senderId: string | null): Promise<number> {
  // Prefer the active revenue model for the sender, then a workspace-level model,
  // then the sender's own revenue_per_send_cents, finally a default.
  const conds = [eq(revenue_models.workspace_id, workspaceId), eq(revenue_models.is_active, true)]
  if (senderId) conds.push(eq(revenue_models.sender_id, senderId))
  const [scoped] = await db
    .select()
    .from(revenue_models)
    .where(and(...conds))
    .orderBy(desc(revenue_models.version))
    .limit(1)
  if (scoped && scoped.revenue_per_send_cents > 0) return scoped.revenue_per_send_cents

  const [wsModel] = await db
    .select()
    .from(revenue_models)
    .where(and(eq(revenue_models.workspace_id, workspaceId), eq(revenue_models.is_active, true)))
    .orderBy(desc(revenue_models.version))
    .limit(1)
  if (wsModel && wsModel.revenue_per_send_cents > 0) return wsModel.revenue_per_send_cents

  if (senderId) {
    const [s] = await db.select().from(senders).where(eq(senders.id, senderId)).limit(1)
    if (s?.revenue_per_send_cents && s.revenue_per_send_cents > 0) return s.revenue_per_send_cents
  }
  return 50 // default $0.50 per send
}

interface CauseAccum {
  cause: string
  count: number
  campaign_id: string | null
  segment_id: string | null
}

/**
 * Compute at-risk records from send events. Events that represent lost/at-risk
 * deliverability (complaints, hard bounces, unsubscribes) are monetized against
 * per-send value: each such event removes a recipient from future revenue, so
 * the at-risk value is the per-send value extrapolated over a projection horizon
 * (we use a 12-send forward horizon as the lost lifetime-value proxy).
 */
async function computeAtRisk(
  workspaceId: string,
  senderId: string | null,
): Promise<Array<typeof revenue_at_risk.$inferSelect>> {
  const conds = [eq(send_events.workspace_id, workspaceId)]
  if (senderId) conds.push(eq(send_events.sender_id, senderId))
  const events = await db
    .select({
      event_type: send_events.event_type,
      bounce_type: send_events.bounce_type,
      sender_id: send_events.sender_id,
      campaign_id: send_events.campaign_id,
      segment_id: send_events.segment_id,
      event_at: send_events.event_at,
    })
    .from(send_events)
    .where(and(...conds))

  const PROJECTION_HORIZON = 12 // lost future sends per dropped recipient

  // Group by (cause, sender, campaign, segment).
  const groups = new Map<string, CauseAccum & { sender_id: string | null; minAt: Date; maxAt: Date }>()
  for (const e of events) {
    let cause: string | null = null
    if (e.event_type === 'complaint') cause = 'complaint'
    else if (e.event_type === 'unsubscribe' || e.event_type === 'unsub') cause = 'unsubscribe'
    else if (e.event_type === 'bounce' && e.bounce_type === 'hard') cause = 'hard_bounce'
    else if (e.event_type === 'bounce') cause = 'soft_bounce'
    if (!cause) continue

    const key = `${cause}|${e.sender_id ?? ''}|${e.campaign_id ?? ''}|${e.segment_id ?? ''}`
    const at = e.event_at instanceof Date ? e.event_at : new Date(e.event_at as unknown as string)
    const existing = groups.get(key)
    if (existing) {
      existing.count++
      if (at < existing.minAt) existing.minAt = at
      if (at > existing.maxAt) existing.maxAt = at
    } else {
      groups.set(key, {
        cause,
        count: 1,
        campaign_id: e.campaign_id,
        segment_id: e.segment_id,
        sender_id: e.sender_id,
        minAt: at,
        maxAt: at,
      })
    }
  }

  // Wipe prior at-risk rows for this scope, then insert fresh.
  const delConds = [eq(revenue_at_risk.workspace_id, workspaceId)]
  if (senderId) delConds.push(eq(revenue_at_risk.sender_id, senderId))
  await db.delete(revenue_at_risk).where(and(...delConds))

  const out: Array<typeof revenue_at_risk.$inferSelect> = []
  for (const g of groups.values()) {
    const perSend = await resolvePerSendCents(workspaceId, g.sender_id)
    // soft bounces are recoverable → discount their projected loss.
    const horizon = g.cause === 'soft_bounce' ? Math.round(PROJECTION_HORIZON / 4) : PROJECTION_HORIZON
    const atRiskCents = g.count * perSend * horizon
    const [row] = await db
      .insert(revenue_at_risk)
      .values({
        workspace_id: workspaceId,
        sender_id: g.sender_id,
        campaign_id: g.campaign_id,
        segment_id: g.segment_id,
        period_start: g.minAt,
        period_end: g.maxAt,
        cause: g.cause,
        at_risk_cents: atRiskCents,
        detail: {
          event_count: g.count,
          per_send_cents: perSend,
          projection_horizon: horizon,
        },
      })
      .returning()
    out.push(row)
  }
  return out
}

const computeSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1).optional(),
})

// ---------------------------------------------------------------------------
// GET / — at-risk records for ?workspaceId&senderId?
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  const senderId = c.req.query('senderId') ?? null
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const conds = [eq(revenue_at_risk.workspace_id, workspaceId)]
  if (senderId) conds.push(eq(revenue_at_risk.sender_id, senderId))
  const rows = await db
    .select()
    .from(revenue_at_risk)
    .where(and(...conds))
    .orderBy(desc(revenue_at_risk.at_risk_cents))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /compute — recompute at-risk
// ---------------------------------------------------------------------------

router.post('/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await computeAtRisk(body.workspaceId, body.senderId ?? null)

  await db.insert(activity_log).values({
    workspace_id: body.workspaceId,
    user_id: userId,
    action: 'revenue_at_risk.compute',
    entity_type: 'revenue_at_risk',
    entity_id: null,
    detail: { records: rows.length, sender_id: body.senderId ?? null },
  })

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /summary — totals by cause + trend for ?workspaceId
// ---------------------------------------------------------------------------

router.get('/summary', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(revenue_at_risk)
    .where(eq(revenue_at_risk.workspace_id, workspaceId))

  const byCause: Record<string, number> = {}
  let total = 0
  // Trend: bucket by period_end day.
  const trendMap = new Map<string, number>()
  for (const r of rows) {
    byCause[r.cause] = (byCause[r.cause] ?? 0) + r.at_risk_cents
    total += r.at_risk_cents
    const end = r.period_end instanceof Date ? r.period_end : new Date(r.period_end as unknown as string)
    const day = end.toISOString().slice(0, 10)
    trendMap.set(day, (trendMap.get(day) ?? 0) + r.at_risk_cents)
  }
  const trend = Array.from(trendMap.entries())
    .map(([date, cents]) => ({ date, cents }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const byCauseArr = Object.entries(byCause)
    .map(([cause, cents]) => ({ cause, cents }))
    .sort((a, b) => b.cents - a.cents)

  return c.json({ byCause: byCauseArr, trend, total })
})

// ---------------------------------------------------------------------------
// GET /top-contributors — top segments/campaigns by risk for ?workspaceId
// ---------------------------------------------------------------------------

router.get('/top-contributors', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10) || 10, 100)

  const rows = await db
    .select()
    .from(revenue_at_risk)
    .where(eq(revenue_at_risk.workspace_id, workspaceId))

  // Resolve names for campaigns/segments referenced.
  const campRows = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.workspace_id, workspaceId))
  const segRows = await db
    .select({ id: segments.id, name: segments.name })
    .from(segments)
    .where(eq(segments.workspace_id, workspaceId))
  const campName = new Map(campRows.map((r) => [r.id, r.name]))
  const segName = new Map(segRows.map((r) => [r.id, r.name]))

  interface Contrib {
    type: 'campaign' | 'segment'
    id: string
    name: string
    cents: number
    causes: Record<string, number>
  }
  const acc = new Map<string, Contrib>()
  for (const r of rows) {
    const targets: Array<{ type: 'campaign' | 'segment'; id: string | null; name: string | undefined }> = [
      { type: 'campaign', id: r.campaign_id, name: r.campaign_id ? campName.get(r.campaign_id) : undefined },
      { type: 'segment', id: r.segment_id, name: r.segment_id ? segName.get(r.segment_id) : undefined },
    ]
    for (const t of targets) {
      if (!t.id) continue
      const key = `${t.type}:${t.id}`
      let e = acc.get(key)
      if (!e) {
        e = { type: t.type, id: t.id, name: t.name ?? t.id, cents: 0, causes: {} }
        acc.set(key, e)
      }
      e.cents += r.at_risk_cents
      e.causes[r.cause] = (e.causes[r.cause] ?? 0) + r.at_risk_cents
    }
  }

  const contributors = Array.from(acc.values())
    .sort((a, b) => b.cents - a.cents)
    .slice(0, limit)

  return c.json(contributors)
})

export default router
