# EmailDeliverabilityRevenueGuard — Build Plan (Authoritative Build Contract)

This is the single source of truth. Filenames, mount paths, api method names, and page files declared here are BINDING. Every other agent follows this exactly.

Stack: Hono 4.12.27 backend (TypeScript, ESM, `node --import tsx/esm`), drizzle-orm 0.45.2 + @neondatabase/serverless, Next.js 16 + React 19 + Tailwind 4 frontend, Neon Auth (`@neondatabase/auth@0.4.2-beta`). Backend trusts `X-User-Id`; use `getUserId(c)` everywhere. Routes mount under `/api/v1` via a child Hono `api` router. Each domain route file does `export default router`. Public reads / auth-gated writes with zod validation + ownership checks. Frontend calls `fetch('/api/proxy/<path>')` 1:1 to `/api/v1/<path>`. `web/proxy.ts` only (no middleware.ts). Auth pages use client `onSubmit` + `authClient`. Landing is purely static.

Schema self-provisions on boot via `src/db/migrate.ts` (`migrate()` called in `index.ts`), followed by `seedIfEmpty()` (benchmarks + plans seed).

---

## (a) Tables (columns)

1. **workspaces** — id, name, owner_id, currency, fiscal_start_month(int), default_sender_id, created_at, updated_at
2. **workspace_members** — id, workspace_id(FK), user_id, email, role, created_at; UNIQUE(workspace_id,user_id)
3. **senders** — id, workspace_id(FK), domain, subdomain, friendly_name, status, revenue_per_send_cents(int), created_by, created_at, updated_at
4. **imports** — id, workspace_id(FK), sender_id(FK), source, status, filename, column_mapping(jsonb), rows_total(int), rows_imported(int), rows_failed(int), errors(jsonb), is_sample(bool), created_by, created_at
5. **segments** — id, workspace_id(FK), name, description, size(int), created_at
6. **campaigns** — id, workspace_id(FK), sender_id(FK), segment_id(FK), name, subject, sent_at, metadata(jsonb), created_at
7. **recipients** — id, workspace_id(FK), email, is_role_account(bool), last_engaged_at, total_sends(int), total_opens(int), total_clicks(int), total_bounces(int), total_complaints(int), status, created_at; UNIQUE(workspace_id,email)
8. **send_events** — id, workspace_id(FK), sender_id(FK), campaign_id(FK), segment_id(FK), recipient_id(FK), import_id(FK), message_id, event_type, bounce_type, event_at, created_at; UNIQUE(workspace_id,message_id,event_type)
9. **placement_scores** — id, workspace_id(FK), sender_id(FK), period_start, period_end, score(real), engagement_component(real), complaint_component(real), bounce_component(real), components(jsonb), created_at
10. **reputation_timeline** — id, workspace_id(FK), sender_id(FK), bucket_at, complaint_rate(real), bounce_rate(real), engagement_rate(real), placement_score(real), annotation, created_at
11. **list_health_snapshots** — id, workspace_id(FK), sender_id(FK), snapshot_at, grade, active_count(int), dormant_count(int), role_account_count(int), hard_bounce_rate(real), soft_bounce_rate(real), drivers(jsonb), created_at
12. **suppression_recommendations** — id, workspace_id(FK), sender_id(FK), recipient_id(FK), target_email, reason_code, reason, revenue_impact_cents(int), status, created_at
13. **engagement_cohorts** — id, workspace_id(FK), sender_id(FK), name, recency_days(int), min_frequency(int), member_count(int), engagement_rate(real), revenue_contribution_cents(int), created_at
14. **sunset_plans** — id, workspace_id(FK), sender_id(FK), name, cohort_ids(jsonb), schedule, revenue_retained_cents(int), revenue_forfeited_cents(int), complaint_risk_reduction(real), status, created_by, created_at
15. **revenue_models** — id, workspace_id(FK), sender_id(FK), version(int), revenue_per_send_cents(int), conversion_rate(real), aov_cents(int), source, is_active(bool), created_by, created_at
16. **revenue_at_risk** — id, workspace_id(FK), sender_id(FK), campaign_id(FK), segment_id(FK), period_start, period_end, cause, at_risk_cents(int), detail(jsonb), created_at
17. **alert_rules** — id, workspace_id(FK), sender_id(FK), segment_id(FK), metric, threshold(real), comparison, enabled(bool), created_by, created_at
18. **alerts** — id, workspace_id(FK), rule_id(FK), sender_id(FK), campaign_id(FK), segment_id(FK), metric, observed_value(real), threshold(real), severity, message, status, triggered_at, created_at
19. **fatigue_analyses** — id, workspace_id(FK), sender_id(FK), segment_id(FK), name, curve(jsonb), recommended_cadence_per_week(real), projected_complaint_reduction(real), is_overmailing(bool), created_at
20. **scorecards** — id, workspace_id(FK), sender_id(FK), generated_at, grade, placement_score(real), list_health_grade, complaint_rate(real), revenue_at_risk_cents(int), top_actions(jsonb), payload(jsonb), created_by, created_at
21. **benchmarks** — id, key(unique), label, category, value(real), unit, source, created_at
22. **authentication_checks** — id, workspace_id(FK), sender_id(FK), spf_status, dkim_status, dmarc_status, dmarc_policy, one_click_unsub(bool), notes, checked_at, created_at
23. **reports** — id, workspace_id(FK), name, kind, config(jsonb), schedule, last_rendered_at, output(jsonb), created_by, created_at
24. **integrations** — id, workspace_id(FK), provider, display_name, config(jsonb), status, last_synced_at, created_by, created_at
25. **notifications** — id, workspace_id(FK), user_id, kind, title, body, link, read(bool), created_at
26. **activity_log** — id, workspace_id(FK), user_id, action, entity_type, entity_id, detail(jsonb), created_at
27. **plans** — id(text PK 'free'/'pro'), name, price_cents(int)
28. **subscriptions** — id, user_id(unique), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mount under `/api/v1`)

