> [!IMPORTANT]
> ## 📁 Submission Documents & Templates
> **All required submission templates are in the Google Drive folder below. Download them before you start.**
>
> ### 👉 [**OPEN THE GOOGLE DRIVE FOLDER**](https://drive.google.com/drive/folders/1xw7c2aN8N-at8hPEULzkcU76e_FFb0Ef) 👈

---

# FreshFlow

> FreshFlow helps Malaysian micro and small grocers turn synthetic expiry-risk alerts into reviewed, assigned, and reported inventory actions.

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
- **Accountable follow-through** — Assign work after approval, record a staff-reported outcome, and show simulated events chronologically.

### Tech Stack

| Layer         | Technology                   |
| ------------- | ---------------------------- |
| Frontend      | Next.js App Router, React, TypeScript |
| Backend       | Next.js route handlers |
| Database      | Supabase PostgreSQL when configured; per-shop local JSON demo otherwise |
| AI / Compute  | Deterministic rules; no AI or RunPod dependency |
| Hosting / Dev | Replit |

---

## Project Structure

```
.
├── app/                     # Next.js operations UI and API routes
├── src/lib/                 # Business registry, expiry rules, types, server-side storage
├── supabase/
│   └── schema.sql           # Supabase table setup
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
Browser ──► Next.js UI and API ──► Supabase PostgreSQL (one state row per demo shop)
                         └──────► Local JSON file per demo shop (otherwise)
```

---

## How to Run

### Option 1 — Run on Replit (Recommended)

1. Import this repository into Replit.
2. Click **Run**. The `.replit` run command starts the Next.js development server on port 5000.
3. With no Supabase variables, the app labels itself **Local demo** and stores each demo shop separately under `.data/` on the running workspace.
4. To use Supabase persistence, add both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Replit Secrets after applying `supabase/schema.sql`.

### Option 2 — Run Locally

```bash
# 1. Clone the repository
git clone https://github.com/your-username/your-project.git
cd your-project

# 2. Install Node.js 20.9+ and dependencies
npm ci

# 3. Optional: configure Supabase
cp .env.example .env
# Add both Supabase values to .env only if using Supabase; otherwise leave blank.

# 4. Run the app
npm run dev
```

Open `http://localhost:5000`.

### Persistence and database setup

- **Local demo mode:** with both Supabase variables absent, FreshFlow writes each shop's synthetic state to its own JSON file in `.data/` (`freshflow-demo.json` and `kedai-runcit-demo.json`). The original FreshFlow demo file remains the default shop's file. These files are local to the running workspace and are not a hosted database or multi-user store.
- **Supabase mode:** set both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is read only by server-side code and must never use a `NEXT_PUBLIC_` prefix. If either variable is only partially configured, or the table is unavailable, FreshFlow reports an error instead of silently falling back.
- Apply [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor. It creates `freshflow_business_state` with one JSONB state row per business ID and copies the prior `freshflow_state` row (`id = 'demo'`) into `freshflow-demo` only if that destination row does not already exist. The legacy table is retained; the migration is repeatable and does not overwrite the new table's existing rows.
- The demo shop selector switches between `freshflow-demo` and `kedai-runcit-demo`, whose inventory and workflow states are kept separately. This is simulated workspace switching, not authentication or secure tenant authorization. The service-role key is server-only; do not expose this demo API to public sensitive data.
- Choosing **Reset demo** resets only the currently selected synthetic shop. The server refuses the reset if it detects any non-synthetic records in that shop.
- Supabase configuration was not available for this local build, so live database persistence was not verified.

### Tests and build

```bash
npm test
npm run build
python -m unittest discover tests
```

### Scope and limitations

All seed data, added inventory, role changes, recommendations, activity events, and staff-reported outcomes are synthetic. The demo date is fixed at 24 October 2026. Client-side owner/staff switching demonstrates workflow paths only; there is no real authentication or authorization. The API is not suitable for production or public sensitive data. Completing a task never changes inventory quantities. No POS, sales forecasts, automatic discounts, disposal actions, or waste-reduction claims are included.

---

## How We Use Replit *(Required)*

Use this section for accurate team evidence. The app is configured to run through Replit's web preview; no hosting or deployment claim is made here.

- **Development:** The FreshFlow Next.js app runs from the repository's `.replit` configuration.
- **Secrets:** Optional Supabase server credentials belong in Replit Secrets, never in source control.

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
