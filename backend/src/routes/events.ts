import { Hono } from 'hono'
import { db } from '../db/index.js'
import { send_events, workspace_members } from '../db/schema.js'
import { eq, and, desc, gte, lte, sql, type SQL } from 'drizzle-orm'
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

// GET / — paginated normalized event explorer with type/sender/date filters
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const type = c.req.query('type')
  const senderId = c.req.query('senderId')
  const from = c.req.query('from')
  const to = c.req.query('to')

  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10)
  const offsetRaw = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0

  const conds: SQL[] = [eq(send_events.workspace_id, workspaceId)]
  if (type) conds.push(eq(send_events.event_type, type))
  if (senderId) conds.push(eq(send_events.sender_id, senderId))
  if (from) {
    const d = new Date(from)
    if (!Number.isNaN(d.getTime())) conds.push(gte(send_events.event_at, d))
  }
  if (to) {
    const d = new Date(to)
    if (!Number.isNaN(d.getTime())) conds.push(lte(send_events.event_at, d))
  }
  const where = and(...conds)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(send_events)
    .where(where)

  const events = await db
    .select()
    .from(send_events)
    .where(where)
    .orderBy(desc(send_events.event_at))
    .limit(limit)
    .offset(offset)

  return c.json({ events, total: count })
})

export default router
