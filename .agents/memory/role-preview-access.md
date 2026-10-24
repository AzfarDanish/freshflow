---
name: Role preview access scope
description: The public hackathon preview's fake Owner/Staff testing roles and their permission matrix.
---

The user explicitly selected a public hackathon preview without login or authentication. Owner and Staff are fake testing profiles that any visitor can select; the role matrix is for exercising UI and operations, not for protecting data. Do not reintroduce authentication unless the user changes this project scope.

**Why:** The user confirmed that the hackathon preview should open directly and permit public switching between Owner and Staff.

**How to apply:** Keep a clear public-access warning visible in the app and documentation. Anyone with the URL can read and modify persistent FreshFlow records as Owner, so do not present this build as secure for production or encourage storing sensitive data. Keep operational validation and data integrity safeguards, but do not describe profile checks as identity security.

The access matrix is definitive: Staff may view Overview, Inventory, Staff tasks, and Activity, and update task progress or complete tasks with outcomes. Only the Owner testing profile may modify/delete inventory, view or decide recommendations, use invoice intake/receiving, manage sales/waste and financial insights, or change settings. Both roles can update and complete staff tasks; do not reintroduce Staff-only completion or assignee-only restrictions.

**Why:** The user explicitly grants both testing profiles task progress and completion while reserving other operations for the Owner profile.

**How to apply:** Keep pages, navigation, read responses, and mutation behavior consistent with this test matrix while preserving the public-access disclosure.

Deleting inventory must not silently cancel open work. Block batch deletion while an open task references it; preserve historical decisions, completed reports, and activity when deletion is confirmed.

**Why:** Batch deletion was newly enabled to fulfill the Owner permission, so an integrity safeguard was chosen instead of deleting or fabricating task outcomes.

**How to apply:** Preserve this distinction between removing live inventory/pending risks and retaining historical workflow evidence.
