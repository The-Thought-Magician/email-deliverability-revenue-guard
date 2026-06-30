import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaces, workspace_members, activity_log } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the membership row if the user belongs to the workspace, else null. */
async function getMembership(workspaceId: string, userId: string) {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return m ?? null
}

async function logActivity(
  workspaceId: string,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: Record<string, unknown> = {},
) {
  try {
    await db.insert(activity_log).values({
      workspace_id: workspaceId,
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      detail,
    })
  } catch {
    // activity logging is best-effort
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1),
  currency: z.string().min(1).optional(),
  fiscal_start_month: z.number().int().min(1).max(12).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  fiscal_start_month: z.number().int().min(1).max(12).optional(),
  default_sender_id: z.string().nullable().optional(),
})

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'analyst', 'viewer']).optional(),
  user_id: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

// GET / — list workspaces the user is a member of
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const memberships = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  if (memberships.length === 0) return c.json([])
  const ids = new Set(memberships.map((m) => m.workspace_id))
  const all = await db.select().from(workspaces).orderBy(desc(workspaces.created_at))
  return c.json(all.filter((w) => ids.has(w.id)))
})

// POST / — create workspace + owner membership
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db
    .insert(workspaces)
    .values({
      name: body.name,
      owner_id: userId,
      currency: body.currency ?? 'USD',
      fiscal_start_month: body.fiscal_start_month ?? 1,
    })
    .returning()
  await db.insert(workspace_members).values({
    workspace_id: ws.id,
    user_id: userId,
    role: 'owner',
  })
  await logActivity(ws.id, userId, 'create', 'workspace', ws.id, { name: ws.name })
  return c.json(ws, 201)
})

// GET /:id — get one (membership check)
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const membership = await getMembership(id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  return c.json(ws)
})

// PUT /:id — rename / settings
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const membership = await getMembership(id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(workspaces)
    .set({ ...body, updated_at: new Date() })
    .where(eq(workspaces.id, id))
    .returning()
  await logActivity(id, userId, 'update', 'workspace', id, body)
  return c.json(updated)
})

// DELETE /:id — owner only
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(workspace_members).where(eq(workspace_members.workspace_id, id))
  await db.delete(workspaces).where(eq(workspaces.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

// GET /:id/members — list members
router.get('/:id/members', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const membership = await getMembership(id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  const members = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, id))
    .orderBy(desc(workspace_members.created_at))
  return c.json(members)
})

// POST /:id/members — invite member
router.post('/:id/members', authMiddleware, zValidator('json', inviteSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const membership = await getMembership(id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')
  // The invited user's id defaults to their email until they sign in and claim it.
  const invitedUserId = body.user_id ?? body.email
  const existing = await getMembership(id, invitedUserId)
  if (existing) return c.json({ error: 'Member already exists' }, 409)
  const [member] = await db
    .insert(workspace_members)
    .values({
      workspace_id: id,
      user_id: invitedUserId,
      email: body.email,
      role: body.role ?? 'analyst',
    })
    .returning()
  await logActivity(id, userId, 'invite', 'member', member.id, { email: body.email })
  return c.json(member, 201)
})

// DELETE /:id/members/:memberId — remove member
router.delete('/:id/members/:memberId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const memberId = c.req.param('memberId')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const membership = await getMembership(id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  const [target] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.id, memberId), eq(workspace_members.workspace_id, id)))
  if (!target) return c.json({ error: 'Not found' }, 404)
  // Only owner/admin may remove others; a member may remove themselves.
  const isPrivileged = membership.role === 'owner' || membership.role === 'admin'
  if (!isPrivileged && target.user_id !== userId) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  // Never remove the workspace owner's membership.
  if (target.user_id === ws.owner_id) {
    return c.json({ error: 'Cannot remove the workspace owner' }, 400)
  }
  await db.delete(workspace_members).where(eq(workspace_members.id, memberId))
  await logActivity(id, userId, 'remove', 'member', memberId, {})
  return c.json({ success: true })
})

export default router
