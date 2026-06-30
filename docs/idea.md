# EmailDeliverabilityRevenueGuard

## Overview

EmailDeliverabilityRevenueGuard is a deliverability and list-health analytics layer that quantifies the revenue lost when email lands in spam, hits dead addresses, or reaches subscribers who have gone dormant. It ingests send and engagement logs from any ESP (via CSV/JSON export or a built-in sample-data seeder), runs deterministic analyses over them, and produces a continuous "revenue-at-risk" view that ties bounces, spam-bound sends, and disengagement to dollars before sender reputation breaks.

The product owns no sending. It sits beside the marketer's ESP (Klaviyo, Iterable, Braze, Mailchimp, Salesforce Marketing Cloud, HubSpot, etc.) and acts as an independent audit, scoring, and early-warning system. Every analysis is reproducible and explainable: each score, alert, and dollar figure traces back to specific events and a documented formula.

All features are FREE for signed-in users. Stripe billing is wired but optional (returns 503 when unconfigured) so the product is fully demoable without payment.

## Problem

Deliverability decay silently erases the highest-ROI marketing channel. By the time open and conversion rates visibly drop, sender reputation has already eroded, and reputation is brutally slow to rebuild. Marketers lack a single view that connects spam placement, bounces, and subscriber disengagement to the revenue at stake.

The Gmail/Yahoo bulk-sender enforcement (2024+) made this acute: senders must keep spam-complaint rates under 0.3%, authenticate with SPF/DKIM/DMARC, and honor one-click unsubscribe. Crossing the complaint threshold throttles or blocks delivery across the entire sending domain. Marketing-ops leads are accountable when rates drop but have no instrument that says "you are 0.07% from the Gmail throttle line, and the Black Friday segment is driving it, putting $84k of next-quarter email revenue at risk."

## Target Users

- Email/CRM marketing managers at mid-market DTC brands where email drives 20-40% of revenue.
- Marketing-ops leads at B2B brands running lifecycle and nurture programs.
- Retention/lifecycle marketers responsible for list hygiene and re-engagement.
- Agency deliverability consultants auditing client sender health.

Primary buyer: the email/CRM marketing manager or marketing-ops lead with marketing-tooling budget, accountable when open/conversion rates drop.

## Why this is NOT an existing project

Near-neighbors in the corpus and how this differs:

- **email-marketing-platform / email-infrastructure-platform**: these are senders. They compose, schedule, and transmit email and own the MTA/IP reputation. EmailDeliverabilityRevenueGuard sends nothing; it is a read-only analytics and audit layer over the logs a sender produces.
- **email-data-platform**: a generic email data warehouse/ETL play. This product is opinionated and narrow: it dollarizes deliverability decay and list rot, with a fixed revenue-at-risk model, not a general data store.
- **creative-fatigue-radar** (nearest sibling): analyzes ad-creative wear-out. Different object (ad creatives, not email sends) and different channel (paid media).
- **channel-saturation-curve** (nearest sibling): models diminishing returns of channel spend. It is a budget-allocation tool, not a deliverability/list-health auditor.
- **deliverability tools like GlockApps/Validity/250ok**: those are seed-list inbox-placement testers and reputation monitors. This product's distinct angle is the **revenue dollarization**: every deliverability metric is mapped to dollars-at-risk using the brand's own per-send revenue, plus a sunsetting planner and engagement-cohort revenue preview that those tools do not offer.

The unique wedge: a deliverability + list-health analytics/audit layer that dollarizes lost revenue, owns no sending, and turns Gmail/Yahoo enforcement thresholds into a revenue-at-risk early-warning system.

## Data Model (tables)

- `workspaces` — tenant container (a brand/account); owns all data.
- `workspace_members` — user-to-workspace membership with role.
- `senders` — a sending identity (from-domain / subdomain) tracked within a workspace.
- `imports` — an ingestion job (CSV/JSON upload or sample seed) with status and row counts.
- `send_events` — normalized per-message events (send, delivery, bounce, open, click, unsubscribe, complaint) keyed to a campaign and recipient.
- `campaigns` — a campaign/blast grouping of send_events with metadata.
- `segments` — named recipient segments referenced by campaigns and analyses.
- `recipients` — per-address recipient profile and rollup engagement state.
- `placement_scores` — inbox-placement proxy scores per sender/period.
- `list_health_snapshots` — periodic list-health ledger snapshots per sender.
- `suppression_recommendations` — recommended addresses/segments to suppress with reasons.
- `engagement_cohorts` — recency/frequency cohort definitions and membership counts.
- `sunset_plans` — engagement-cohort sunsetting plans with revenue-impact preview.
- `revenue_models` — per-workspace revenue assumptions (per-send value, conversion rate, AOV).
- `revenue_at_risk` — computed revenue-at-risk records tied to a cause and period.
- `alerts` — complaint/unsubscribe/bounce spike alerts with the triggering campaign/segment.
- `alert_rules` — user-configured thresholds for alerts.
- `fatigue_analyses` — send-frequency fatigue analyses per segment/cohort.
- `scorecards` — exportable deliverability scorecards (point-in-time bundles).
- `benchmarks` — industry/threshold benchmark reference values (Gmail/Yahoo lines, vertical norms).
- `authentication_checks` — SPF/DKIM/DMARC posture checks per sender.
- `reputation_timeline` — time series of reputation-proxy metrics per sender.
- `reports` — saved/exported report definitions and rendered output metadata.
- `integrations` — connected ESP integration configs (read-only export connectors).
- `notifications` — per-user in-app notifications.
- `activity_log` — per-workspace audit trail of user actions.
- `plans` — billing plans (free/pro).
- `subscriptions` — per-user subscription state for Stripe.

