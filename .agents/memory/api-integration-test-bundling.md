---
name: API integration test bundling
description: Full Express app tests need native package resolution for logging workers and ESM dependencies.
---

Full-app integration tests cannot safely be bundled as standalone CommonJS files in /tmp. Use ESM with createRequire compatibility, keep pino and stripe-replit-sync external, and place the generated test bundle under the API package for dependency resolution.

**Why:** Bundled pino loses its worker location; stripe-replit-sync relies on import.meta.url. These failures occur before the test reaches application behavior and should not be mistaken for route regressions.

**How to apply:** For tests importing the full Express app, preserve external package resolution and the existing pdfkit/fontkit external requirements. Delete generated test bundles afterward.