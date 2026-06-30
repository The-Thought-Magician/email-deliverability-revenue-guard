import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { authentication_checks, workspace_members, senders } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// All authentication endpoints require auth + workspace membership.
router.use('*', authMiddleware)

// Verify the caller is a member of the workspace.
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
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

const postureStatus = z.enum(['pass', 'fail', 'partial', 'unknown'])

const checkSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1),
  spf_status: postureStatus.optional().default('unknown'),
  dkim_status: postureStatus.optional().default('unknown'),
  dmarc_status: postureStatus.optional().default('unknown'),
  dmarc_policy: z.enum(['none', 'quarantine', 'reject']).nullable().optional(),
  one_click_unsub: z.boolean().optional().default(false),
  notes: z.string().nullable().optional(),
})

// GET / — checks ?workspaceId&senderId? — latest-first list of posture checks.
router.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  const senderId = c.req.query('senderId')
  if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const filters = [eq(authentication_checks.workspace_id, workspaceId)]
  if (senderId) filters.push(eq(authentication_checks.sender_id, senderId))

  const rows = await db
    .select()
    .from(authentication_checks)
    .where(and(...filters))
    .orderBy(desc(authentication_checks.checked_at))
  return c.json(rows)
})

// POST / — record/update a posture check for a sender.
router.post('/', zValidator('json', checkSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Sender must belong to the same workspace.
  const [sender] = await db
    .select()
    .from(senders)
    .where(
      and(eq(senders.id, body.senderId), eq(senders.workspace_id, body.workspaceId)),
    )
  if (!sender) return c.json({ error: 'Sender not found in workspace' }, 404)

  const [check] = await db
    .insert(authentication_checks)
    .values({
      workspace_id: body.workspaceId,
      sender_id: body.senderId,
      spf_status: body.spf_status,
      dkim_status: body.dkim_status,
      dmarc_status: body.dmarc_status,
      dmarc_policy: body.dmarc_policy ?? null,
      one_click_unsub: body.one_click_unsub,
      notes: body.notes ?? null,
      checked_at: new Date(),
    })
    .returning()
  return c.json(check, 201)
})

export default router
