> [!IMPORTANT]
> ## 📁 Submission Documents & Templates
> **All required submission templates are in the Google Drive folder below. Download them before you start.**
>
> ### 👉 [**OPEN THE GOOGLE DRIVE FOLDER**](https://drive.google.com/drive/folders/1xw7c2aN8N-at8hPEULzkcU76e_FFb0Ef) 👈

---

# FreshFlow

## Current operational implementation

The runtime is a public hackathon preview with a persisted FreshFlow workspace, an auditable stock-movement ledger, Manager-profile-confirmed invoice receiving, searchable operations workflows, and a Manager/Staff testing switcher.

See the [hackathon preview guide](docs/production-transition.md) for public-access risks, the testing permission matrix, persisted-data behavior, and validation steps. The Manager/Staff switcher is not authentication; anyone with the link can choose Manager and access the shared records. Do not store sensitive information in this preview. Historical prototype and submission material below is retained for reference; it does not override the current runtime guide. The `submission/` directory is unchanged.

> FreshFlow helps Malaysian micro and small grocers turn expiry-risk alerts and supplier invoice lines into reviewed, assigned, and reported inventory actions.

---

## Team Information

| Field                  | Details                                     |
| ---------------------- | ------------------------------------------- |
| **Team Name**          | Deepbit                                     |
| **Team Domain**        | Domain 2                                    |
| **SDG Track (1–17)**   | SDG 12 — Responsible Consumption and Production |
| **Team Leader**        | Azfar Danish                                |
| **University**         | Kolej Profesional MARA Beranang             |
| **Number of Members**  | 5                                           |

## Links

| Resource          | Link                                           |
| ----------------- | ---------------------------------------------- |
| GitHub Repository | https://github.com/AzfarDanish/freshflow       |
| Replit Project    | https://replit.com/t/deepbit/repls/freshflow   |
| Live Demo         | https://freshflow-azfardns.replit.app          |
| RunPod Endpoint   | none                                           |
| Slide Deck        | https://drive.google.com/file/d/1V3tjdfGCCLq2Pc7-lNDkce94SF8ogXuu/view?usp=sharing |
| Demo Video        | https://youtu.be/gsSjp_diX9k                   |

---

## Overview

### Problem

Micro and small grocery businesses often manage inventory using spreadsheets, paper records, and manual stock checks. Monitoring product expiry dates becomes difficult when items arrive in multiple batches, each with different quantities and shelf lives. When expiry risks are missed or follow-ups are delayed, grocers lose stock value and face avoidable food waste (estimated at 31.9–97.3 kg per capita annually in Malaysia, with expired food cited as a leading cause). The core operational bottleneck is not merely tracking stock, but ensuring that inventory exceptions reliably lead to timely, accountable staff action.

### Solution

FreshFlow is an inventory exception-to-action system that connects the complete operational journey: **Detect → Recommend → Approve → Act → Record**. Deterministic business rules monitor batch quantities and expiry windows to detect impending risks and generate explainable recommendations. Managers approve actions (with optional custom directives), automatically creating assigned staff tasks with clear accountability. The MVP pairs deterministic inventory rules with a grounded, read-only AI Assistant (OpenRouter DeepSeek) for natural-language queries without risk of automated or unverified stock mutations, directly advancing **UN SDG 12 (Target 12.3: Halve food waste)**.

### Key Features

- **Detect (Expiry visibility)** — Show expired stock separately from batches within a configurable expiry window based on deterministic calculations.
- **Recommend (Explainable suggestions)** — Present clear, transparent action recommendations (discount, relocate, bundle, markdown) without fabricating unavailable metrics.
- **Approve (Human-in-the-loop control)** — Explain recommendation context and let the manager approve with custom instructions or reject.
- **Act (Accountable staff tasks)** — Automatically assign work upon approval, track progress (Not started, In progress, Blocked), and capture structured staff-reported outcomes.
- **Record (Activity ledger & Waste Insights)** — Log all inventory events chronologically; track waste quantities and verified costs via an interactive SVG trends chart with dynamic intervals and real-time synchronization.
- **Supplier invoice intake & receiving** — Collapsible upload drawer for PDF, CSV, PNG, or JPEG; realistic prototype extractions with transparent sample disclosures; safe cancellation with permanent PostgreSQL file cleanup; catalog matching, partial deliveries, and discrepancy notes.
- **Operations search & filtering** — Real-time search and status filters across Decisions, Staff Tasks, Inventory, and Waste Insights movement history.
- **Grounded AI assistant** — Conversational inventory queries powered by OpenRouter DeepSeek (`deepseek/deepseek-v4-flash-0731`) grounded strictly in verified database records.

