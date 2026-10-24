---
name: Next.js Replit preview origins
description: Next.js development assets on Replit need the proxied workspace hostname allowed as a dev origin.
---

Next.js's development server must allow the active Replit preview hostname in `allowedDevOrigins`, alongside localhost and 127.0.0.1.

**Why:** Replit serves the preview through a proxied `.replit.dev` hostname while the Next.js development server binds to port 5000. Without the preview hostname, Next.js blocks dev resources and HMR, and the client can remain stuck before loading server state.

**How to apply:** In `next.config.ts`, add the hostname from `REPLIT_DEV_DOMAIN` without a scheme or port. After changing this setting, restart the web workflow and confirm the HMR connection and API requests in the preview.