All workspace-scoped reads/writes require auth + ownership check (caller must be a member of the workspace). `workspaceId` arrives as a query param on list/reads and in the body on creates. Convention shorthand below: "auth?" Y = `authMiddleware`, N = public.

### 1. `workspaces.ts` → mount `workspaces`
- `GET /` — auth Y — list workspaces the user is a member of — `Workspace[]`
- `POST /` — auth Y — create workspace (also creates owner membership) — `Workspace`
- `GET /:id` — auth Y — get one (membership check) — `Workspace`
- `PUT /:id` — auth Y — rename/settings (currency, fiscal, default_sender) — `Workspace`
- `DELETE /:id` — auth Y — delete (owner only) — `{success:true}`
- `GET /:id/members` — auth Y — list members — `Member[]`
- `POST /:id/members` — auth Y — invite member {email,role} — `Member`
- `DELETE /:id/members/:memberId` — auth Y — remove member — `{success:true}`

### 2. `senders.ts` → mount `senders`
- `GET /` — auth Y — list senders for `?workspaceId` — `Sender[]`
- `POST /` — auth Y — create sender — `Sender`
- `GET /:id` — auth Y — sender detail + summary metrics — `SenderDetail`
- `PUT /:id` — auth Y — update (status, friendly_name, revenue_per_send) — `Sender`
- `DELETE /:id` — auth Y — archive/delete — `{success:true}`

### 3. `imports.ts` → mount `imports`
- `GET /` — auth Y — list import jobs `?workspaceId` — `Import[]`
- `GET /:id` — auth Y — import detail + errors — `Import`
- `POST /` — auth Y — create import from uploaded rows {workspaceId,senderId,filename,columnMapping,rows[]} — parses+normalizes into send_events — `Import`
- `POST /sample` — auth Y — seed sample data {workspaceId} — generates senders/campaigns/90d events — `{import:Import}`
- `DELETE /:id` — auth Y — delete an import and its events — `{success:true}`