## API Surface (high level)

REST under `/api/v1`. Public reads where the data is non-sensitive reference (benchmarks); workspace-scoped reads and all writes require auth and ownership checks. Domains: workspaces, senders, imports, send-events, campaigns, segments, recipients, placement, list-health, suppression, cohorts, sunset, revenue-model, revenue-at-risk, alerts, alert-rules, fatigue, scorecards, benchmarks, authentication, reputation, reports, integrations, notifications, activity, billing.

## Major Features

### 1. Workspaces and Membership
- Create/rename/delete a workspace (brand/account tenant).
- Invite members by email, assign roles (owner/admin/analyst/viewer).
- Switch active workspace; list workspaces the user belongs to.
- Per-workspace settings: currency, fiscal calendar, default sender.
- Ownership enforced on every workspace-scoped record.

### 2. Sender Management
- Register sending identities (from-domain, subdomain, friendly name).
- Per-sender dashboards: volume, complaint rate, bounce rate, engagement.
- Mark a sender active/paused; archive stale senders.
- Sender-level revenue assumptions override workspace defaults.

### 3. Log Ingestion (CSV/JSON Export)
- Upload ESP exports (CSV or JSON) of sends/bounces/opens/clicks/unsubs/complaints.
- Column-mapping wizard: map arbitrary ESP columns to the normalized schema.
- Per-import validation, row-level error reporting, dedupe on message id.
- Import status tracking (pending/processing/complete/failed) and row counts.
- Re-runnable imports; idempotent on message id + event type.

### 4. Sample-Data Seeder (Demoability)
- One-click seed of a realistic workspace: senders, campaigns, 90 days of send_events with embedded decay and a complaint spike.
- Deterministic generation so demos are reproducible.
- Clearly flagged as sample data; can be wiped.

### 5. Normalized Event Store
- Canonical `send_events` model across all ESPs (send, delivery, bounce[hard/soft], open, click, unsubscribe, complaint).
- Per-event linkage to campaign, segment, recipient.
- Time-bucketed querying (day/week/campaign) for all downstream analyses.

### 6. Campaign Analytics
- Per-campaign rollups: sent, delivered, bounced, opened, clicked, unsubbed, complained.
- Delivery and engagement rates with deltas vs prior campaign.
- Drill into the events behind any campaign metric.

### 7. Inbox-Placement Proxy Scoring
- Engagement-decay analysis: open/click trend by recency cohort as an inbox-placement proxy.
- Complaint-rate analysis against Gmail/Yahoo thresholds.
- Composite placement score (0-100) per sender per period with component breakdown.
- Explainable: every score lists the inputs and the formula.
- Trend of placement score over time.

### 8. List-Health Ledger
- Bounce-trend tracking (hard/soft) per sender and segment.
- Role-account detection (info@, sales@, admin@, etc.).
- Dormant-subscriber detection by recency thresholds.
- Periodic list-health snapshots with deltas.
- Health grade (A-F) per list with drivers.

### 9. Suppression Recommendations
- Recommend addresses/segments to suppress (hard bounces, repeat complainers, long-dormant).
- Each recommendation carries a reason code and the revenue it protects/forfeits.
- Accept/dismiss recommendations; track accepted suppressions.
- Exportable suppression list.

### 10. Engagement Cohorts
- Recency/frequency cohorting (e.g., engaged-30d, lapsing-90d, dormant-180d+).
- Cohort membership counts and trend.
- Per-cohort engagement and revenue contribution.

### 11. Sunsetting Planner
- Build a sunset plan: which cohorts to retire on what schedule.
- Revenue-impact preview: revenue retained vs forfeited, complaint-risk reduced.
- Compare multiple sunset scenarios side by side.
- Save and export the chosen plan.

### 12. Revenue Model Configuration
- Per-workspace/sender revenue assumptions: revenue-per-delivered-send, conversion rate, AOV.
- Derive per-send value from historical attributed revenue or manual entry.
- Versioned revenue models so historical at-risk figures stay reproducible.

