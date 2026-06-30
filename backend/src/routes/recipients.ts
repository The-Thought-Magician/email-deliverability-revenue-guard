import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  recipients,
  send_events,
  workspace_members,
  campaigns,
  senders,
  segments,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Every endpoint here is workspace-scoped and auth-gated.
router.use('*', authMiddleware)

/** Ensure the calling user is a member of the workspace. */
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

// GET / — paginated recipients ?workspaceId&status&limit&offset → { recipients, total }
router.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId') ?? ''
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const status = c.req.query('status')
  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10)
  const offsetRaw = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 50
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  const conds = [eq(recipients.workspace_id, workspaceId)]
  if (status) conds.push(eq(recipients.status, status))
  const where = conds.length === 1 ? conds[0] : and(...conds)

  const rows = await db
    .select()
    .from(recipients)
    .where(where)
    .orderBy(desc(recipients.last_engaged_at), desc(recipients.created_at))
    .limit(limit)
    .offset(offset)

  const all = await db.select({ id: recipients.id }).from(recipients).where(where)

  return c.json({ recipients: rows, total: all.length })
})

// GET /:id — recipient profile + event history → RecipientDetail
router.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [rec] = await db.select().from(recipients).where(eq(recipients.id, id))
  if (!rec) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(rec.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const events = await db
    .select({
      id: send_events.id,
      message_id: send_events.message_id,
      event_type: send_events.event_type,
      bounce_type: send_events.bounce_type,
      event_at: send_events.event_at,
      sender_id: send_events.sender_id,
      campaign_id: send_events.campaign_id,
      segment_id: send_events.segment_id,
      sender_name: senders.friendly_name,
      sender_domain: senders.domain,
      campaign_name: campaigns.name,
      segment_name: segments.name,
    })
    .from(send_events)
    .leftJoin(senders, eq(send_events.sender_id, senders.id))
    .leftJoin(campaigns, eq(send_events.campaign_id, campaigns.id))
    .leftJoin(segments, eq(send_events.segment_id, segments.id))
    .where(eq(send_events.recipient_id, id))
    .orderBy(desc(send_events.event_at))
    .limit(500)

  // Derive engagement rates from the recipient counters.
  const sends = rec.total_sends ?? 0
  const openRate = sends > 0 ? (rec.total_opens ?? 0) / sends : 0
  const clickRate = sends > 0 ? (rec.total_clicks ?? 0) / sends : 0
  const bounceRate = sends > 0 ? (rec.total_bounces ?? 0) / sends : 0
  const complaintRate = sends > 0 ? (rec.total_complaints ?? 0) / sends : 0

  return c.json({
    recipient: rec,
    metrics: {
      openRate,
      clickRate,
      bounceRate,
      complaintRate,
      totalEvents: events.length,
    },
    events,
  })
})

export default router