### 4. `campaigns.ts` → mount `campaigns`
- `GET /` — auth Y — list campaign rollups `?workspaceId&senderId?` — `CampaignRollup[]`
- `GET /:id` — auth Y — single campaign drilldown (rollup + rates + deltas) — `CampaignDetail`
- `GET /:id/events` — auth Y — events behind a campaign — `SendEvent[]`

### 5. `segments.ts` → mount `segments`
- `GET /` — auth Y — list segments `?workspaceId` — `Segment[]`
- `POST /` — auth Y — create segment — `Segment`
- `DELETE /:id` — auth Y — delete segment — `{success:true}`

### 6. `events.ts` → mount `events`
- `GET /` — auth Y — paginated event explorer `?workspaceId&type&senderId&from&to&limit&offset` — `{events:SendEvent[],total}`

### 7. `recipients.ts` → mount `recipients`
- `GET /` — auth Y — paginated recipients `?workspaceId&status&limit&offset` — `{recipients:Recipient[],total}`
- `GET /:id` — auth Y — recipient profile + event history — `RecipientDetail`

### 8. `placement.ts` → mount `placement`
- `GET /` — auth Y — list placement scores `?workspaceId&senderId?` — `PlacementScore[]`
- `POST /compute` — auth Y — compute placement score for a sender/period {workspaceId,senderId} — `PlacementScore`
- `GET /trend` — auth Y — score trend series `?workspaceId&senderId` — `{points:[]}`

### 9. `list-health.ts` → mount `list-health`
- `GET /` — auth Y — latest snapshot + history `?workspaceId&senderId` — `{latest:Snapshot,history:Snapshot[]}`
- `POST /compute` — auth Y — compute a snapshot {workspaceId,senderId} — `Snapshot`

### 10. `suppression.ts` → mount `suppression`
- `GET /` — auth Y — list recommendations `?workspaceId&status?` — `Recommendation[]`
- `POST /compute` — auth Y — regenerate recommendations {workspaceId,senderId?} — `Recommendation[]`
- `PUT /:id` — auth Y — accept/dismiss {status} — `Recommendation`
- `GET /export` — auth Y — accepted suppression list `?workspaceId` — `{emails:string[]}`

### 11. `cohorts.ts` → mount `cohorts`
- `GET /` — auth Y — list cohorts `?workspaceId&senderId?` — `Cohort[]`
- `POST /compute` — auth Y — (re)compute standard cohorts {workspaceId,senderId?} — `Cohort[]`

### 12. `sunset.ts` → mount `sunset`
- `GET /` — auth Y — list sunset plans `?workspaceId` — `SunsetPlan[]`
- `GET /:id` — auth Y — plan detail — `SunsetPlan`
- `POST /preview` — auth Y — preview revenue impact {workspaceId,senderId?,cohortIds,schedule} (no persist) — `{retained,forfeited,riskReduction}`
- `POST /` — auth Y — save plan — `SunsetPlan`
- `DELETE /:id` — auth Y — delete plan — `{success:true}`

### 13. `revenue-model.ts` → mount `revenue-model`
- `GET /` — auth Y — active model + versions `?workspaceId&senderId?` — `{active:RevenueModel,versions:RevenueModel[]}`
- `POST /` — auth Y — create new model version (deactivates prior) — `RevenueModel`
- `POST /derive` — auth Y — derive per-send value from history {workspaceId,senderId?} — `{revenuePerSendCents,conversionRate,aovCents}`

### 14. `revenue-at-risk.ts` → mount `revenue-at-risk`
- `GET /` — auth Y — at-risk records `?workspaceId&senderId?` — `RevenueAtRisk[]`
- `POST /compute` — auth Y — recompute at-risk {workspaceId,senderId?} — `RevenueAtRisk[]`
- `GET /summary` — auth Y — totals by cause + trend `?workspaceId` — `{byCause,trend,total}`
- `GET /top-contributors` — auth Y — top segments/campaigns by risk `?workspaceId` — `Contributor[]`

