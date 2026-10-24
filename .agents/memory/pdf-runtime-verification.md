---
name: PDF runtime verification
description: Why PDF extraction needs a live Next.js API check in addition to unit tests
---

Verify PDF extraction through the running Next.js upload route, not only through direct Node unit tests.

**Why:** Direct extraction tests passed while the same PDF failed through Next.js because server bundling changed worker-resource resolution. A successful build did not reveal the failure.

**How to apply:** After changing PDF dependencies or server bundling, upload a generated, non-sensitive text-layer PDF through the running API and confirm its extracted fields. Keep parser error responses generic and do not log invoice text.