### Interface

Each operation has its own Next.js route: Overview (`/`, summary and expiry watchlist), Decisions (`/decisions`), Staff tasks (`/tasks`), Activity (`/activity`), Invoice intake (`/invoices`), Inventory (`/inventory`, with dedicated Record Waste and Correct Stock action buttons), Waste Insights (`/insights`), and Settings & data (`/settings`). Manual sales tracking was removed to refocus strictly on inventory exceptions, expiry risk, waste tracking, and physical delivery receipts. Navigation replaces the page content, with browser back/forward and direct links supported. The charcoal sidebar and workspace header remain mounted, preserving loaded data, the Manager/Staff view, inventory filters, and unsaved invoice edits during navigation. Only the selected operation scrolls; the sidebar and header stay visible. On narrow screens the sidebar becomes a horizontal bar and tables stack into labelled rows.

FreshFlow Demo Shop is the sole available workspace. There is no shop selector or displayed shop name. Kedai Runcit Demo is no longer available through the application; its stored records are not deleted. Settings & data contains the expiry threshold, role-preview disclosure, and a separately confirmed whole-demo reset.

### Operational data and reset

- Supabase-hosted PostgreSQL is the source of truth. Existing stored datasets are read without regenerating recommendations, activity, or inventory. Seed data is created only for an uninitialized workspace or an explicitly confirmed reset.
- Successful actions persist their records and actual activity together in a transaction. Validation failures do not write changes. Pending risk recommendations are recalculated from stored inventory and settings during relevant mutations; open work reflects updated stock details, while completed outcomes and audit descriptions preserve history. Reporting a staff task never invents a stock adjustment.
- The shared workspace state updates from each successful server response. Navigation, window focus, cross-tab notifications, and a 15-second visible-page refresh keep pages synchronized. A read started before a mutation cannot overwrite its result; unsaved settings and invoice drafts are retained during background reads.
- Reset is available only in Settings & data. It requires a warning, acknowledgement, and server-side `payload: { confirmed: true }`. It atomically restores initial inventory, settings, pending recommendations, decisions, tasks, invoice-intake state, and initial activity history; a real reset audit entry records the operation. It is scoped to the demo workspace.
- To protect non-demo data, reset refuses the entire operation when any non-synthetic record or uploaded invoice exists. It does not delete these records, partially reset around them, or modify unrelated workspaces.

### Owner and Staff preview permissions

The testing preview uses a signed, HTTP-only role cookie; the server validates permissions independently of request-body role values. Staff can view Overview, Inventory, Staff tasks, and Activity, update open tasks to Not started / In progress / Blocked with notes, and record completion outcomes. Managers can do the same and also access Decisions, Invoice intake, and Settings & data, edit/add/delete inventory batches, make recommendation decisions with custom instructions, change settings, and reset the demo. Inventory deletion requires confirmation, removes related pending risks, preserves completed history, and is blocked while the batch has an open task. Invoice upload and file-download routes are manager-only.

New or invalid preview sessions use Staff permissions. The public preview switcher intentionally allows a viewer to select either role (displayed as Manager or Staff). It is a demonstration permission layer—not sign-in, an identity check, or production-grade authentication—and must not be used to protect sensitive or real customer data.

### Tech Stack

| Layer         | Technology                   |
| ------------- | ---------------------------- |
| Frontend      | Next.js App Router, React, TypeScript |
| Backend       | Next.js route handlers |
| Database      | Supabase-hosted PostgreSQL (`DATABASE_URL`) with Drizzle ORM and least-privilege RLS policies (`freshflow_app`); JSON files are test-only |
| AI / Compute  | OpenRouter DeepSeek (`deepseek/deepseek-v4-flash-0731`) grounded assistant; no RunPod dependency |
| Hosting / Dev | Replit |

---

## Project Structure