### 15. `alerts.ts` → mount `alerts`
- `GET /` — auth Y — alert feed `?workspaceId&status?` — `Alert[]`
- `POST /scan` — auth Y — run detection vs rules {workspaceId} — `Alert[]`
- `PUT /:id` — auth Y — acknowledge/resolve {status} — `Alert`

### 16. `alert-rules.ts` → mount `alert-rules`
- `GET /` — auth Y — list rules `?workspaceId` — `AlertRule[]`
- `POST /` — auth Y — create rule — `AlertRule`
- `PUT /:id` — auth Y — update rule (threshold, enabled) — `AlertRule`
- `DELETE /:id` — auth Y — delete rule — `{success:true}`

### 17. `fatigue.ts` → mount `fatigue`
- `GET /` — auth Y — list fatigue analyses `?workspaceId` — `FatigueAnalysis[]`
- `POST /compute` — auth Y — compute frequency/engagement curve {workspaceId,senderId?,segmentId?} — `FatigueAnalysis`

### 18. `scorecards.ts` → mount `scorecards`
- `GET /` — auth Y — list scorecards `?workspaceId` — `Scorecard[]`
- `GET /:id` — auth Y — scorecard payload — `Scorecard`
- `POST /generate` — auth Y — generate scorecard {workspaceId,senderId} — `Scorecard`
- `GET /:id/export` — auth Y — export payload (JSON bundle) — `{payload}`

### 19. `benchmarks.ts` → mount `benchmarks`
- `GET /` — auth N (public) — list benchmark reference values — `Benchmark[]`

### 20. `authentication.ts` → mount `authentication`
- `GET /` — auth Y — checks `?workspaceId&senderId?` — `AuthCheck[]`
- `POST /` — auth Y — record/update a posture check — `AuthCheck`

### 21. `reputation.ts` → mount `reputation`
- `GET /` — auth Y — reputation timeline `?workspaceId&senderId` — `{points:ReputationPoint[]}`
- `POST /rebuild` — auth Y — rebuild timeline from events {workspaceId,senderId} — `{points:ReputationPoint[]}`

### 22. `reports.ts` → mount `reports`
- `GET /` — auth Y — list saved reports `?workspaceId` — `Report[]`
- `POST /` — auth Y — create report definition — `Report`
- `POST /:id/render` — auth Y — render report output — `Report`
- `DELETE /:id` — auth Y — delete report — `{success:true}`

### 23. `integrations.ts` → mount `integrations`
- `GET /` — auth Y — list connectors `?workspaceId` — `Integration[]`
- `POST /` — auth Y — register connector — `Integration`
- `POST /:id/pull` — auth Y — trigger an export pull (creates import job) — `{import:Import}`
- `DELETE /:id` — auth Y — remove connector — `{success:true}`

### 24. `notifications.ts` → mount `notifications`
- `GET /` — auth Y — current user notifications `?workspaceId` — `Notification[]`
- `PUT /:id/read` — auth Y — mark read — `Notification`
- `PUT /read-all` — auth Y — mark all read {workspaceId} — `{success:true}`

### 25. `activity.ts` → mount `activity`
- `GET /` — auth Y — activity log `?workspaceId&limit&offset` — `{entries:Activity[],total}`

### 26. `billing.ts` → mount `billing`
- `GET /plan` — auth Y — current subscription + plan + stripeEnabled — `{subscription,plan,stripeEnabled}`
- `POST /checkout` — auth Y — Stripe checkout (503 if unconfigured) — `{url}`
- `POST /portal` — auth Y — Stripe portal (503 if unconfigured) — `{url}`
- `POST /webhook` — auth N — Stripe webhook (503 if unconfigured) — `{received:true}`

Total route files: **26**.

---

## (c) `web/lib/api.ts` method list (method → relative `/api/proxy/...` path → verb)

