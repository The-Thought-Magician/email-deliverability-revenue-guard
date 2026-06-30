import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  list_health_snapshots,
  recipients,
  send_events,
  senders,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

router.use('*', authMiddleware)

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

const computeSchema = z.object({
  workspaceId: z.string().min(1),
  senderId: z.string().min(1),
})

const DORMANT_DAYS = 90

/** Map a 0-100 health score to a letter grade. */
function gradeFromScore(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

// GET / — latest snapshot + history ?workspaceId&senderId → { latest, history }
router.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId') ?? ''
  const senderId = c.req.query('senderId') ?? ''
  if (!workspaceId || !senderId)
    return c.json({ error: 'workspaceId and senderId are required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const history = await db
    .select()
    .from(list_health_snapshots)
    .where(
      and(
        eq(list_health_snapshots.workspace_id, workspaceId),
        eq(list_health_snapshots.sender_id, senderId),
      ),
    )
    .orderBy(desc(list_health_snapshots.snapshot_at))

  return c.json({ latest: history[0] ?? null, history })
})

// POST /compute — compute a snapshot {workspaceId,senderId} → Snapshot
router.post('/compute', zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const { workspaceId, senderId } = c.req.valid('json')
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [sender] = await db
    .select()
    .from(senders)
    .where(and(eq(senders.id, senderId), eq(senders.workspace_id, workspaceId)))
  if (!sender) return c.json({ error: 'Sender not found' }, 404)

  const now = new Date()
  const dormantCutoff = new Date(now.getTime() - DORMANT_DAYS * 86_400_000)

  // Recipients are workspace-scoped (not sender-scoped) in the schema, so list
  // health is computed across the workspace recipient base.
  const recs = await db
    .select()
    .from(recipients)
    .where(eq(recipients.workspace_id, workspaceId))

  let active = 0
  let dormant = 0
  let roleAccounts = 0
  for (const r of recs) {
    if (r.is_role_account) roleAccounts++
    const lastEngaged = r.last_engaged_at
      ? r.last_engaged_at instanceof Date
        ? r.last_engaged_at
        : new Date(r.last_engaged_at as unknown as string)
      : null
    if (lastEngaged && lastEngaged >= dormantCutoff) active++
    else dormant++
  }
  const total = recs.length

  // Bounce rates from this sender's send_events.
  const events = await db
    .select({ event_type: send_events.event_type, bounce_type: send_events.bounce_type })
    .from(send_events)
    .where(
      and(
        eq(send_events.workspace_id, workspaceId),
        eq(send_events.sender_id, senderId),
      ),
    )

  let sends = 0
  let hardBounces = 0
  let softBounces = 0
  for (const e of events) {
    if (e.event_type === 'send' || e.event_type === 'delivered') sends++
    if (e.event_type === 'bounce') {
      if (e.bounce_type === 'hard') hardBounces++
      else softBounces++
    }
  }
  const sendDenom = sends > 0 ? sends : 1
  const hardBounceRate = hardBounces / sendDenom
  const softBounceRate = softBounces / sendDenom

  // Health score: start at 100, deduct for dormancy, role accounts, bounces.
  const dormantRatio = total > 0 ? dormant / total : 0
  const roleRatio = total > 0 ? roleAccounts / total : 0
  const drivers: string[] = []

  let score = 100
  const dormantPenalty = dormantRatio * 40
  score -= dormantPenalty
  if (dormantRatio > 0.3) drivers.push(`${Math.round(dormantRatio * 100)}% of list is dormant`)

  const rolePenalty = roleRatio * 15
  score -= rolePenalty
  if (roleRatio > 0.05) drivers.push(`${Math.round(roleRatio * 100)}% role accounts`)

  const hardBouncePenalty = Math.min(hardBounceRate / 0.02, 1) * 30
  score -= hardBouncePenalty
  if (hardBounceRate > 0.005)
    drivers.push(`Hard bounce rate ${(hardBounceRate * 100).toFixed(2)}%`)

  const softBouncePenalty = Math.min(softBounceRate / 0.05, 1) * 15
  score -= softBouncePenalty
  if (softBounceRate > 0.02)
    drivers.push(`Soft bounce rate ${(softBounceRate * 100).toFixed(2)}%`)

  score = Math.max(0, Math.min(100, score))
  if (drivers.length === 0) drivers.push('List health is within healthy thresholds')

  const grade = gradeFromScore(score)

  const [inserted] = await db
    .insert(list_health_snapshots)
    .values({
      workspace_id: workspaceId,
      sender_id: senderId,
      snapshot_at: now,
      grade,
      active_count: active,
      dormant_count: dormant,
      role_account_count: roleAccounts,
      hard_bounce_rate: hardBounceRate,
      soft_bounce_rate: softBounceRate,
      drivers,
    })
    .returning()

  return c.json(inserted, 201)
})

export default router