```
.
├── app/                     # Next.js operations UI and API routes
├── src/lib/                 # Business registry, expiry, invoice extraction, database and types
├── drizzle.config.ts        # PostgreSQL schema configuration
├── scripts/
│   ├── ensure-rls-policies.ts       # Enforces least-privilege RLS policies for freshflow_app
│   ├── import-existing-state.ts     # Non-destructive local JSON import utility
│   └── migrate-postgres-to-supabase.ts # One-time non-destructive PostgreSQL → Supabase copy
├── docs/                    # Screenshots, diagrams
├── runpod/
│   └── handler.py           # Preserved Python starter; not used by FreshFlow
├── src/
│   ├── main.py              # Preserved Python starter entry point
│   └── utils.py             # Preserved Python starter helpers
├── submission/              # Official submission materials
│   ├── 1. SDC Hackathon_ Submission Template.docx # Preliminary Project Proposal (.docx)
│   ├── 2. SDC Hackathon_ Technical Tools Declaration Template.docx # Technical & Tools Declaration (.docx)
│   ├── SDC2026_TeamName_Preliminary.pdf      # Preliminary submission PDF
│   ├── SDC2026_TeamName_TechDeclaration.pdf  # Technology declaration PDF
│   ├── SDC2026_TeamName_Replit_POU.pdf       # Replit proof of use
│   └── SDC2026_TeamName_Runpod_POU.pdf       # RunPod proof of use
├── tests/
│   └── test_utils.py        # Unit tests
├── .env.example             # Example environment variables
├── .gitignore
├── .replit                  # Replit run configuration
├── LICENSE
├── requirements.txt         # Preserved Python starter dependencies
├── package.json             # Next.js scripts and dependencies
└── README.md
```

### Architecture

```
Manager / Staff (Web Browser)
             │
             ▼
Next.js App Router (UI & API Routes)
             │
             ├──► Permission & Access Control (Signed Preview Cookies)
             ├──► Deterministic Rules Engine (Expiry Risk Detection & Actions)
             │
             ├──► Supabase PostgreSQL Database
             │     ├── relational tables (products, batches, recommendations, tasks, activity)
             │     ├── operational state, suppliers & movements ledger
             │     └── private invoice documents (bytea)
             │
             └──► OpenRouter API (DeepSeek V4 Flash)
                   User Query ──► Local Context Retrieval ──► Grounded Read-Only Response
```

---

## How to Run

### Option 1 — Run on Replit (Recommended)

1. Import this repository into Replit and add the server-side Secrets: `DATABASE_URL` (the Supabase PostgreSQL connection string), `SESSION_SECRET`, and `OPENROUTER_API_KEY`.
2. Run `npm run db:push` once to confirm the schema matches the Supabase project.
3. Click **Run**. The `.replit` run command starts the Next.js development server on port 5000.
4. After code merges, the configured post-merge setup installs packages and pushes the schema to the connected database. Replit's Publish flow compares development and production schemas and applies production schema changes when you publish.

### Option 2 — Run Locally

```bash
# 1. Clone the repository
git clone https://github.com/AzfarDanish/freshflow.git
cd your-project

# 2. Install Node.js and dependencies
npm ci

# 3. Create your local environment file, then edit DATABASE_URL and SESSION_SECRET
cp .env.example .env.local
# DATABASE_URL: your Supabase-hosted PostgreSQL connection string (session pooler URI).
# Note: node-pg treats sslmode=require as strict verify-full and rejects Supabase's
# private cert chain; use the session pooler URI with sslmode=no-verify instead.
# SESSION_SECRET: generate a development-only value with: openssl rand -hex 32
# OPENROUTER_API_KEY: your OpenRouter key for conversational assistant queries

# 4. Confirm the schema and run FreshFlow
npm run db:push
npm run dev
```

Open `http://localhost:5000`.

### Database — Supabase-hosted PostgreSQL

FreshFlow uses one database in every environment: the Supabase-hosted PostgreSQL project. The data layer stays on `pg` + Drizzle; no Supabase client SDK or REST Data API is used.

- The runtime schema was applied to the project through the MCP migration `create_freshflow_runtime_tables` (24 October 2026). It matches `src/lib/db/schema.ts`: `freshflow_business_state`, `freshflow_invoice_documents`, `freshflow_memberships`, and `freshflow_state_backups`. Row level security is enabled and forced, and every table carries one permissive policy targeting only the app's least-privilege `freshflow_app` role, so the anon/authenticated Data API surface stays denied by default; the app connects over direct PostgreSQL server connections.
- Hosted runs read the connection string from Replit Secrets (`DATABASE_URL`); local development sets the same variable in `.env.local`. Never commit or expose it.
- `npm run db:push` syncs schema changes; `npm run db:ensure-rls` verifies and reapplies the least-privilege RLS policies (`USING (true) WITH CHECK (true)`) for the `freshflow_app` role across all tables.

