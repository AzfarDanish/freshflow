# AGENTS.md

Binding, tool-neutral rules for all AI coding agents and automation
working in this repository.

This repository is a team submission for the SDC 2026 hackathon and was
initialized from the official hackathon repository template. The product
being developed is **FreshFlow**, an inventory exception-to-action
system for Malaysian micro and small grocers.

Official hackathon requirements and submission templates are the source
of truth. This file does not replace them.

------------------------------------------------------------------------

## 1. Before you start

1.  Read this file before implementation, refactoring, or documentation
    changes.
2.  Check the target directory for additional instruction files and
    follow applicable, more specific instructions unless they conflict
    with higher-priority requirements.
3.  If this file is not loaded automatically, read it explicitly.
4.  Inspect the existing project structure and files before deciding
    where or how to implement a change.
5.  If instructions conflict or a requirement is unclear, pause and
    report the conflict instead of guessing.

**Precedence:** applicable higher-priority instructions and official
hackathon requirements → this file → applicable directory instructions →
general conventions.

## 2. Repository and submission structure

-   Preserve the official hackathon submission structure and required
    files.
-   Keep root configuration and documentation files in their existing
    locations unless a justified change is necessary and authorized.
-   Put each new file in the existing directory that owns its concern.
    Do not create a parallel application or duplicate project layout.
-   Inspect the repository before relying on any path mentioned in these
    rules. The starter template may contain legacy or unused files.
-   Do not delete or rename template folders or files merely because
    they are not used by the selected application architecture.
-   Keep `docs/` evidence and documentation paths consistent with
    references in `README.md`.
-   The official submission materials are located in `submission/`,
    subject to the boundary in Section 3.

## 3. Submission boundary

Files in `submission/` are official submission materials and are
**human-only**.

Agents must not: - create, edit, rename, replace, regenerate, convert,
or delete files in `submission/`; - fill in or fabricate submission
documents; - create substitute deliverables in another format or
location.

Agents may maintain technical facts in `README.md` and supporting
materials outside `submission/` so the team can prepare accurate
submissions. The team is responsible for final submission content.

## 4. Intended application architecture

The intended MVP architecture is:

-   **Application:** Next.js with TypeScript.
-   **Server-side functionality:** Next.js server-side code and route
    handlers where appropriate.
-   **Database:** Supabase PostgreSQL.
-   **Authentication and roles:** Simulated roles are acceptable for the
    MVP where appropriate. Do not imply that simulated authorization is
    production-grade security.
-   **AI:** Optional. Use it only when it provides a clear, justified
    benefit. Deterministic rules should handle inventory calculations
    and expiry-risk decisions.
-   **Deployment:** The application should be runnable and demonstrable
    in the team's chosen supported hosting environment.

**RunPod is not part of the intended architecture and must not be
introduced as a dependency or deployment requirement.**

Follow the actual package manager, framework conventions, and
application layout established by the repository. If the existing
starter structure conflicts with the intended architecture, assess the
smallest safe change and explain the impact before making broad
structural changes.

Do not assume the starter's Python or RunPod code is required by the
hackathon. Do not remove legacy starter files or folders without
checking their purpose and preserving required template materials.

## 5. Product scope and workflow

FreshFlow focuses on inventory exceptions and turning them into
accountable actions, rather than building a full POS system or generic
inventory platform.

The core demonstration should show a complete journey:

1.  Detect an inventory issue using available data, such as a batch
    nearing expiry.
2.  Explain the relevant facts and the rule behind the alert.
3.  Recommend an appropriate next action without inventing unavailable
    information.
4.  Request approval from the appropriate person.
5.  Create and assign a task after approval.
6.  Record the staff-reported outcome and show an activity history.

-   Clearly label synthetic data and simulated integrations.
-   Do not claim real waste reduction, customer validation, or business
    impact without evidence.
-   Do not fabricate sales forecasts, stock movement, expiry dates, or
    operational outcomes.
-   Keep the MVP focused. Treat unrelated integrations and future
    enhancements as out of scope unless explicitly requested.

## 6. Development and security rules

1.  Keep changes scoped to the requested task. Avoid unrelated
    refactors, duplicate implementations, and unnecessary dependencies.
2.  Use TypeScript and the repository's established formatting and
    naming conventions.
3.  Add required dependencies using the project's existing package
    manager and keep its lockfile consistent.
4.  Keep environment variables consistent across `.env.example`,
    implementation, documentation, and deployment configuration.
    Document required variables without exposing their values.
5.  Never commit `.env` files, API keys, credentials, tokens, or private
    user data. Example environment files must contain placeholders only.
6.  Never expose Supabase service-role credentials or other privileged
    secrets to client-side code.
7.  Enforce access control on the server for protected operations in any
    real authenticated deployment. Client-side role checks alone are not
    security.
8.  Validate inputs, handle errors explicitly, and avoid logging secrets
    or full sensitive payloads.
9.  Use database constraints and appropriate access policies where
    applicable. Do not claim simulated roles provide real authorization.
10. Do not introduce payment processing, statutory filing, legal advice,
    or financial advice functionality into the MVP.

## 7. Documentation, testing, and evidence

1.  Update `README.md` and relevant documentation when setup commands,
    behavior, environment variables, data models, integrations, or
    architecture change.
2.  Preserve required README sections and official template
    placeholders. Do not remove sections without authorization.
3.  Never fabricate test results, metrics, user validation, screenshots,
    proof-of-use evidence, or sponsor usage.
4.  Label synthetic data as synthetic, estimates as estimates with
    sources, and simulated integrations as simulated.
5.  Only mark a checklist item complete when it is genuinely complete.
6.  Add or update relevant tests for changed behavior.
7.  Run applicable checks when possible, using scripts and commands
    actually defined by the repository (for example, its package
    scripts). Do not assume commands exist without inspecting
    configuration.
8.  Report what was run, what passed, what failed, what was skipped, and
    what remains unresolved.

## 8. Completion requirements

A task is complete only when:

1.  The changed files and affected references have been inspected.
2.  Relevant tests, linting, type checks, or build checks have been run
    where feasible.
3.  Documentation is consistent with the implementation.
4.  Results are reported accurately. Do not claim a deployment or
    integration works unless it was verified.
5.  Any outstanding risks, assumptions, or hackathon deliverables
    affected by the change are identified.

## 9. Agent operating rules

-   Read this file at the start of every task and check applicable
    directory instructions before editing.
-   Apply these rules regardless of the AI agent, coding tool, or
    automation in use.
-   Do not assume this file is automatically discovered. Read it
    explicitly when needed.
-   Ask before decisions that materially affect architecture, team
    identity, or submission content.
-   Leave the repository runnable, understandable, and maintainable for
    the next contributor.
