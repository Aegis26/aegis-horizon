---
name: Workspace connector binding
description: Security constraints for using Replit workspace connectors inside the multi-tenant CRM
---

Rule: Treat Replit connector access in application code as deployment-global, not scoped to the current Clerk user or CRM organization. A provider must be globally bound to one CRM org only after its live account email exactly matches the signed-in, verified org admin; persist the provider account identity and revalidate it immediately before every proxy request.

**Why:** Connector proxy calls select by connector name under deployment identity. Without explicit provider-identity binding, any tenant admin could ingest another person's mailbox/calendar or send through another Slack workspace. Runtime revalidation also fails closed if the deployment connection changes later.

**How to apply:** Keep business proxy calls behind the checked connector helper. Only the identity-probe helper may call the raw proxy. Never add a caller-controlled bypass or reuse a past identity check across multiple requests. Provider unbinding revokes CRM use but does not revoke provider OAuth.

Runtime quirk: `ReplitConnectors.listConnections()` can return 401 from the API runtime even when connector proxy calls work. Provider status should use the supported-provider registry and DB bindings; binding availability is proven by the live identity probe.