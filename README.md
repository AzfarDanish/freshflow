> [!IMPORTANT]
> ## 📁 Submission Documents & Templates
> **All required submission templates are in the Google Drive folder below. Download them before you start.**
>
> ### 👉 [**OPEN THE GOOGLE DRIVE FOLDER**](https://drive.google.com/drive/folders/1xw7c2aN8N-at8hPEULzkcU76e_FFb0Ef) 👈

---

# FreshFlow

> FreshFlow helps Malaysian micro and small grocers turn expiry-risk alerts and supplier invoice lines into reviewed, assigned, and reported inventory actions.

---

## Team Information

| Field                  | Details                                     |
| ---------------------- | ------------------------------------------- |
| **Team Name**          | Your Team Name                              |
| **Team Domain**        | Domain 1 / Domain 2 *(choose one)*          |
| **SDG Track (1–17)**   | e.g. SDG 11 — Sustainable Cities and Communities |
| **Team Leader**        | Leader Name                                 |
| **University**         | University Name(s)                          |
| **Number of Members**  | e.g. 4                                      |

## Links

| Resource          | Link                                           |
| ----------------- | ---------------------------------------------- |
| GitHub Repository | https://github.com/your-username/your-project  |
| Replit Project    | https://replit.com/@your-username/your-project |
| Live Demo         | https://your-project.replit.app                |
| RunPod Endpoint   | https://api.runpod.ai/v2/your-endpoint-id      |
| Slide Deck        | https://example.com/slides                     |
| Demo Video        | https://example.com/demo-video                 |

---

## Overview

### Problem

Small grocery teams can have difficulty spotting expiry issues across separate stock batches and turning those issues into clearly owned work. FreshFlow demonstrates a focused exception-to-action workflow using batch quantities and expiry dates.

### Solution

FreshFlow applies deterministic expiry-date rules, explains each flag, asks for an owner decision, and creates a staff task only after approval. The MVP does not use AI, POS data, forecasts, or automatic stock changes.

### Key Features

- **Expiry visibility** — Show expired stock separately from batches within a configurable expiry window.
- **Human-reviewed actions** — Explain a recommendation and let the simulated owner approve or reject it.
- **Accountable follow-through** — Assign work after approval, record a structured staff-reported outcome (with an explanation for “Other”), and show linked simulated events chronologically.
- **Supplier invoice intake** — Upload PDF or CSV invoices, review extracted fields and issues, explicitly match or create a product, and add a batch only after owner confirmation.

### Tech Stack

| Layer         | Technology                   |
| ------------- | ---------------------------- |
| Frontend      | Next.js App Router, React, TypeScript |
| Backend       | Next.js route handlers |
| Database      | Replit-managed PostgreSQL; local JSON is test-only |
| AI / Compute  | Deterministic rules; no AI or RunPod dependency |
| Hosting / Dev | Replit |

---

## Project Structure

```
.
├── app/                     # Next.js operations UI and API routes
├── src/lib/                 # Business registry, expiry, invoice extraction, database and types
├── drizzle.config.ts        # Replit PostgreSQL schema configuration
├── drizzle/                 # Generated PostgreSQL schema snapshots
├── scripts/
│   └── import-existing-state.ts # Non-destructive local/Supabase import utility
├── supabase/
│   └── schema.sql           # Retained legacy Supabase schema
├── docs/                    # Screenshots, diagrams
├── runpod/
│   └── handler.py           # Preserved Python starter; not used by FreshFlow
├── src/
│   ├── main.py              # Preserved Python starter entry point
│   └── utils.py             # Preserved Python starter helpers
├── submission/              # Required submission documents
│   ├── SDC2026_TeamName_Preliminary.pdf      # Preliminary submission
│   ├── SDC2026_TeamName_TechDeclaration.pdf  # Technology declaration
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
Browser ──► Next.js UI and API ──► Replit PostgreSQL
                                      ├── one JSON state row per demo shop
                                      └── private invoice-file rows (bytea)
```

---

## How to Run

### Option 1 — Run on Replit (Recommended)

1. Import this repository into Replit and enable its managed PostgreSQL database.
2. Run `npm run db:push` once to apply the Drizzle schema to the development database.
3. Click **Run**. The `.replit` run command starts the Next.js development server on port 5000.
4. After code merges, the configured post-merge setup installs packages and pushes the schema to the development database. Replit's Publish flow compares development and production schemas and applies production schema changes when you publish.

### Option 2 — Run Locally

```bash
# 1. Clone the repository
git clone https://github.com/your-username/your-project.git
cd your-project

# 2. Install Node.js and dependencies
npm ci

# 3. Configure a PostgreSQL database (Replit injects DATABASE_URL automatically)
cp .env.example .env
# Set DATABASE_URL locally, then apply the schema:
npm run db:push

# 4. Run the app
npm run dev
```

