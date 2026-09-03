# Railway deployment

This repository is prepared for a single Railway web service that builds the
React CRM and Express API together. Express serves the compiled SPA and keeps
all backend endpoints under `/api`.

Railway access was unavailable when this configuration was prepared, so no
Railway project, database, variables, custom domain, or DNS records have been
created yet.

## Service configuration

Connect the GitHub repository `Aegis26/aegis-horizon` and deploy the `main`
branch from the repository root. Railway reads `railway.json` automatically:

- Build: `pnpm install --frozen-lockfile && pnpm run build:railway`
- Start: `pnpm run start:railway`
- Health check: `/api/healthz`
- Runtime: Node.js 20 or newer

The service must expose Railway's injected `PORT`. Do not set a fixed production
port.

## Required variables

Configure secrets in Railway's Variables UI. Never commit their values.

```text
NODE_ENV=production
APP_URL=https://aegishz.com
DATABASE_URL=${{Postgres.DATABASE_URL}}
CLERK_PUBLISHABLE_KEY=<production Clerk publishable key>
CLERK_SECRET_KEY=<production Clerk secret key>
VITE_CLERK_PUBLISHABLE_KEY=<production Clerk publishable key>
SESSION_SECRET=<long random value>
RESEND_API_KEY=<Resend API key>
RESEND_FROM_EMAIL=<verified sender>
```

If AI functions are enabled outside Replit, also provide an Anthropic-compatible
API key and endpoint through:

```text
AI_INTEGRATIONS_ANTHROPIC_API_KEY=<key>
AI_INTEGRATIONS_ANTHROPIC_BASE_URL=<endpoint>
```

`WEBHOOK_ENCRYPTION_KEY` is optional. When omitted, the server derives a
domain-separated encryption key from `SESSION_SECRET`.

Do not configure `NEXTAUTH_*`, `NEXT_PUBLIC_*`, direct Stripe keys, or
Cloudflare R2 variables from the original deployment prompt. The application
does not consume them.

## PostgreSQL

Add a Railway PostgreSQL service and reference its `DATABASE_URL` from the web
service. Apply the schema once, after reviewing the target database:

```bash
pnpm run db:push
```

The repository has no production seed command. Demo data must not be inserted
into production implicitly.

## Clerk

In Clerk, add these production origins and redirect URLs:

- `https://aegishz.com`
- The temporary Railway-generated public domain used before DNS cutover

Use the same production publishable key for
`CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY`.

For a directly managed external Clerk instance, leave `CLERK_PROXY_URL` and
`VITE_CLERK_PROXY_URL` unset so the browser connects to that Clerk instance
directly. Replit-managed production auth uses those proxy variables when they
are provisioned by Replit.

## Replit-managed dependency blockers

The following capabilities are not portable merely by setting Railway
variables:

1. Replit App Storage is used for documents, signatures, exports, and
   attachments.
2. Replit Connectors provide Gmail, Outlook, Google Calendar, Slack, and the
   current billing integration.
3. Replit AI Integrations provides the current Anthropic proxy.

Do not describe the Railway deployment as fully production-ready until these
services are replaced with provider-owned production integrations or confirmed
to work from Railway. Core PostgreSQL-backed CRM and Clerk authentication can be
deployed independently, but affected features must be disabled or migrated
before serving users.

## Domain and DNS

After a healthy Railway deployment:

1. Add `aegishz.com` as the custom domain in the Railway service.
2. Copy Railway's exact DNS target.
3. Add the record at the domain registrar.
4. Wait for Railway to verify the domain and issue TLS.
5. Set `APP_URL=https://aegishz.com` and redeploy.

Do not guess the CNAME or A-record target; use the value Railway generates for
this service.

## Acceptance checks

```bash
curl --fail --show-error https://<railway-domain>/api/healthz
```

Expected body:

```json
{"status":"ok"}
```

Before DNS cutover, also verify:

- The SPA loads on `/` and client-side routes survive refresh.
- Clerk sign-in works on the Railway domain.
- An organization and lead can be created and reloaded.
- No startup, database, or browser-console errors appear.
- Storage and connector-dependent controls are unavailable or backed by their
  migrated production services.