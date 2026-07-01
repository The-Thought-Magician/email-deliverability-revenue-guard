import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  benchmarks,
  workspaces,
  workspace_members,
  senders,
} from './db/schema.js'

// Domain routes
import workspacesRoutes from './routes/workspaces.js'
import sendersRoutes from './routes/senders.js'
import importsRoutes from './routes/imports.js'
import campaignsRoutes from './routes/campaigns.js'
import segmentsRoutes from './routes/segments.js'
import eventsRoutes from './routes/events.js'
import recipientsRoutes from './routes/recipients.js'
import placementRoutes from './routes/placement.js'
import listHealthRoutes from './routes/list-health.js'
import suppressionRoutes from './routes/suppression.js'
import cohortsRoutes from './routes/cohorts.js'
import sunsetRoutes from './routes/sunset.js'
import revenueModelRoutes from './routes/revenue-model.js'
import revenueAtRiskRoutes from './routes/revenue-at-risk.js'
import alertsRoutes from './routes/alerts.js'
import alertRulesRoutes from './routes/alert-rules.js'
import fatigueRoutes from './routes/fatigue.js'
import scorecardsRoutes from './routes/scorecards.js'
import benchmarksRoutes from './routes/benchmarks.js'
import authenticationRoutes from './routes/authentication.js'
import reputationRoutes from './routes/reputation.js'
import reportsRoutes from './routes/reports.js'
import integrationsRoutes from './routes/integrations.js'
import notificationsRoutes from './routes/notifications.js'
import activityRoutes from './routes/activity.js'
import billingRoutes from './routes/billing.js'

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
})

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://email-deliverability-revenue-guard.vercel.app',
  'https://email-deliverability-revenue-guard-ventures.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/senders', sendersRoutes)
api.route('/imports', importsRoutes)
api.route('/campaigns', campaignsRoutes)
api.route('/segments', segmentsRoutes)
api.route('/events', eventsRoutes)
api.route('/recipients', recipientsRoutes)
api.route('/placement', placementRoutes)
api.route('/list-health', listHealthRoutes)
api.route('/suppression', suppressionRoutes)
api.route('/cohorts', cohortsRoutes)
api.route('/sunset', sunsetRoutes)
api.route('/revenue-model', revenueModelRoutes)
api.route('/revenue-at-risk', revenueAtRiskRoutes)
api.route('/alerts', alertsRoutes)
api.route('/alert-rules', alertRulesRoutes)
api.route('/fatigue', fatigueRoutes)
api.route('/scorecards', scorecardsRoutes)
api.route('/benchmarks', benchmarksRoutes)
api.route('/authentication', authenticationRoutes)
api.route('/reputation', reputationRoutes)
api.route('/reports', reportsRoutes)
api.route('/integrations', integrationsRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/activity', activityRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ---------------------------------------------------------------------------
// Seed data (idempotent: count-then-insert)
// ---------------------------------------------------------------------------

const seedPlans = [
  { id: 'free', name: 'Free', price_cents: 0 },
  { id: 'pro', name: 'Pro', price_cents: 4900 },
]

const seedBenchmarks = [
  {
    key: 'gmail_complaint_threshold',
    label: 'Gmail complaint rate (enforcement)',
    category: 'complaints',
    value: 0.003,
    unit: 'rate',
    source: 'Google Bulk Sender Guidelines',
  },
  {
    key: 'gmail_complaint_target',
    label: 'Gmail complaint rate (target)',
    category: 'complaints',
    value: 0.001,
    unit: 'rate',
    source: 'Google Bulk Sender Guidelines',
  },
  {
    key: 'hard_bounce_ceiling',
    label: 'Hard bounce rate ceiling',
    category: 'bounces',
    value: 0.02,
    unit: 'rate',
    source: 'Industry consensus',
  },
  {
    key: 'healthy_open_rate',
    label: 'Healthy open rate',
    category: 'engagement',
    value: 0.2,
    unit: 'rate',
    source: 'Industry benchmark',
  },
  {
    key: 'healthy_click_rate',
    label: 'Healthy click rate',
    category: 'engagement',
    value: 0.025,
    unit: 'rate',
    source: 'Industry benchmark',
  },
  {
    key: 'dormant_threshold_days',
    label: 'Dormant subscriber threshold',
    category: 'list_health',
    value: 90,
    unit: 'days',
    source: 'Deliverability best practice',
  },
  {
    key: 'sunset_threshold_days',
    label: 'Sunset (re-engagement) threshold',
    category: 'list_health',
    value: 180,
    unit: 'days',
    source: 'Deliverability best practice',
  },
]

async function seedIfEmpty() {
  // Plans
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    for (const p of seedPlans) {
      await db.insert(plans).values(p).onConflictDoNothing()
    }
    console.log('Seeded plans')
  }

  // Benchmarks
  const existingBenchmarks = await db.select().from(benchmarks).limit(1)
  if (existingBenchmarks.length === 0) {
    for (const b of seedBenchmarks) {
      await db.insert(benchmarks).values(b as any).onConflictDoNothing()
    }
    console.log('Seeded benchmarks')
  }

  // Demo workspace (so a fresh deploy has something to show).
  const existingWorkspaces = await db.select().from(workspaces).limit(1)
  if (existingWorkspaces.length === 0) {
    const demoOwner = 'demo-user'
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Demo Workspace', owner_id: demoOwner, currency: 'USD' })
      .returning()
    if (ws) {
      await db
        .insert(workspace_members)
        .values({ workspace_id: ws.id, user_id: demoOwner, role: 'owner' })
        .onConflictDoNothing()
      await db
        .insert(senders)
        .values({
          workspace_id: ws.id,
          domain: 'mail.example.com',
          friendly_name: 'Marketing Sender',
          status: 'active',
          revenue_per_send_cents: 12,
          created_by: demoOwner,
        })
        .onConflictDoNothing()
      console.log('Seeded demo workspace')
    }
  }
}

// ---------------------------------------------------------------------------
// Boot order: bind the port FIRST so the platform health check sees a live
// service immediately, THEN run migrate() + seedIfEmpty() (both idempotent),
// each in its own try/catch so a cold DB cannot block the port binding.
// ---------------------------------------------------------------------------

const port = parseInt(process.env.PORT ?? '3001')

serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

async function bootstrap() {
  try {
    await migrate()
  } catch (e) {
    console.error('Migrate error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
}

bootstrap().catch((e) => console.error('Bootstrap error:', e))

export default app
