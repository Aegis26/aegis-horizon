# Aegis Horizon

**See Beyond the Horizon**

Aegis Horizon is a dark-mode, multi-tenant enterprise CRM for sales execution,
customer intelligence, communications, AI-assisted workflows, analytics, and
governance.

## Capabilities

- Account, contact, lead, opportunity, quote, pipeline, and territory management
- Lead scoring, routing, qualification, conversion, and revenue forecasting
- Gmail, Outlook, Google Calendar, and Slack integrations
- Unified account timelines, internal notes, and communication intelligence
- AI Copilot, predictions, workflow automation, agents, and organization budgets
- Custom reports with CSV, PDF, and spreadsheet exports
- Installable PWA with durable offline lead creation and exactly-once replay
- Private document storage, immutable versions, and native electronic signatures
- Hashed API tokens, atomic batch APIs, signed outbound webhooks, and audit logs
- Clerk-managed MFA and enterprise SSO status, role-based access, and IP allowlists
- K-12, Construction, and Healthcare workspace templates

Automated call recording and transcription are intentionally not included.
Calls remain manually logged CRM activities.

## Architecture

This repository is a pnpm workspace:

```text
artifacts/
  api-server/        Express 5 API and background workers
  crm/               React + Vite CRM application
lib/
  api-spec/          OpenAPI source of truth and code generation
  api-client-react/  Generated React Query client
  api-zod/           Generated request/response validators
  db/                PostgreSQL schema and Drizzle configuration
  object-storage-web/
scripts/             Workspace maintenance scripts
```

### Core stack

- React, TypeScript, Vite, Tailwind CSS, TanStack Query, and Recharts
- Express, PostgreSQL, Drizzle ORM, Zod, and OpenAPI/Orval
- Clerk authentication
- Replit App Storage for private files
- Replit Connectors for Gmail, Outlook, Google Calendar, and Slack
- Anthropic through Replit AI Integrations
- Resend email delivery

## Local development

### Prerequisites

- Node.js 20 or newer
- pnpm
- PostgreSQL

### Setup

```bash
git clone https://github.com/Aegis26/aegis-horizon.git
cd aegis-horizon
pnpm install
cp .env.example .env
```

Fill in the required values in `.env`, then initialize the development schema:

```bash
pnpm --filter @workspace/db run push
```

Start the API and CRM in separate terminals:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/crm run dev
```

The services bind to their configured `PORT` values. On Replit, managed artifact
workflows provide ports, base paths, and proxy routing automatically.

## Validation and builds

```bash
# Typecheck the full workspace
pnpm run typecheck

# Build all packages that provide a build script
pnpm run build

# Regenerate API clients after changing lib/api-spec/openapi.yaml
pnpm --filter @workspace/api-spec run codegen
```

The API production command is:

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

The CRM production build is:

```bash
pnpm --filter @workspace/crm run build
```

## Environment

Use `.env.example` as the variable inventory. Never commit `.env` files,
credentials, API tokens, signing secrets, or private keys.

Replit supplies database, App Storage, artifact-routing, and connector runtime
variables to managed workflows. A deployment outside Replit must provide
equivalent PostgreSQL and object-storage services and replace or configure the
Replit Connector runtime used by communication integrations.

## Security

- All CRM data access is organization-scoped.
- API tokens and public signing tokens are stored as hashes.
- Private document and report objects are organization-bound.
- Webhook payloads use HMAC-SHA256 signatures and SSRF-resistant delivery.
- Audit events are append-only.
- Sensitive API responses are excluded from service-worker caches.

GitHub secret scanning and push protection should remain enabled for this
repository.

## Deployment

The current implementation is optimized for Replit managed services. Railway can
run the Node API and host the built CRM, but migration requires:

1. A Railway PostgreSQL database and schema initialization.
2. Production Clerk keys and allowed origins.
3. A persistent private object-storage replacement or compatible configuration.
4. Replacement/configuration of Replit Connectors for email, calendar, and Slack.
5. Production Resend sender verification and secrets.
6. Separate API and static-web service routing under the public application URL.

Do not mark a Railway deployment production-ready until those service
dependencies and a signed-in acceptance pass are complete.

## License

Proprietary. All rights reserved.