Workspaces:
- `listWorkspaces()` → `/api/proxy/workspaces` GET
- `createWorkspace(body)` → `/api/proxy/workspaces` POST
- `getWorkspace(id)` → `/api/proxy/workspaces/{id}` GET
- `updateWorkspace(id,body)` → `/api/proxy/workspaces/{id}` PUT
- `deleteWorkspace(id)` → `/api/proxy/workspaces/{id}` DELETE
- `listMembers(id)` → `/api/proxy/workspaces/{id}/members` GET
- `inviteMember(id,body)` → `/api/proxy/workspaces/{id}/members` POST
- `removeMember(id,memberId)` → `/api/proxy/workspaces/{id}/members/{memberId}` DELETE

Senders:
- `listSenders(workspaceId)` → `/api/proxy/senders?workspaceId=` GET
- `createSender(body)` → `/api/proxy/senders` POST
- `getSender(id)` → `/api/proxy/senders/{id}` GET
- `updateSender(id,body)` → `/api/proxy/senders/{id}` PUT
- `deleteSender(id)` → `/api/proxy/senders/{id}` DELETE

Imports:
- `listImports(workspaceId)` → `/api/proxy/imports?workspaceId=` GET
- `getImport(id)` → `/api/proxy/imports/{id}` GET
- `createImport(body)` → `/api/proxy/imports` POST
- `seedSample(workspaceId)` → `/api/proxy/imports/sample` POST
- `deleteImport(id)` → `/api/proxy/imports/{id}` DELETE

Campaigns:
- `listCampaigns(workspaceId,senderId?)` → `/api/proxy/campaigns?workspaceId=` GET
- `getCampaign(id)` → `/api/proxy/campaigns/{id}` GET
- `getCampaignEvents(id)` → `/api/proxy/campaigns/{id}/events` GET

Segments:
- `listSegments(workspaceId)` → `/api/proxy/segments?workspaceId=` GET
- `createSegment(body)` → `/api/proxy/segments` POST
- `deleteSegment(id)` → `/api/proxy/segments/{id}` DELETE

Events:
- `listEvents(params)` → `/api/proxy/events?workspaceId=...` GET

Recipients:
- `listRecipients(params)` → `/api/proxy/recipients?workspaceId=...` GET
- `getRecipient(id)` → `/api/proxy/recipients/{id}` GET

Placement:
- `listPlacementScores(workspaceId,senderId?)` → `/api/proxy/placement?workspaceId=` GET
- `computePlacement(body)` → `/api/proxy/placement/compute` POST
- `getPlacementTrend(workspaceId,senderId)` → `/api/proxy/placement/trend?workspaceId=&senderId=` GET

List health:
- `getListHealth(workspaceId,senderId)` → `/api/proxy/list-health?workspaceId=&senderId=` GET
- `computeListHealth(body)` → `/api/proxy/list-health/compute` POST

Suppression:
- `listSuppression(workspaceId,status?)` → `/api/proxy/suppression?workspaceId=` GET
- `computeSuppression(body)` → `/api/proxy/suppression/compute` POST
- `updateSuppression(id,body)` → `/api/proxy/suppression/{id}` PUT
- `exportSuppression(workspaceId)` → `/api/proxy/suppression/export?workspaceId=` GET

Cohorts:
- `listCohorts(workspaceId,senderId?)` → `/api/proxy/cohorts?workspaceId=` GET
- `computeCohorts(body)` → `/api/proxy/cohorts/compute` POST

Sunset:
- `listSunsetPlans(workspaceId)` → `/api/proxy/sunset?workspaceId=` GET
- `getSunsetPlan(id)` → `/api/proxy/sunset/{id}` GET
- `previewSunset(body)` → `/api/proxy/sunset/preview` POST
- `createSunsetPlan(body)` → `/api/proxy/sunset` POST
- `deleteSunsetPlan(id)` → `/api/proxy/sunset/{id}` DELETE

