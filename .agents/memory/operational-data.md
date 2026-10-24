---
name: Stateful demo data boundaries
description: Demo records are real working state; initialization, reset scope, and non-demo protection requirements.
---

Treat demo records as operational data, not disposable presentation fixtures. Normal navigation and reads must not recreate missing records, seed existing datasets, or manufacture activity. Recalculate derived risk records only in response to relevant stored mutations.

**Why:** The user explicitly requires naturally stateful operations, durable changes across refreshes, truthful outcomes, and no individual-record regeneration during ordinary use.

**How to apply:** Use persisted state for all pages and actual actions for success feedback. Keep decision/audit history distinct from live pending recommendations and open work. A completed staff report is not an inferred inventory adjustment.

Reset is an intentional, confirmed, atomic whole-demo restoration of inventory, settings, recommendations/decisions, tasks, and initial activity, with an actual reset audit event. Refuse the whole reset if non-demo records are present; never partially reset around protected records or affect unrelated workspaces.

**Why:** The user requires a complete demo reset while explicitly protecting non-demo data and existing business rules. Uploaded invoices are non-synthetic records under the existing provenance rule.

**How to apply:** Preserve server-side confirmation and provenance checks even if the interface already disables reset. Test destructive operations against isolated test data, never the user's current dataset.
