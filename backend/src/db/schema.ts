import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Core tenancy
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  owner_id: text('owner_id').notNull(),
  currency: text('currency').notNull().default('USD'),
  fiscal_start_month: integer('fiscal_start_month').notNull().default(1),
  default_sender_id: text('default_sender_id'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  email: text('email'),
  role: text('role').notNull().default('analyst'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

export const senders = pgTable('senders', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  domain: text('domain').notNull(),
  subdomain: text('subdomain'),
  friendly_name: text('friendly_name').notNull(),
  status: text('status').notNull().default('active'),
  revenue_per_send_cents: integer('revenue_per_send_cents'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export const imports = pgTable('imports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  source: text('source').notNull().default('csv'),
  status: text('status').notNull().default('pending'),
  filename: text('filename'),
  column_mapping: jsonb('column_mapping').$type<Record<string, string>>().default({}),
  rows_total: integer('rows_total').notNull().default(0),
  rows_imported: integer('rows_imported').notNull().default(0),
  rows_failed: integer('rows_failed').notNull().default(0),
  errors: jsonb('errors').$type<Array<{ row: number; message: string }>>().default([]),
  is_sample: boolean('is_sample').notNull().default(false),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Campaigns, segments, recipients
// ---------------------------------------------------------------------------

export const segments = pgTable('segments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  description: text('description'),
  size: integer('size').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  segment_id: text('segment_id').references(() => segments.id),
  name: text('name').notNull(),
  subject: text('subject'),
  sent_at: timestamp('sent_at'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const recipients = pgTable('recipients', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  email: text('email').notNull(),
  is_role_account: boolean('is_role_account').notNull().default(false),
  last_engaged_at: timestamp('last_engaged_at'),
  total_sends: integer('total_sends').notNull().default(0),
  total_opens: integer('total_opens').notNull().default(0),
  total_clicks: integer('total_clicks').notNull().default(0),
  total_bounces: integer('total_bounces').notNull().default(0),
  total_complaints: integer('total_complaints').notNull().default(0),
  status: text('status').notNull().default('active'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.email)])

export const send_events = pgTable('send_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  campaign_id: text('campaign_id').references(() => campaigns.id),
  segment_id: text('segment_id').references(() => segments.id),
  recipient_id: text('recipient_id').references(() => recipients.id),
  import_id: text('import_id').references(() => imports.id),
  message_id: text('message_id').notNull(),
  event_type: text('event_type').notNull(),
  bounce_type: text('bounce_type'),
  event_at: timestamp('event_at').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.message_id, t.event_type)])

// ---------------------------------------------------------------------------
// Placement scoring
// ---------------------------------------------------------------------------

export const placement_scores = pgTable('placement_scores', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').notNull().references(() => senders.id),
  period_start: timestamp('period_start').notNull(),
  period_end: timestamp('period_end').notNull(),
  score: real('score').notNull(),
  engagement_component: real('engagement_component'),
  complaint_component: real('complaint_component'),
  bounce_component: real('bounce_component'),
  components: jsonb('components').$type<Record<string, number>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const reputation_timeline = pgTable('reputation_timeline', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').notNull().references(() => senders.id),
  bucket_at: timestamp('bucket_at').notNull(),
  complaint_rate: real('complaint_rate'),
  bounce_rate: real('bounce_rate'),
  engagement_rate: real('engagement_rate'),
  placement_score: real('placement_score'),
  annotation: text('annotation'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// List health, suppression
// ---------------------------------------------------------------------------

export const list_health_snapshots = pgTable('list_health_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').notNull().references(() => senders.id),
  snapshot_at: timestamp('snapshot_at').notNull(),
  grade: text('grade').notNull(),
  active_count: integer('active_count').notNull().default(0),
  dormant_count: integer('dormant_count').notNull().default(0),
  role_account_count: integer('role_account_count').notNull().default(0),
  hard_bounce_rate: real('hard_bounce_rate'),
  soft_bounce_rate: real('soft_bounce_rate'),
  drivers: jsonb('drivers').$type<string[]>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const suppression_recommendations = pgTable('suppression_recommendations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  recipient_id: text('recipient_id').references(() => recipients.id),
  target_email: text('target_email'),
  reason_code: text('reason_code').notNull(),
  reason: text('reason').notNull(),
  revenue_impact_cents: integer('revenue_impact_cents').notNull().default(0),
  status: text('status').notNull().default('pending'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Cohorts, sunsetting
// ---------------------------------------------------------------------------

export const engagement_cohorts = pgTable('engagement_cohorts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  name: text('name').notNull(),
  recency_days: integer('recency_days'),
  min_frequency: integer('min_frequency'),
  member_count: integer('member_count').notNull().default(0),
  engagement_rate: real('engagement_rate'),
  revenue_contribution_cents: integer('revenue_contribution_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const sunset_plans = pgTable('sunset_plans', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  name: text('name').notNull(),
  cohort_ids: jsonb('cohort_ids').$type<string[]>().default([]),
  schedule: text('schedule'),
  revenue_retained_cents: integer('revenue_retained_cents').notNull().default(0),
  revenue_forfeited_cents: integer('revenue_forfeited_cents').notNull().default(0),
  complaint_risk_reduction: real('complaint_risk_reduction'),
  status: text('status').notNull().default('draft'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

export const revenue_models = pgTable('revenue_models', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  version: integer('version').notNull().default(1),
  revenue_per_send_cents: integer('revenue_per_send_cents').notNull().default(0),
  conversion_rate: real('conversion_rate'),
  aov_cents: integer('aov_cents'),
  source: text('source').notNull().default('manual'),
  is_active: boolean('is_active').notNull().default(true),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const revenue_at_risk = pgTable('revenue_at_risk', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  campaign_id: text('campaign_id').references(() => campaigns.id),
  segment_id: text('segment_id').references(() => segments.id),
  period_start: timestamp('period_start').notNull(),
  period_end: timestamp('period_end').notNull(),
  cause: text('cause').notNull(),
  at_risk_cents: integer('at_risk_cents').notNull().default(0),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export const alert_rules = pgTable('alert_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  segment_id: text('segment_id').references(() => segments.id),
  metric: text('metric').notNull(),
  threshold: real('threshold').notNull(),
  comparison: text('comparison').notNull().default('gt'),
  enabled: boolean('enabled').notNull().default(true),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  rule_id: text('rule_id').references(() => alert_rules.id),
  sender_id: text('sender_id').references(() => senders.id),
  campaign_id: text('campaign_id').references(() => campaigns.id),
  segment_id: text('segment_id').references(() => segments.id),
  metric: text('metric').notNull(),
  observed_value: real('observed_value'),
  threshold: real('threshold'),
  severity: text('severity').notNull().default('warning'),
  message: text('message').notNull(),
  status: text('status').notNull().default('open'),
  triggered_at: timestamp('triggered_at').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Fatigue, scorecards
// ---------------------------------------------------------------------------

export const fatigue_analyses = pgTable('fatigue_analyses', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  segment_id: text('segment_id').references(() => segments.id),
  name: text('name').notNull(),
  curve: jsonb('curve').$type<Array<{ frequency: number; engagement_rate: number }>>().default([]),
  recommended_cadence_per_week: real('recommended_cadence_per_week'),
  projected_complaint_reduction: real('projected_complaint_reduction'),
  is_overmailing: boolean('is_overmailing').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const scorecards = pgTable('scorecards', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').references(() => senders.id),
  generated_at: timestamp('generated_at').notNull(),
  grade: text('grade').notNull(),
  placement_score: real('placement_score'),
  list_health_grade: text('list_health_grade'),
  complaint_rate: real('complaint_rate'),
  revenue_at_risk_cents: integer('revenue_at_risk_cents').notNull().default(0),
  top_actions: jsonb('top_actions').$type<string[]>().default([]),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Benchmarks, authentication
// ---------------------------------------------------------------------------

export const benchmarks = pgTable('benchmarks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  category: text('category').notNull(),
  value: real('value').notNull(),
  unit: text('unit'),
  source: text('source'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const authentication_checks = pgTable('authentication_checks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  sender_id: text('sender_id').notNull().references(() => senders.id),
  spf_status: text('spf_status').notNull().default('unknown'),
  dkim_status: text('dkim_status').notNull().default('unknown'),
  dmarc_status: text('dmarc_status').notNull().default('unknown'),
  dmarc_policy: text('dmarc_policy'),
  one_click_unsub: boolean('one_click_unsub').notNull().default(false),
  notes: text('notes'),
  checked_at: timestamp('checked_at').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Reports, integrations, notifications, activity
// ---------------------------------------------------------------------------

export const reports = pgTable('reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  schedule: text('schedule'),
  last_rendered_at: timestamp('last_rendered_at'),
  output: jsonb('output').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  provider: text('provider').notNull(),
  display_name: text('display_name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  status: text('status').notNull().default('connected'),
  last_synced_at: timestamp('last_synced_at'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  read: boolean('read').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  action: text('action').notNull(),
  entity_type: text('entity_type'),
  entity_id: text('entity_id'),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
