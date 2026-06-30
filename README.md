# EmailDeliverabilityRevenueGuard

EmailDeliverabilityRevenueGuard is a deliverability and list-health analytics layer that quantifies the revenue lost when email lands in spam, hits dead addresses, or reaches subscribers who have gone dormant. It ingests send and engagement logs from any ESP (Klaviyo, Iterable, Braze, Mailchimp, Salesforce Marketing Cloud, HubSpot, and others) via CSV/JSON export or a built-in sample-data seeder, runs deterministic analyses over them, and produces a continuous revenue-at-risk view that ties bounces, spam-bound sends, and disengagement to dollars before sender reputation breaks.

The product owns no sending. It sits beside the marketer's ESP and acts as an independent audit, scoring, and early-warning system. Every analysis is reproducible and explainable: each score, alert, and dollar figure traces back to specific events and a documented formula. It turns the Gmail/Yahoo bulk-sender enforcement thresholds into a revenue-at-risk early-warning system.

For the full product specification, capabilities, and data model see [docs/idea.md](docs/idea.md).

## Stack

- **Backend:** Hono (Node, TypeScript, ESM) running on `@hono/node-server`, with Drizzle ORM over Neon Postgres (`@neondatabase/serverless`). Run directly via `tsx` (no compile step at runtime). REST API mounted under `/api/v1`, plus a top-level `/health`.
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4. Authentication via Neon Auth (`@neondatabase/auth`). The browser calls a same-origin `/api/proxy/...` route that resolves the session server-side and forwards an `X-User-Id` header the backend trusts.
- **Database:** Neon Postgres. Tables are provisioned out-of-band (Drizzle schema push / Neon console); the backend runs an idempotent seed on boot but does not create its own tables.
- **Package managers:** pnpm for Node/TypeScript.

## Project Layout

```
backend/   Hono API server (TypeScript, ESM)
web/       Next.js 16 frontend
docs/      idea.md (product spec), build-plan.md, audit.md
```

## Local Development

Prerequisites: Node 22+, pnpm, and a Neon Postgres connection string.

### Backend

```bash
cd backend
pnpm install
cp .env.example .env   # then fill in DATABASE_URL, FRONTEND_URL
pnpm dev               # node --import tsx/esm src/index.ts, serves on http://localhost:3001
```

### Frontend

```bash
cd web
pnpm install
cp .env.example .env.local   # then fill in the NEON_AUTH_* and NEXT_PUBLIC_API_URL values
pnpm dev                     # next dev, serves on http://localhost:3000
```

The frontend proxies API calls to the backend, so run both together during development.

### Docker

```bash
docker compose up --build
```

Brings up the backend on `:3001` and the web app on `:3000`.

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | no | HTTP port. Defaults to `3001` locally; Render injects `10000`. |
| `DATABASE_URL` | yes | Neon Postgres connection string (`?sslmode=require`). |
| `FRONTEND_URL` | yes | Allowed CORS origin for the web app (e.g. `http://localhost:3000`). |
| `ADMIN_USER_IDS` | no | Comma-separated user IDs granted admin access. |
| `STRIPE_SECRET_KEY` | no | Enables billing. When unset, billing endpoints return 503. |
| `STRIPE_PRO_PRICE_ID` | no | Stripe price ID for the pro plan. |
| `STRIPE_WEBHOOK_SECRET` | no | Stripe webhook signing secret. |

### Frontend (`web/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEON_AUTH_BASE_URL` | yes | Neon Auth endpoint base URL (server-only). |
| `NEON_AUTH_COOKIE_SECRET` | yes | Random 32-byte hex secret for session cookies (server-only). |
| `NEXT_PUBLIC_API_URL` | yes | Backend base URL, baked into the bundle and read by the proxy route. |

## Billing

All features are FREE for signed-in users. Stripe billing is wired but optional: when `STRIPE_SECRET_KEY` is unset, checkout/portal/webhook endpoints return `503` and `GET /api/v1/billing/plan` reports `stripeEnabled: false`, so the product is fully demoable without payment.

## Deployment

- **Backend:** Render (see `render.yaml`). Set `DATABASE_URL` and `FRONTEND_URL` as dashboard env vars (`sync: false`).
- **Frontend:** Vercel, with the project root set to `web/` and Node 22.x.