To carry over data from the previous PostgreSQL database (for example the former Replit-managed instance), set that connection string as `SOURCE_DATABASE_URL` and copy with the non-destructive migration tool:

```bash
SOURCE_DATABASE_URL=<previous-database-url> npm run db:migrate:supabase
```

The tool inserts only missing rows (`on conflict ... do nothing`), preserves stored timestamps and invoice file bytes, and never overwrites or deletes destination rows. The copy destination is `DATABASE_URL` (or an explicit `SUPABASE_DATABASE_URL`). Rerun it safely any time; for a fully consistent move, rerun during a quiet window with the app idle so the last writes are captured.

### Persistence and database setup

- **PostgreSQL is the runtime store.** The app requires `DATABASE_URL` — the Supabase-hosted PostgreSQL connection string — from Replit Secrets (hosted runs) or the local `.env.local`. The app does not silently fall back to local files. Keep local credentials out of version control and never expose the URL to client code.
- `SESSION_SECRET` is required to sign and verify preview-role cookies. For local development, use a development-only random value. In Replit and production, keep it in server-side Secrets; changing it invalidates existing role previews, which fall back to Staff.
- The read-only assistant uses `OPENROUTER_API_KEY` from Replit Secrets with the fixed OpenRouter model `deepseek/deepseek-v4-flash-0731` (DeepSeek V4 Flash 0731, not V4.1 Flash). Each question reads the current persisted business state; the model classifies the query and synthesizes a natural, factual response strictly based on verified records. Assistant requests fail visibly if OpenRouter is unavailable.
- `src/lib/db/schema.ts` is the schema source. `npm run db:push` applies it to the development database; startup and production builds do not run DDL. The post-merge setup applies it to the development database. Replit's Publish flow applies the development-to-production schema diff when you publish.
- Each shop has an independent state dataset. Invoice originals are stored in a private `bytea` table in the same database, scoped to the shop, and limited to 5 MB per upload. Downloads are served through a business-scoped, no-store API route, not a public object URL.
- Invoice intake supports drag-and-drop file upload in a collapsible drawer for PDF, UTF-8 CSV, PNG, and JPEG. Sample prototype extractions provide realistic Malaysian grocer items. Managers can link lines to catalog products or add new products, cancel unconfirmed intakes with permanent file deletion, record delivery discrepancy notes, and receive partial quantities; only confirmed physical receipts change inventory.
- The Manager/Staff role preview enforces the demo permission matrix in the interface and server routes, but anyone can switch preview roles; it is not authentication. Do not expose this demo API to public sensitive data.
- For existing state, run the import before the first app request creates seed rows: `npm run db:import:local` imports known `.data/<business-id>.json` files into `DATABASE_URL`. It inserts only missing business rows and never overwrites destination data. The retired Supabase REST import (`db:import:supabase`, `LEGACY_SUPABASE_*` variables) was removed when FreshFlow moved fully to Supabase-hosted PostgreSQL; use `db:migrate:supabase` to copy rows between PostgreSQL databases.

### Tests and build

```bash
npm test
npm run build
npm run db:push
python -m unittest discover tests
```

### Publishing

Publishing uses `npm run build` followed by `npm run start` on port 5000. The development preview continues to use `npm run dev`; do not use that development server as the publishing run command. Configuration changes take effect on the next publish.

### Scope and limitations

Seed inventory and simulated workflow actions are synthetic. Uploaded invoice files and batches created from manager-confirmed lines are persisted as non-synthetic records. The demo date is fixed at 24 October 2026. The Manager/Staff switcher previews server-enforced demo permissions but is not identity verification or authentication; the public API is not suitable for production or sensitive data. Completing a task records a report and never changes inventory quantities. No POS, sales forecasts, automatic discounts, disposal actions, or waste-reduction claims are included.

---

## How We Use Replit *(Required)*

Use this section for accurate team evidence. The app is configured to run through Replit's web preview; no hosting or deployment claim is made here.

