import { Hono } from 'hono'
import { db } from '../db/index.js'
import { campaigns, workspace_members, send_events, senders, segments } from '../db/schema.js'
import { eq, and, desc, asc, lt } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
    .limit(1)
  return !!m
}

interface Tally {
  sends: number
  opens: number
  clicks: number
  bounces: number
  complaints: number
  unsubscribes: number
  deliveries: number
}

function emptyTally(): Tally {
  return { sends: 0, opens: 0, clicks: 0, bounces: 0, complaints: 0, unsubscribes: 0, deliveries: 0 }
}

// Fold a list of normalized event rows into a single tally.
function tallyEvents(rows: Array<{ event_type: string }>): Tally {
  const t = emptyTally()
  for (const r of rows) {
    switch (r.event_type) {
      case 'send':
      case 'sent':
        t.sends += 1
        break
      case 'delivered':
      case 'delivery':
        t.deliveries += 1
        break
      case 'open':
      case 'opened':
        t.opens += 1
        break
      case 'click':
      case 'clicked':
        t.clicks += 1
        break
      case 'bounce':
      case 'bounced':
        t.bounces += 1
        break
      case 'complaint':
      case 'complained':
      case 'spam':
        t.complaints += 1
        break
      case 'unsubscribe':
      case 'unsubscribed':
        t.unsubscribes += 1
        break
      default:
        break
    }
  }
  return t
}

// Derive rate metrics (0..1) from a tally. Denominator is sends, falling back to deliveries.
function rates(t: Tally) {
  const base = t.sends > 0 ? t.sends : t.deliveries
  const safe = (n: number) => (base > 0 ? n / base : 0)
  return {
    open_rate: safe(t.opens),
    click_rate: safe(t.clicks),
    bounce_rate: safe(t.bounces),
    complaint_rate: safe(t.complaints),
    unsubscribe_rate: safe(t.unsubscribes),
    delivery_rate: t.sends > 0 ? t.deliveries / t.sends : 0,
  }
}

function rollupFor(campaign: typeof campaigns.$inferSelect, t: Tally) {
  return {
    id: campaign.id,
    workspace_id: campaign.workspace_id,
    sender_id: campaign.sender_id,
    segment_id: campaign.segment_id,
    name: campaign.name,
    subject: campaign.subject,
    sent_at: campaign.sent_at,
    created_at: campaign.created_at,
    metrics: { ...t },
    rates: rates(t),
  }
}

// GET / — list campaign rollups for a workspace (optional senderId filter)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  const senderId = c.req.query('senderId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const conds = [eq(campaigns.workspace_id, workspaceId)]
  if (senderId) conds.push(eq(campaigns.sender_id, senderId))
  const camps = await db
    .select()
    .from(campaigns)
    .where(and(...conds))
    .orderBy(desc(campaigns.sent_at), desc(campaigns.created_at))

  // Pull all events for the matching campaigns in one query, then group in memory.
  const evConds = [eq(send_events.workspace_id, workspaceId)]
  if (senderId) evConds.push(eq(send_events.sender_id, senderId))
  const events = await db
    .select({ campaign_id: send_events.campaign_id, event_type: send_events.event_type })
    .from(send_events)
    .where(and(...evConds))

  const byCampaign = new Map<string, Array<{ event_type: string }>>()
  for (const e of events) {
    if (!e.campaign_id) continue
    let arr = byCampaign.get(e.campaign_id)
    if (!arr) {
      arr = []
      byCampaign.set(e.campaign_id, arr)
    }
    arr.push({ event_type: e.event_type })
  }

  const rollups = camps.map((camp) => rollupFor(camp, tallyEvents(byCampaign.get(camp.id) ?? [])))
  return c.json(rollups)
})

// GET /:id — single campaign drilldown: rollup + rates + deltas vs previous campaign by same sender
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
  if (!camp) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(camp.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const evRows = await db
    .select({ event_type: send_events.event_type })
    .from(send_events)
    .where(and(eq(send_events.workspace_id, camp.workspace_id), eq(send_events.campaign_id, id)))
  const tally = tallyEvents(evRows)
  const rollup = rollupFor(camp, tally)

  // Resolve sender + segment names for context.
  let senderName: string | null = null
  if (camp.sender_id) {
    const [s] = await db.select().from(senders).where(eq(senders.id, camp.sender_id)).limit(1)
    senderName = s?.friendly_name ?? null
  }
  let segmentName: string | null = null
  if (camp.segment_id) {
    const [sg] = await db.select().from(segments).where(eq(segments.id, camp.segment_id)).limit(1)
    segmentName = sg?.name ?? null
  }

  // Find the immediately-preceding campaign by the same sender to compute deltas.
  let deltas: Record<string, number> | null = null
  let previousId: string | null = null
  if (camp.sender_id && camp.sent_at) {
    const [prev] = await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.workspace_id, camp.workspace_id),
          eq(campaigns.sender_id, camp.sender_id),
          lt(campaigns.sent_at, camp.sent_at),
        ),
      )
      .orderBy(desc(campaigns.sent_at))
      .limit(1)
    if (prev) {
      previousId = prev.id
      const prevRows = await db
        .select({ event_type: send_events.event_type })
        .from(send_events)
        .where(and(eq(send_events.workspace_id, camp.workspace_id), eq(send_events.campaign_id, prev.id)))
      const prevRates = rates(tallyEvents(prevRows))
      const cur = rollup.rates
      deltas = {
        open_rate: cur.open_rate - prevRates.open_rate,
        click_rate: cur.click_rate - prevRates.click_rate,
        bounce_rate: cur.bounce_rate - prevRates.bounce_rate,
        complaint_rate: cur.complaint_rate - prevRates.complaint_rate,
        unsubscribe_rate: cur.unsubscribe_rate - prevRates.unsubscribe_rate,
        delivery_rate: cur.delivery_rate - prevRates.delivery_rate,
      }
    }
  }

  return c.json({
    ...rollup,
    sender_name: senderName,
    segment_name: segmentName,
    previous_campaign_id: previousId,
    deltas,
  })
})

// GET /:id/events — the normalized events behind a campaign
router.get('/:id/events', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
  if (!camp) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(camp.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(send_events)
    .where(and(eq(send_events.workspace_id, camp.workspace_id), eq(send_events.campaign_id, id)))
    .orderBy(asc(send_events.event_at))
  return c.json(rows)
})

export default router
