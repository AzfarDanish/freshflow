---
name: Role preview access scope
description: The definitive Owner/Staff permissions, preview-only identity boundary, and safe deletion constraint.
---

Keep the Owner/Staff switcher explicitly a testing/preview control, never production sign-in or identity verification. Production access must derive from verified identity and business membership; preview choices may narrow real privileges but must never elevate a Staff member or unauthenticated visitor.

**Why:** The production-transition brief explicitly requires retaining the testing switcher while preventing exposure of real business data through insecure role selection.

**How to apply:** Keep truthful preview disclosures visible to both roles and enforce business-scoped permissions server-side independently of request payloads. Missing or invalid authenticated sessions must fail closed, not receive business data merely through a preview cookie; do not claim production readiness before real authentication and authorization are verified.

The access matrix is definitive: Staff may view Overview, Inventory, Staff tasks, and Activity, and update task progress or complete tasks with outcomes. Only Owners may modify/delete inventory, view or decide recommendations, use invoice intake, change settings, or reset the demo. Both roles can update and complete staff tasks; do not reintroduce Staff-only completion or assignee-only restrictions.

**Why:** The user explicitly grants both roles task progress and completion while denying Staff the other operations.

**How to apply:** Keep pages, navigation, read responses, mutation routes, and underlying service checks consistent with the matrix.

Deleting inventory must not silently cancel open work. Block batch deletion while an open task references it; preserve historical decisions, completed reports, and activity when deletion is confirmed.

**Why:** Batch deletion was newly enabled to fulfill the Owner permission, so an integrity safeguard was chosen instead of deleting or fabricating task outcomes.

**How to apply:** Preserve this distinction between removing live inventory/pending risks and retaining historical workflow evidence.
