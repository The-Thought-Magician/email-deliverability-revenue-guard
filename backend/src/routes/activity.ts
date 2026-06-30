import { Hono } from 'hono'
import { db } from '../db/index.js'
import { activity_log, workspace_members } from '../db/schema.js'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

/** Throws-style guard: returns the membership row or null if the user is not a member. */
async function requireMembership(workspaceId: string, userId: string) {
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return member ?? null
}

// GET / — paginated audit trail for a workspace.
// Query: ?workspaceId (required) &limit (default 50, max 200) &offset (default 0)
// Returns: { entries: Activity[], total }
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)

  const member = await requireMembership(workspaceId, userId)
  if (!member) return c.json({ error: 'Forbidden' }, 403)

  const rawLimit = parseInt(c.req.query('limit') ?? '50', 10)
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0

  const entries = await db
    .select()
    .from(activity_log)
    .where(eq(activity_log.workspace_id, workspaceId))
    .orderBy(desc(activity_log.created_at))
    .limit(limit)
    .offset(offset)

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activity_log)
    .where(eq(activity_log.workspace_id, workspaceId))

  return c.json({ entries, total: count ?? 0 })
})

export default router