Revenue model:
- `getRevenueModel(workspaceId,senderId?)` → `/api/proxy/revenue-model?workspaceId=` GET
- `createRevenueModel(body)` → `/api/proxy/revenue-model` POST
- `deriveRevenueModel(body)` → `/api/proxy/revenue-model/derive` POST

Revenue at risk:
- `listRevenueAtRisk(workspaceId,senderId?)` → `/api/proxy/revenue-at-risk?workspaceId=` GET
- `computeRevenueAtRisk(body)` → `/api/proxy/revenue-at-risk/compute` POST
- `getRevenueAtRiskSummary(workspaceId)` → `/api/proxy/revenue-at-risk/summary?workspaceId=` GET
- `getTopContributors(workspaceId)` → `/api/proxy/revenue-at-risk/top-contributors?workspaceId=` GET

Alerts:
- `listAlerts(workspaceId,status?)` → `/api/proxy/alerts?workspaceId=` GET
- `scanAlerts(body)` → `/api/proxy/alerts/scan` POST
- `updateAlert(id,body)` → `/api/proxy/alerts/{id}` PUT

Alert rules:
- `listAlertRules(workspaceId)` → `/api/proxy/alert-rules?workspaceId=` GET
- `createAlertRule(body)` → `/api/proxy/alert-rules` POST
- `updateAlertRule(id,body)` → `/api/proxy/alert-rules/{id}` PUT
- `deleteAlertRule(id)` → `/api/proxy/alert-rules/{id}` DELETE

Fatigue:
- `listFatigue(workspaceId)` → `/api/proxy/fatigue?workspaceId=` GET
- `computeFatigue(body)` → `/api/proxy/fatigue/compute` POST

Scorecards:
- `listScorecards(workspaceId)` → `/api/proxy/scorecards?workspaceId=` GET
- `getScorecard(id)` → `/api/proxy/scorecards/{id}` GET
- `generateScorecard(body)` → `/api/proxy/scorecards/generate` POST
- `exportScorecard(id)` → `/api/proxy/scorecards/{id}/export` GET

Benchmarks:
- `listBenchmarks()` → `/api/proxy/benchmarks` GET

Authentication:
- `listAuthChecks(workspaceId,senderId?)` → `/api/proxy/authentication?workspaceId=` GET
- `saveAuthCheck(body)` → `/api/proxy/authentication` POST

Reputation:
- `getReputation(workspaceId,senderId)` → `/api/proxy/reputation?workspaceId=&senderId=` GET
- `rebuildReputation(body)` → `/api/proxy/reputation/rebuild` POST

Reports:
- `listReports(workspaceId)` → `/api/proxy/reports?workspaceId=` GET
- `createReport(body)` → `/api/proxy/reports` POST
- `renderReport(id)` → `/api/proxy/reports/{id}/render` POST
- `deleteReport(id)` → `/api/proxy/reports/{id}` DELETE

Integrations:
- `listIntegrations(workspaceId)` → `/api/proxy/integrations?workspaceId=` GET
- `createIntegration(body)` → `/api/proxy/integrations` POST
- `pullIntegration(id)` → `/api/proxy/integrations/{id}/pull` POST
- `deleteIntegration(id)` → `/api/proxy/integrations/{id}` DELETE

Notifications:
- `listNotifications(workspaceId)` → `/api/proxy/notifications?workspaceId=` GET
- `markNotificationRead(id)` → `/api/proxy/notifications/{id}/read` PUT
- `markAllNotificationsRead(body)` → `/api/proxy/notifications/read-all` PUT

Activity:
- `listActivity(params)` → `/api/proxy/activity?workspaceId=...` GET

Billing:
- `getBillingPlan()` → `/api/proxy/billing/plan` GET
- `startCheckout()` → `/api/proxy/billing/checkout` POST
- `openPortal()` → `/api/proxy/billing/portal` POST

Total api methods: **80**. Every method maps to exactly one backend endpoint; the billing `webhook` endpoint has no api method (Stripe calls it directly).

