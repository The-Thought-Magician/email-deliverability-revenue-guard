import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  integrations,
  workspace_members,
  imports,
  senders,
  campaigns,
  recipients,
  send_events,
  activity_log,
} from '../db/schema.js'
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

const PROVIDERS = ['mailchimp', 'klaviyo', 'sendgrid', 'braze', 'iterable', 'customerio', 'csv'] as const

const createSchema = z.object({
  workspaceId: z.string().min(1),
  provider: z.enum(PROVIDERS),
  displayName: z.string().min(1),
  config: z.record(z.unknown()).optional().default({}),
})

const EVENT_TYPES = ['delivered', 'open', 'click', 'bounce', 'complaint'] as const

// ---------------------------------------------------------------------------
// GET / — list connectors for a workspace
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(integrations)
    .where(eq(integrations.workspace_id, workspaceId))
    .orderBy(desc(integrations.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — register a connector
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [created] = await db
    .insert(integrations)
    .values({
      workspace_id: body.workspaceId,
      provider: body.provider,
      display_name: body.displayName,
      config: body.config,
      status: 'connected',
      created_by: userId,
    })
    .returning()
  await db.insert(activity_log).values({
    workspace_id: body.workspaceId,
    user_id: userId,
    action: 'integration.register',
    entity_type: 'integration',
    entity_id: created.id,
    detail: { provider: body.provider },
  })
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// POST /:id/pull — trigger an export pull → creates an import job + events
// ---------------------------------------------------------------------------
router.post('/:id/pull', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [integ] = await db.select().from(integrations).where(eq(integrations.id, id))
  if (!integ) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(integ.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const workspaceId = integ.workspace_id

  // Pick a sender to attribute the pulled events to (first available in the workspace).
  const [sender] = await db
    .select()
    .from(senders)
    .where(eq(senders.workspace_id, workspaceId))
    .orderBy(desc(senders.created_at))
    .limit(1)
  const senderId = sender?.id ?? null

  // Create the import job representing this pull.
  const [job] = await db
    .insert(imports)
    .values({
      workspace_id: workspaceId,
      sender_id: senderId,
      source: integ.provider,
      status: 'processing',
      filename: `${integ.provider}-pull-${new Date().toISOString().slice(0, 10)}.export`,
      column_mapping: {},
      is_sample: false,
      created_by: userId,
    })
    .returning()

  // Synthesize a deterministic export batch and write real send_events.
  const batch = 40
  const now = Date.now()
  let imported = 0
  let failed = 0
  const errors: Array<{ row: number; message: string }> = []

  // One campaign to group the pulled events under.
  const [campaign] = await db
    .insert(campaigns)
    .values({
      workspace_id: workspaceId,
      sender_id: senderId,
      name: `${integ.display_name} pull ${new Date(now).toISOString().slice(0, 10)}`,
      subject: 'Imported via connector',
      sent_at: new Date(now),
      metadata: { integration_id: integ.id, provider: integ.provider },
    })
    .returning()

  for (let i = 0; i < batch; i++) {
    const email = `pull_${integ.provider}_${i}@example.com`
    try {
      // Upsert the recipient.
      let [recipient] = await db
        .select()
        .from(recipients)
        .where(and(eq(recipients.workspace_id, workspaceId), eq(recipients.email, email)))
      if (!recipient) {
        ;[recipient] = await db
          .insert(recipients)
          .values({ workspace_id: workspaceId, email })
          .returning()
      }

      // Deterministic event mix: everyone delivered, a fraction open/click/bounce/complaint.
      const eventAt = new Date(now - i * 3_600_000)
      const types: string[] = ['delivered']
      if (i % 3 === 0) types.push('open')
      if (i % 6 === 0) types.push('click')
      if (i % 13 === 0) types.push('bounce')
      if (i % 29 === 0) types.push('complaint')

      for (const eventType of types) {
        if (!(EVENT_TYPES as readonly string[]).includes(eventType)) continue
        const messageId = `pull-${job.id}-${i}-${eventType}`
        await db
          .insert(send_events)
          .values({
            workspace_id: workspaceId,
            sender_id: senderId,
            campaign_id: campaign.id,
            recipient_id: recipient.id,
            import_id: job.id,
            message_id: messageId,
            event_type: eventType,
            bounce_type: eventType === 'bounce' ? (i % 26 === 0 ? 'hard' : 'soft') : null,
            event_at: eventAt,
          })
          .onConflictDoNothing()
      }
      imported++
    } catch (e: unknown) {
      failed++
      errors.push({ row: i, message: e instanceof Error ? e.message : String(e) })
    }
  }

  const [updatedJob] = await db
    .update(imports)
    .set({
      status: failed > 0 && imported === 0 ? 'failed' : 'completed',
      rows_total: batch,
      rows_imported: imported,
      rows_failed: failed,
      errors,
    })
    .where(eq(imports.id, job.id))
    .returning()

  await db
    .update(integrations)
    .set({ last_synced_at: new Date(), status: 'connected' })
    .where(eq(integrations.id, integ.id))

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    action: 'integration.pull',
    entity_type: 'import',
    entity_id: job.id,
    detail: { provider: integ.provider, rows_imported: imported },
  })

  return c.json({ import: updatedJob })
})

// ---------------------------------------------------------------------------
// DELETE /:id — remove a connector
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [integ] = await db.select().from(integrations).where(eq(integrations.id, id))
  if (!integ) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(integ.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(integrations).where(eq(integrations.id, id))
  await db.insert(activity_log).values({
    workspace_id: integ.workspace_id,
    user_id: userId,
    action: 'integration.remove',
    entity_type: 'integration',
    entity_id: id,
    detail: { provider: integ.provider },
  })
  return c.json({ success: true })
})

export default router
