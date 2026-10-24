---
name: Direct browser verification
description: Avoid stalled hydration when checking the preview through a manually controlled Chromium CDP session.
---

When using Chromium directly through CDP, create the browser target at the requested preview URL and activate it before waiting for hydration.

**Why:** Checks that created an about:blank target and navigated it while inactive stayed on the server-rendered loading state, although the app worked in the normal preview. Creating the target at the preview URL and activating it allowed the route, state-preservation, dialog, and overflow checks to pass.

**How to apply:** Use Target.createTarget with the preview URL, then Target.activateTarget, then attach the CDP session. Do not diagnose a permanently loading app solely from an inactive test target.