Open `http://localhost:5000`.

### Persistence and database setup

- **Replit PostgreSQL is the runtime store.** The app requires `DATABASE_URL` and fails explicitly if it is unavailable; it does not silently switch to local files. Replit supplies this value for its managed database. Do not expose it to client code.
- `src/lib/db/schema.ts` is the schema source. `npm run db:push` applies it to the development database; startup and production builds do not run DDL. The post-merge setup applies it to the development database. Replit's Publish flow applies the development-to-production schema diff when you publish.
- Each shop has an independent JSONB state row. Invoice originals are stored in a private `bytea` table in the same database, scoped to the shop, and limited to 5 MB per upload. Downloads are served through a business-scoped, no-store API route, not a public object URL.
- PDF intake supports text-based PDFs whose table columns are selectable and separated in the PDF text layer, or labeled line-item fields. Scanned/image-only PDFs are unsupported because OCR is not configured. CSV intake requires UTF-8 with a header row; recognized headers include SKU, product/description, category, quantity, unit, batch/lot and expiry.
- Uploading only creates unverified proposals. Missing and ambiguous values are shown for owner review. The owner must explicitly choose an existing product or create a new product; only confirmation changes inventory. Imported invoice data and resulting batches are not marked synthetic, and demo reset refuses to clear a shop that contains them.
- Shop and role switching remain demonstration conveniences, not authentication or secure tenant authorization. Do not expose this demo API to public sensitive data.
- For existing state, `npm run db:import:local` imports known `.data/<business-id>.json` files. To import legacy Supabase state, apply `npm run db:import:supabase` with temporary `LEGACY_SUPABASE_URL` and `LEGACY_SUPABASE_SERVICE_ROLE_KEY` server environment variables. Both commands insert only missing business rows and never overwrite destination data. Legacy variables are not used by normal runtime.
- `supabase/schema.sql` is retained only as a legacy reference; FreshFlow no longer uses Supabase at runtime.

### Tests and build

```bash
npm test
npm run build
npm run db:push
python -m unittest discover tests
```

### Scope and limitations

Seed inventory and simulated workflow actions are synthetic. Uploaded invoice files and batches created from owner-confirmed lines are persisted as non-synthetic records. The demo date is fixed at 24 October 2026. Client-side owner/staff switching demonstrates workflow paths only; there is no real authentication or authorization. The API is not suitable for production or public sensitive data. Completing a staff task records a report and never changes inventory quantities. No POS, sales forecasts, automatic discounts, disposal actions, or waste-reduction claims are included.

---

## How We Use Replit *(Required)*

Use this section for accurate team evidence. The app is configured to run through Replit's web preview; no hosting or deployment claim is made here.

- **Development:** The FreshFlow Next.js app runs from the repository's `.replit` configuration.
- **Database:** Replit-managed PostgreSQL stores shop state and private invoice originals.
- **Secrets:** `DATABASE_URL` is supplied by Replit. Legacy Supabase credentials are used only for an explicitly run migration and must stay server-side.

📄 Proof of use: [`submission/SDC2026_TeamName_Replit_POU.pdf`](submission/SDC2026_TeamName_Replit_POU.pdf)

## How We Use RunPod *(Required)*

FreshFlow does not use RunPod. The original Python handler and dependency files remain in the repository as starter content, but they are not part of the FreshFlow application. Do not claim RunPod usage unless the team separately performs and verifies it.

📄 Proof of use: [`submission/SDC2026_TeamName_Runpod_POU.pdf`](submission/SDC2026_TeamName_Runpod_POU.pdf)

---

## Challenges & Learnings

- What challenges did you face, and how did you overcome them?
- What did your team learn?

## Future Improvements

- [ ] Improvement 1
- [ ] Improvement 2

## Team

| Name        | Role                | GitHub                                   |
| ----------- | ------------------- | ---------------------------------------- |
| Member Name | Team Lead / Backend | [@username](https://github.com/username) |
| Member Name | Frontend            | [@username](https://github.com/username) |
| Member Name | AI / RunPod         | [@username](https://github.com/username) |

---

## Submission Checklist

- [ ] Team name, domain (Domain 1 / Domain 2) and SDG track filled in
- [ ] Slide deck link added
- [ ] Demo video link added
- [ ] Replit used, with proof of use in `submission/`
- [ ] RunPod used, with proof of use in `submission/`
- [ ] Preliminary submission completed (`SDC2026_TeamName_Preliminary.pdf`)
- [ ] Technology declaration completed (`SDC2026_TeamName_TechDeclaration.pdf`)
- [ ] Submission files renamed with your team name (replace `TeamName`)
- [ ] "How to Run" steps verified
- [ ] No API keys or secrets committed to the repository

## License

This project is licensed under the [Apache License 2.0](LICENSE).