### 13. Revenue-at-Risk Model
- Tie bounced, spam-bound (proxy), and disengaged sends to dollars at risk.
- Decompose risk by cause (bounces / placement / disengagement) and by segment/campaign.
- Period-over-period at-risk trend.
- Top contributors leaderboard (which segments/campaigns drive the most risk).

### 14. Complaint and Unsubscribe Spike Alerts
- Detect complaint/unsubscribe/bounce spikes vs baseline.
- Each alert names the triggering campaign/segment and the metric breached.
- Severity levels mapped to proximity to Gmail/Yahoo thresholds.
- Alert feed with acknowledge/resolve.

### 15. Alert Rules
- User-configured thresholds (complaint %, unsub %, bounce %, placement-score drop).
- Per-sender or per-segment scoping.
- Enable/disable rules; default rules seeded from Gmail/Yahoo lines.

### 16. Send-Frequency Fatigue Analysis
- Frequency-vs-engagement curves per segment/cohort.
- Detect over-mailing (engagement declines as frequency rises).
- Recommended cadence per cohort with projected complaint reduction.

### 17. Deliverability Scorecard (Exportable)
- Point-in-time bundle: placement score, list health, complaint posture, revenue-at-risk.
- Letter grade plus the top three actions.
- Export as a shareable report (HTML/JSON payload).

### 18. Benchmarks and Thresholds
- Reference values: Gmail/Yahoo complaint line (0.3%), warning line (0.1%), vertical norms.
- Compare a sender's metrics to benchmarks.
- Public read access to benchmark reference data.

### 19. Authentication Posture (SPF/DKIM/DMARC)
- Record SPF/DKIM/DMARC posture per sender (pass/fail/missing, policy).
- Flag missing one-click-unsubscribe and weak DMARC policies.
- Posture checklist tied to Gmail/Yahoo requirements.

### 20. Reputation Timeline
- Time series of reputation-proxy metrics (complaint rate, bounce rate, engagement, placement score).
- Annotate timeline with imports, alerts, and sunset actions.
- Spot the inflection where reputation began to slip.

### 21. Reports and Exports
- Save report definitions; render to a downloadable payload.
- Scheduled-report metadata (cadence) stored for future runs.
- Export any analysis (CSV/JSON) for sharing.

### 22. Integrations (Read-Only Connectors)
- Register ESP export connectors (config only; read-only intent).
- Connection metadata and last-sync record.
- Manual "pull export" trigger that creates an import job.

### 23. Notifications
- In-app notifications for alerts, completed imports, generated scorecards.
- Mark read/unread; per-user feed.

### 24. Activity Log
- Per-workspace audit trail: who imported, who suppressed, who changed the revenue model.

### 25. Billing
- Free plan covers all features; Pro plan wired via Stripe (optional, 503 when unconfigured).
- View current plan; upgrade/portal via Stripe Checkout when enabled.

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing).
2. `/auth/sign-in` — sign in.
3. `/auth/sign-up` — sign up.
4. `/pricing` — plans (static + billing CTA).
5. `/benchmarks` — public benchmark reference.

Dashboard (auth-gated, sidebar chrome):
6. `/dashboard` — overview: revenue-at-risk headline, placement score, alerts, health grade.
7. `/dashboard/senders` — sender list and per-sender summary.
8. `/dashboard/imports` — import jobs list, upload, status.
9. `/dashboard/imports/new` — upload + column-mapping wizard.
10. `/dashboard/campaigns` — campaign analytics list.
11. `/dashboard/campaigns/[id]` — single-campaign drilldown.
12. `/dashboard/events` — normalized event explorer.
13. `/dashboard/placement` — inbox-placement proxy scores and trend.
14. `/dashboard/list-health` — list-health ledger and snapshots.
15. `/dashboard/suppression` — suppression recommendations.
16. `/dashboard/cohorts` — engagement cohorts.
17. `/dashboard/sunset` — sunsetting planner with revenue preview.
18. `/dashboard/revenue-model` — revenue assumptions config.
19. `/dashboard/revenue-at-risk` — revenue-at-risk breakdown and trend.
20. `/dashboard/alerts` — alert feed.
21. `/dashboard/alert-rules` — alert rule config.
22. `/dashboard/fatigue` — send-frequency fatigue analysis.
23. `/dashboard/scorecards` — scorecards list + generate + export.
24. `/dashboard/authentication` — SPF/DKIM/DMARC posture.
25. `/dashboard/reputation` — reputation timeline.
26. `/dashboard/reports` — saved reports and exports.
27. `/dashboard/integrations` — ESP connectors.
28. `/dashboard/notifications` — notifications feed.
29. `/dashboard/activity` — activity log.
30. `/dashboard/settings` — workspace settings, members, plan.
