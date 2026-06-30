import { db } from './index.js'
import { sql } from 'drizzle-orm'

// Idempotent, self-provisioning schema for a fresh Neon database.
// Column names/types EXACTLY match src/db/schema.ts.
// timestamps -> timestamptz, jsonb -> jsonb, real -> real, integer -> integer,
// boolean -> boolean, text -> text.

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner_id text NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    fiscal_start_month integer NOT NULL DEFAULT 1,
    default_sender_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    email text,
    role text NOT NULL DEFAULT 'analyst',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS senders (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    domain text NOT NULL,
    subdomain text,
    friendly_name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    revenue_per_send_cents integer,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS imports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    source text NOT NULL DEFAULT 'csv',
    status text NOT NULL DEFAULT 'pending',
    filename text,
    column_mapping jsonb DEFAULT '{}'::jsonb,
    rows_total integer NOT NULL DEFAULT 0,
    rows_imported integer NOT NULL DEFAULT 0,
    rows_failed integer NOT NULL DEFAULT 0,
    errors jsonb DEFAULT '[]'::jsonb,
    is_sample boolean NOT NULL DEFAULT false,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS segments (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    description text,
    size integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS campaigns (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    segment_id text REFERENCES segments(id),
    name text NOT NULL,
    subject text,
    sent_at timestamptz,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS recipients (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    email text NOT NULL,
    is_role_account boolean NOT NULL DEFAULT false,
    last_engaged_at timestamptz,
    total_sends integer NOT NULL DEFAULT 0,
    total_opens integer NOT NULL DEFAULT 0,
    total_clicks integer NOT NULL DEFAULT 0,
    total_bounces integer NOT NULL DEFAULT 0,
    total_complaints integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, email)
  )`,

  `CREATE TABLE IF NOT EXISTS send_events (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    campaign_id text REFERENCES campaigns(id),
    segment_id text REFERENCES segments(id),
    recipient_id text REFERENCES recipients(id),
    import_id text REFERENCES imports(id),
    message_id text NOT NULL,
    event_type text NOT NULL,
    bounce_type text,
    event_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, message_id, event_type)
  )`,

  `CREATE TABLE IF NOT EXISTS placement_scores (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text NOT NULL REFERENCES senders(id),
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    score real NOT NULL,
    engagement_component real,
    complaint_component real,
    bounce_component real,
    components jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reputation_timeline (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text NOT NULL REFERENCES senders(id),
    bucket_at timestamptz NOT NULL,
    complaint_rate real,
    bounce_rate real,
    engagement_rate real,
    placement_score real,
    annotation text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS list_health_snapshots (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text NOT NULL REFERENCES senders(id),
    snapshot_at timestamptz NOT NULL,
    grade text NOT NULL,
    active_count integer NOT NULL DEFAULT 0,
    dormant_count integer NOT NULL DEFAULT 0,
    role_account_count integer NOT NULL DEFAULT 0,
    hard_bounce_rate real,
    soft_bounce_rate real,
    drivers jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS suppression_recommendations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    recipient_id text REFERENCES recipients(id),
    target_email text,
    reason_code text NOT NULL,
    reason text NOT NULL,
    revenue_impact_cents integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS engagement_cohorts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    name text NOT NULL,
    recency_days integer,
    min_frequency integer,
    member_count integer NOT NULL DEFAULT 0,
    engagement_rate real,
    revenue_contribution_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS sunset_plans (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    name text NOT NULL,
    cohort_ids jsonb DEFAULT '[]'::jsonb,
    schedule text,
    revenue_retained_cents integer NOT NULL DEFAULT 0,
    revenue_forfeited_cents integer NOT NULL DEFAULT 0,
    complaint_risk_reduction real,
    status text NOT NULL DEFAULT 'draft',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS revenue_models (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    version integer NOT NULL DEFAULT 1,
    revenue_per_send_cents integer NOT NULL DEFAULT 0,
    conversion_rate real,
    aov_cents integer,
    source text NOT NULL DEFAULT 'manual',
    is_active boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS revenue_at_risk (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    campaign_id text REFERENCES campaigns(id),
    segment_id text REFERENCES segments(id),
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    cause text NOT NULL,
    at_risk_cents integer NOT NULL DEFAULT 0,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS alert_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    segment_id text REFERENCES segments(id),
    metric text NOT NULL,
    threshold real NOT NULL,
    comparison text NOT NULL DEFAULT 'gt',
    enabled boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS alerts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    rule_id text REFERENCES alert_rules(id),
    sender_id text REFERENCES senders(id),
    campaign_id text REFERENCES campaigns(id),
    segment_id text REFERENCES segments(id),
    metric text NOT NULL,
    observed_value real,
    threshold real,
    severity text NOT NULL DEFAULT 'warning',
    message text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    triggered_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS fatigue_analyses (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    segment_id text REFERENCES segments(id),
    name text NOT NULL,
    curve jsonb DEFAULT '[]'::jsonb,
    recommended_cadence_per_week real,
    projected_complaint_reduction real,
    is_overmailing boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS scorecards (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text REFERENCES senders(id),
    generated_at timestamptz NOT NULL,
    grade text NOT NULL,
    placement_score real,
    list_health_grade text,
    complaint_rate real,
    revenue_at_risk_cents integer NOT NULL DEFAULT 0,
    top_actions jsonb DEFAULT '[]'::jsonb,
    payload jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS benchmarks (
    id text PRIMARY KEY,
    key text NOT NULL UNIQUE,
    label text NOT NULL,
    category text NOT NULL,
    value real NOT NULL,
    unit text,
    source text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS authentication_checks (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    sender_id text NOT NULL REFERENCES senders(id),
    spf_status text NOT NULL DEFAULT 'unknown',
    dkim_status text NOT NULL DEFAULT 'unknown',
    dmarc_status text NOT NULL DEFAULT 'unknown',
    dmarc_policy text,
    one_click_unsub boolean NOT NULL DEFAULT false,
    notes text,
    checked_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    kind text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    schedule text,
    last_rendered_at timestamptz,
    output jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS integrations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    provider text NOT NULL,
    display_name text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'connected',
    last_synced_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS activity_log (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    action text NOT NULL,
    entity_type text,
    entity_id text,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Indexes on FKs / workspace_id for query performance.
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_senders_workspace ON senders(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_imports_workspace ON imports(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_imports_sender ON imports(sender_id)`,
  `CREATE INDEX IF NOT EXISTS idx_segments_workspace ON segments(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_workspace ON campaigns(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_sender ON campaigns(sender_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recipients_workspace ON recipients(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_send_events_workspace ON send_events(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_send_events_sender ON send_events(sender_id)`,
  `CREATE INDEX IF NOT EXISTS idx_send_events_campaign ON send_events(campaign_id)`,
  `CREATE INDEX IF NOT EXISTS idx_send_events_recipient ON send_events(recipient_id)`,
  `CREATE INDEX IF NOT EXISTS idx_send_events_event_at ON send_events(event_at)`,
  `CREATE INDEX IF NOT EXISTS idx_placement_scores_workspace ON placement_scores(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_placement_scores_sender ON placement_scores(sender_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reputation_timeline_workspace ON reputation_timeline(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reputation_timeline_sender ON reputation_timeline(sender_id)`,
  `CREATE INDEX IF NOT EXISTS idx_list_health_workspace ON list_health_snapshots(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_list_health_sender ON list_health_snapshots(sender_id)`,
  `CREATE INDEX IF NOT EXISTS idx_suppression_workspace ON suppression_recommendations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cohorts_workspace ON engagement_cohorts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sunset_workspace ON sunset_plans(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_revenue_models_workspace ON revenue_models(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_revenue_at_risk_workspace ON revenue_at_risk(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alert_rules_workspace ON alert_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_workspace ON alerts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fatigue_workspace ON fatigue_analyses(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scorecards_workspace ON scorecards(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_authentication_workspace ON authentication_checks(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_authentication_sender ON authentication_checks(sender_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_workspace ON reports(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_integrations_workspace ON integrations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_workspace ON activity_log(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log(`Migrated ${statements.length} statements`)
}
