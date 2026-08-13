---
name: api-server esbuild externals
description: pdfkit/fontkit must stay external in the api-server bundle
---

Rule: `pdfkit` and `fontkit` must be listed in the esbuild `external` array of the api-server build script; never let them be bundled.

**Why:** Bundling fontkit pulls in `@swc/helpers`/brotli internals that esbuild cannot resolve, breaking the build (discovered Aug 2026 when adding quote PDF generation).

**How to apply:** Any time the api-server build config is rewritten or new PDF/font libraries are added, keep these packages external. A handy debug pattern: bundle a one-off script with esbuild (`packages` resolved, these externals kept) to run server services directly against the DB.
