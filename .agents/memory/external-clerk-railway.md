---
name: External Clerk on Railway
description: Authentication deployment constraints for the Railway-hosted production app.
---

Railway production uses an external Clerk instance. Pass its configured publishable key directly to both client and server SDKs; do not use Replit's host-derived publishable-key helper for this deployment.

**Why:** Replit-managed live-key injection and proxy setup only occur when publishing through Replit. On Railway, host-derived resolution redirected Clerk JS to an unavailable host and left the app on its loading background.

**How to apply:** Keep separate matching Development and Production key pairs. The live key's Clerk custom domain must have all Clerk-provided DNS records verified before authentication can initialize.