---

## (d) Pages (URL → file under `web/` → kind → api methods used → renders)

Public:
1. `/` → `app/page.tsx` → public → (none) → static landing: hero, feature grid, Gmail/Yahoo enforcement angle, CTAs.
2. `/auth/sign-in` → `app/auth/sign-in/page.tsx` → public → (authClient) → sign-in form.
3. `/auth/sign-up` → `app/auth/sign-up/page.tsx` → public → (authClient) → sign-up form.
4. `/pricing` → `app/pricing/page.tsx` → public → getBillingPlan, startCheckout → plans + upgrade CTA.
5. `/benchmarks` → `app/benchmarks/page.tsx` → public → listBenchmarks → benchmark reference table.

Dashboard (auth-gated, wrapped by `app/dashboard/layout.tsx` → `DashboardLayout` sidebar):
6. `/dashboard` → `app/dashboard/page.tsx` → dashboard → listWorkspaces, createWorkspace, getRevenueAtRiskSummary, listPlacementScores, listAlerts, getListHealth, seedSample → overview: revenue-at-risk headline, placement score, open alerts, health grade, sample-seed CTA, workspace switcher/create.
7. `/dashboard/senders` → `app/dashboard/senders/page.tsx` → dashboard → listSenders, createSender, updateSender, deleteSender, getSender → sender list + create/edit.
8. `/dashboard/imports` → `app/dashboard/imports/page.tsx` → dashboard → listImports, deleteImport, seedSample → import jobs list + status + seed.
9. `/dashboard/imports/new` → `app/dashboard/imports/new/page.tsx` → dashboard → listSenders, createImport → upload + column-mapping wizard.
10. `/dashboard/campaigns` → `app/dashboard/campaigns/page.tsx` → dashboard → listCampaigns, listSenders → campaign rollup table.
11. `/dashboard/campaigns/[id]` → `app/dashboard/campaigns/[id]/page.tsx` → dashboard → getCampaign, getCampaignEvents → campaign drilldown + event list.
12. `/dashboard/events` → `app/dashboard/events/page.tsx` → dashboard → listEvents → event explorer with filters/pagination.
13. `/dashboard/recipients` → `app/dashboard/recipients/page.tsx` → dashboard → listRecipients, getRecipient → recipient list + profile drawer.
14. `/dashboard/placement` → `app/dashboard/placement/page.tsx` → dashboard → listSenders, listPlacementScores, computePlacement, getPlacementTrend → placement scores + components + trend.
15. `/dashboard/list-health` → `app/dashboard/list-health/page.tsx` → dashboard → listSenders, getListHealth, computeListHealth → list-health ledger + snapshot history.
16. `/dashboard/suppression` → `app/dashboard/suppression/page.tsx` → dashboard → listSuppression, computeSuppression, updateSuppression, exportSuppression → recommendations + accept/dismiss + export.
17. `/dashboard/cohorts` → `app/dashboard/cohorts/page.tsx` → dashboard → listSenders, listCohorts, computeCohorts → cohort table + recompute.
18. `/dashboard/sunset` → `app/dashboard/sunset/page.tsx` → dashboard → listSenders, listCohorts, listSunsetPlans, getSunsetPlan, previewSunset, createSunsetPlan, deleteSunsetPlan → sunset planner with revenue preview + saved plans.
19. `/dashboard/revenue-model` → `app/dashboard/revenue-model/page.tsx` → dashboard → listSenders, getRevenueModel, createRevenueModel, deriveRevenueModel → revenue assumptions config + versions.
20. `/dashboard/revenue-at-risk` → `app/dashboard/revenue-at-risk/page.tsx` → dashboard → getRevenueAtRiskSummary, listRevenueAtRisk, computeRevenueAtRisk, getTopContributors → at-risk breakdown by cause + trend + top contributors.
21. `/dashboard/alerts` → `app/dashboard/alerts/page.tsx` → dashboard → listAlerts, scanAlerts, updateAlert → alert feed + scan + ack/resolve.
22. `/dashboard/alert-rules` → `app/dashboard/alert-rules/page.tsx` → dashboard → listSenders, listSegments, listAlertRules, createAlertRule, updateAlertRule, deleteAlertRule → rule config.
23. `/dashboard/fatigue` → `app/dashboard/fatigue/page.tsx` → dashboard → listSenders, listSegments, listFatigue, computeFatigue → frequency/engagement curves + cadence recommendation.
24. `/dashboard/scorecards` → `app/dashboard/scorecards/page.tsx` → dashboard → listSenders, listScorecards, getScorecard, generateScorecard, exportScorecard → scorecards list + generate + export.
25. `/dashboard/authentication` → `app/dashboard/authentication/page.tsx` → dashboard → listSenders, listAuthChecks, saveAuthCheck → SPF/DKIM/DMARC posture checklist.
26. `/dashboard/reputation` → `app/dashboard/reputation/page.tsx` → dashboard → listSenders, getReputation, rebuildReputation → reputation timeline chart + annotations.
27. `/dashboard/reports` → `app/dashboard/reports/page.tsx` → dashboard → listReports, createReport, renderReport, deleteReport → saved reports + render + export.
28. `/dashboard/integrations` → `app/dashboard/integrations/page.tsx` → dashboard → listIntegrations, createIntegration, pullIntegration, deleteIntegration → ESP connectors + pull.
29. `/dashboard/notifications` → `app/dashboard/notifications/page.tsx` → dashboard → listNotifications, markNotificationRead, markAllNotificationsRead → notifications feed.
30. `/dashboard/activity` → `app/dashboard/activity/page.tsx` → dashboard → listActivity → activity log table.
31. `/dashboard/settings` → `app/dashboard/settings/page.tsx` → dashboard → getWorkspace, updateWorkspace, deleteWorkspace, listMembers, inviteMember, removeMember, getBillingPlan, startCheckout, openPortal → workspace settings, members, plan/billing.

