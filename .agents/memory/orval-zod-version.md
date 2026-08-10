---
name: Orval zod version pin
description: Why lib/api-spec/orval.config.ts pins override.zod.version to 3
---
Rule: keep `override.zod.version: 3` in the zod section of `lib/api-spec/orval.config.ts`.

**Why:** Orval 8's zod client auto-detects zod and can emit zod-4-only syntax like `zod.int()`, which fails typecheck because the workspace catalog `zod` is 3.x (top-level import is v3 API).

**How to apply:** If codegen typecheck fails with `Property 'int' does not exist on type 'typeof import(.../zod...)'`, restore the pin (or upgrade the whole catalog to zod 4 deliberately).
