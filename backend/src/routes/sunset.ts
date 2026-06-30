import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspace_members,
  senders,
  engagement_cohorts,
  sunset_plans,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

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

// Project the revenue impact of sunsetting the given cohorts. We retain the
// revenue contribution of cohorts NOT being sunset and forfeit the contribution
// of the targeted cohorts; complaint-risk reduction scales with the share of
// disengaged members removed.
async function projectImpact(
  workspaceId: string,
  cohortIds: string[],
): Promise<{
  retained: number
  forfeited: number
  riskReduction: number
  targetedMembers: number
}> {
  const all = await db
    .select()
    .from(engagement_cohorts)
    .where(eq(engagement_cohorts.workspace_id, workspaceId))

  const targetSet = new Set(cohortIds)
  let retained = 0
  let forfeited = 0
  let targetedMembers = 0
  let totalMembers = 0

  for (const ch of all) {
    const contribution = ch.revenue_contribution_cents ?? 0
    const members = ch.member_count ?? 0
    totalMembers += members
    if (targetSet.has(ch.id)) {
      forfeited += contribution
      targetedMembers += members
    } else {
      retained += contribution
    }
  }

  // Risk reduction: removing the least-engaged share of the list cuts complaint
  // exposure roughly in proportion to the fraction of members removed, with a
  // bonus weight because sunsetting targets the lowest-engagement cohorts.
  const removedFraction = totalMembers > 0 ? targetedMembers / totalMembers : 0
  const riskReduction = Math.min(1, removedFraction * 1.25)

  return { retained, forfeited, riskReduction, targetedMembers }
}

// ---------------------------------------------------------------------------
// GET / — list sunset plans ?workspaceId
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(sunset_plans)
    .where(eq(sunset_plans.workspace_id, workspaceId))
    .orderBy(desc(sunset_plans.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /preview — preview revenue impact (no persist)
// ---------------------------------------------------------------------------

const previewSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().optional(),
  cohortIds: z.array(z.string()).default([]),
  schedule: z.string().optional(),
})

router.post('/preview', authMiddleware, zValidator('json', previewSchema), async (c) => {
  const userId = getUserId(c)
  const { workspaceId, senderId, cohortIds } = c.req.valid('json')
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  if (senderId) {
    const [s] = await db
      .select()
      .from(senders)
      .where(and(eq(senders.id, senderId), eq(senders.workspace_id, workspaceId)))
    if (!s) return c.json({ error: 'Sender not found' }, 404)
  }

  const { retained, forfeited, riskReduction } = await projectImpact(workspaceId, cohortIds)
  return c.json({ retained, forfeited, riskReduction })
})

// ---------------------------------------------------------------------------
// POST / — save plan
// ---------------------------------------------------------------------------

const createSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().optional(),
  name: z.string().min(1),
  cohortIds: z.array(z.string()).default([]),
  schedule: z.string().optional(),
  status: z.enum(['draft', 'scheduled', 'active', 'completed']).optional().default('draft'),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const { workspaceId, senderId, name, cohortIds, schedule, status } = c.req.valid('json')
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  if (senderId) {
    const [s] = await db
      .select()
      .from(senders)
      .where(and(eq(senders.id, senderId), eq(senders.workspace_id, workspaceId)))
    if (!s) return c.json({ error: 'Sender not found' }, 404)
  }

  // Validate referenced cohorts belong to the workspace.
  if (cohortIds.length) {
    const found = await db
      .select({ id: engagement_cohorts.id })
      .from(engagement_cohorts)
      .where(
        and(
          eq(engagement_cohorts.workspace_id, workspaceId),
          inArray(engagement_cohorts.id, cohortIds),
        ),
      )
    if (found.length !== cohortIds.length) {
      return c.json({ error: 'One or more cohorts not found in workspace' }, 400)
    }
  }

  const { retained, forfeited, riskReduction } = await projectImpact(workspaceId, cohortIds)

  const [plan] = await db
    .insert(sunset_plans)
    .values({
      workspace_id: workspaceId,
      sender_id: senderId ?? null,
      name,
      cohort_ids: cohortIds,
      schedule: schedule ?? null,
      revenue_retained_cents: retained,
      revenue_forfeited_cents: forfeited,
      complaint_risk_reduction: riskReduction,
      status,
      created_by: userId,
    })
    .returning()

  return c.json(plan, 201)
})

// ---------------------------------------------------------------------------
// GET /:id — plan detail
// ---------------------------------------------------------------------------

router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [plan] = await db.select().from(sunset_plans).where(eq(sunset_plans.id, id))
  if (!plan) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(plan.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  return c.json(plan)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete plan
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [plan] = await db.select().from(sunset_plans).where(eq(sunset_plans.id, id))
  if (!plan) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(plan.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(sunset_plans).where(eq(sunset_plans.id, id))
  return c.json({ success: true })
})

export default router