Total pages: **31** (5 public + 26 dashboard). Plus route handlers `app/api/auth/[...path]/route.ts` and `app/api/proxy/[...path]/route.ts`.

Every api method is consumed by at least one page above; every backend endpoint (except billing webhook) backs exactly one api method.

---

## (e) DashboardLayout sidebar nav sections

`web/components/DashboardLayout.tsx` — `'use client'`, `<aside>` sidebar, active state via `usePathname()`, mobile drawer. Sections:

- **Overview**
  - Dashboard → `/dashboard`
- **Data**
  - Senders → `/dashboard/senders`
  - Imports → `/dashboard/imports`
  - Campaigns → `/dashboard/campaigns`
  - Events → `/dashboard/events`
  - Recipients → `/dashboard/recipients`
- **Deliverability**
  - Placement → `/dashboard/placement`
  - Reputation → `/dashboard/reputation`
  - Authentication → `/dashboard/authentication`
  - Fatigue → `/dashboard/fatigue`
- **List Health**
  - List Health → `/dashboard/list-health`
  - Suppression → `/dashboard/suppression`
  - Cohorts → `/dashboard/cohorts`
  - Sunset Planner → `/dashboard/sunset`
- **Revenue**
  - Revenue Model → `/dashboard/revenue-model`
  - Revenue at Risk → `/dashboard/revenue-at-risk`
  - Scorecards → `/dashboard/scorecards`
- **Monitoring**
  - Alerts → `/dashboard/alerts`
  - Alert Rules → `/dashboard/alert-rules`
  - Notifications → `/dashboard/notifications`
- **Workspace**
  - Reports → `/dashboard/reports`
  - Integrations → `/dashboard/integrations`
  - Activity → `/dashboard/activity`
  - Settings → `/dashboard/settings`

Top-level reference link (outside dashboard chrome but linked): Benchmarks → `/benchmarks`.
