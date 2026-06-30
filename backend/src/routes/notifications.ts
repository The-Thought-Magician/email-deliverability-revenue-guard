import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { notifications, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

const readAllSchema = z.object({
  workspaceId: z.string().min(1),
})

// ---------------------------------------------------------------------------
// GET / — current user's notifications for a workspace
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.workspace_id, workspaceId), eq(notifications.user_id, userId)))
    .orderBy(desc(notifications.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// PUT /read-all — mark all of the user's notifications read (must precede /:id)
// ---------------------------------------------------------------------------
router.put('/read-all', authMiddleware, zValidator('json', readAllSchema), async (c) => {
  const userId = getUserId(c)
  const { workspaceId } = c.req.valid('json')
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.workspace_id, workspaceId), eq(notifications.user_id, userId)))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// PUT /:id/read — mark one notification read (owner only)
// ---------------------------------------------------------------------------
router.put('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id))
    .returning()
  return c.json(updated)
})

export default router
