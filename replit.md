# Meridian CRM

Multi-tenant, feature-customizable CRM SaaS. Built from a phased spec (`attached_assets/Pasted-World-Class-CRM-Phased-Agent-Prompts...txt`). **Phase 1 (Foundation & Authentication) is complete.**

## Architecture
- pnpm monorepo. Web app: `artifacts/crm` (React + Vite + wouter + shadcn, previewPath `/`). API: `artifacts/api-server` (Express 5).
- API contract: `lib/api-spec/openapi.yaml` → orval codegen (`pnpm --filter @workspace/api-spec run codegen`) → `@workspace/api-client-react` hooks + `@workspace/api-zod` validators. Note: `orval.config.ts` pins `override.zod.version: 3` (workspace zod is 3.x; orval otherwise emits zod-4 syntax).
- DB: Drizzle + Postgres, schema in `lib/db/src/schema/` (organizations, users, orgUsers, CRM tables, featureEntitlements, usageLogs, plus Phase 2-6 stub tables). Push: `pnpm --filter @workspace/db run push`.
- Auth: Replit-managed Clerk (`@clerk/express` server, `@clerk/react` client, proxy middleware in `src/middlewares/clerkProxyMiddleware.ts`). Users + a default org (Professional plan) are provisioned just-in-time in `attachUser` on first authenticated request, with demo CRM data seeded.
- Authorization: `attachUser` → `attachOrg` (membership check on `:orgId`) → `requireRole` / `requireFeature` in `artifacts/api-server/src/middlewares/auth.ts`. Feature-gated endpoints return 403 + `featureKey` when the org lacks the feature.
- Billing: plan/feature catalog in `artifacts/api-server/src/lib/catalog.ts` (3 tiers + 12 à-la-carte features, 20% annual discount). Stripe via Replit connector (`src/lib/stripeClient.ts`); checkout returns 503 until the Stripe integration is connected. Admins can also apply feature sets directly (dev path) via `PUT /orgs/:orgId/features`.

## Phase status
- Phase 1 done: auth, orgs/roles (owner/admin/manager/user/viewer), entitlement gates, billing catalog + checkout endpoint, app shell (dashboard, accounts, opportunities, automation, billing feature selector, settings).
- Stripe checkout requires connecting the Stripe integration; webhook sync (stripe-replit-sync) not yet wired to update subscriptions → entitlements.
- Phases 2-6 (full CRM modules, AI, analytics, etc.) not started; stub tables exist.

## User preferences
(none recorded yet)
