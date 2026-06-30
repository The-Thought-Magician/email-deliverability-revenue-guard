import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { segments, workspace_members, send_events } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Membership check: caller must be a member of the workspace.
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
    .limit(1)
  return !!m
}

const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
})

// GET / — list segments for a workspace (auth + membership)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(segments)
    .where(eq(segments.workspace_id, workspaceId))
    .orderBy(desc(segments.created_at))
  return c.json(rows)
})

// POST / — create a segment scoped to a workspace
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [created] = await db
    .insert(segments)
    .values({
      workspace_id: body.workspaceId,
      name: body.name,
      description: body.description ?? null,
      size: body.size ?? 0,
    })
    .returning()
  return c.json(created, 201)
})

// DELETE /:id — delete a segment (membership scoped to its workspace)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(segments).where(eq(segments.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Detach events referencing this segment so the FK does not block deletion.
  await db
    .update(send_events)
    .set({ segment_id: null })
    .where(and(eq(send_events.segment_id, id), eq(send_events.workspace_id, existing.workspace_id)))
  await db.delete(segments).where(eq(segments.id, id))
  return c.json({ success: true })
})

export default router