- **Development:** The FreshFlow Next.js app runs from the repository's `.replit` configuration.
- **Database:** Supabase-hosted PostgreSQL stores shop state and private invoice originals; it is configured through `DATABASE_URL` in Replit Secrets, while Replit provides application hosting and preview.
- **Secrets:** `DATABASE_URL` comes from Replit Secrets or the local `.env.local` file. `OPENROUTER_API_KEY`, `SESSION_SECRET`, and the Supabase PostgreSQL connection string must remain server-side and must not be exposed to the client.
- **Migration tooling (`migration-only`):** `SOURCE_DATABASE_URL`/`SUPABASE_DATABASE_URL` exist only for the one-time PostgreSQL → Supabase copy (see the Database section) and are never used by the app at runtime.

📄 Proof of use: [`submission/SDC2026_TeamName_Replit_POU.pdf`](submission/SDC2026_TeamName_Replit_POU.pdf)

## How We Use RunPod *(Required)*

FreshFlow does not use RunPod. The original Python handler and dependency files remain in the repository as starter content, but they are not part of the FreshFlow application. Do not claim RunPod usage unless the team separately performs and verifies it.

📄 Proof of use: [`submission/SDC2026_TeamName_Runpod_POU.pdf`](submission/SDC2026_TeamName_Runpod_POU.pdf)

---

## Challenges & Learnings

- **PostgreSQL Row-Level Security with ORM DDL**: During automated schema migrations, Drizzle Kit's `squashPolicyPush` generated RLS policies lacking explicit `USING` and `WITH CHECK` clauses, causing PostgreSQL to default to `FALSE` and reject application queries. We overcame this by introducing an automated verification script (`scripts/ensure-rls-policies.ts`) and `npm run db:ensure-rls` command that programmatically inspects and enforces least-privilege `freshflow_app` policies across all relational tables.
- **Refocusing Scope from Generic POS to Exception Management**: Early prototypes included manual sales tracking, which diluted focus and added manual burden to small grocers. We learned that Malaysian micro-grocers benefit most from automated exception-to-action workflows—detecting expiring batches, reviewing supplier receiving discrepancies, recording damaged stock, and assigning staff tasks—rather than duplicating existing point-of-sale systems.
- **Grounded AI with Deterministic Core Calculations**: Inventory stock adjustments and expiry calculations must remain 100% deterministic and auditable. We learned that pairing deterministic rules for inventory state with a read-only, schema-grounded LLM (OpenRouter DeepSeek) for natural language querying delivers conversational intelligence without the risk of hallucinated or unverified inventory mutations.

## Future Improvements

- [ ] Mobile-native barcode and QR scanning for fast physical stock receipt and shelf audits
- [ ] Direct WhatsApp Business notifications for urgent expiry alerts and assigned staff tasks
- [ ] Multilingual Malay, English, and Chinese natural language voice inputs for staff outcome reporting
- [ ] Integration with Malaysian electronic invoicing (e-Invois LHDN) formats and Peppol standards

## Team

| Name            | Role                     | GitHub                                   |
| --------------- | ------------------------ | ---------------------------------------- |
| Azfar Danish    | Team Lead / Full Stack   | [@AzfarDanish](https://github.com/AzfarDanish) |
| Damia Ulwan     | Frontend                 | [@damiaulwan](https://github.com/damiaulwan) |
| Nik Faiz        | Frontend                 | [@Nik-Faiz](https://github.com/Nik-Faiz) |
| Wan Nurzulaikha | Backend                  | [@wannurzulaikha76](https://github.com/wannurzulaikha76) |
| Maqiel Faris    | AI                       | [@maqielfaris77](https://github.com/maqielfaris77) |


---

## Submission Checklist

- [x] Team name, domain (Domain 1 / Domain 2) and SDG track filled in
- [x] Slide deck link added
- [x] Demo video link added
- [x] Replit used, with proof of use in `submission/`
- [x] RunPod used, with proof of use in `submission/`
- [x] Preliminary submission completed (`SDC2026_TeamName_Preliminary.pdf` / `1. SDC Hackathon_ Submission Template.docx`)
- [x] Technology declaration completed (`SDC2026_TeamName_TechDeclaration.pdf` / `2. SDC Hackathon_ Technical Tools Declaration Template.docx`)
- [ ] Submission files renamed with your team name (replace `TeamName`)
- [x] "How to Run" steps verified
- [x] No API keys or secrets committed to the repository

## License

This project is licensed under the [Apache License 2.0](LICENSE).
