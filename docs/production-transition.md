# FreshFlow operational transition

## Setup gates

1. The existing Replit PostgreSQL database remains the source of truth. Apply the Drizzle schema to development with `npm run db:push`. Production schema changes belong to the platform's Publish flow, not startup or deployment build scripts. Never select an overwrite-data option to move demo data into production.
2. Managed Clerk authentication uses `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. The root provider receives its public key server-side; no secret is embedded in client code. The managed production proxy uses `/api/__clerk`. Production credentials and the actual published domain must be configured and verified through managed authentication before release.
3. Sign up and verify the intended Owner's email. Set the non-secret `FRESHFLOW_BOOTSTRAP_OWNER_EMAIL` to that exact address. Only an authenticated account with that verified email can bootstrap an Owner membership. An existing inactive membership is never reactivated by bootstrap. Remove the bootstrap setting after provisioning if no further Owner bootstrap is intended.
4. `FRESHFLOW_BUSINESS_ID` optionally selects the server-side business; its default retains the old opaque row identifier so existing records are not lost. It is not a visible shop name. Requests cannot select a different business by query, body, product, invoice, or tool arguments.
5. `SESSION_SECRET` signs the retained testing role cookie. Preview can narrow an Owner to Staff; it can never turn an actual Staff membership into Owner access.
6. A workspace manager must connect the xAI integration. The adapter currently expects its managed credential as `XAI_API_KEY` and a configured `XAI_MODEL`; confirm the actual integration credential mapping when connecting it. With either absent, the assistant reports unavailable rather than returning fake AI answers. No model response has been verified without the connection.

New verified Staff accounts can be granted or revoked from Owner Settings. This screen never grants Owner roles. Staff access is checked again on every request.

## Operations and permissions

- Owner: all operational pages, stock management, supplier/invoice review and receiving, sales/waste entry and reversal, settings, membership and reviewed migration.
- Staff: Overview, read-only Inventory, Staff tasks (progress and completion), Activity, and the assistant's corresponding read scope. No invoice documents, decision details, movements/financial summaries, settings, or member management.
- Pages replace each other within the persistent sidebar/header. There is no shop selector or visible business name.
- A task report does not pretend to change physical quantities. Sales, waste, adjustments and received stock have explicit recorded movements.
- New businesses begin empty. Reads never restore fixtures. Expiry uses the current business calendar date (default Asia/Kuala_Lumpur); a calendar transition reconciles and persists current risk recommendations without rewriting decided history. Zero-stock batches do not generate live expiry recommendations.
- Manual inventory additions, quantity corrections and removals also record adjustment movements. Posted movements retain their original values; corrections add a reasoned reversal. Deleting a batch with open work remains blocked.

## Invoice processing and receiving

Private uploads support UTF-8 CSV, PDF, PNG and JPEG up to 5 MB. Images are limited to 16 megapixels; scanned PDF OCR is limited to 10 pages. Native `tesseract` and Poppler are runtime dependencies. OCR runs in a private temporary directory with time/output limits, followed by deterministic parsing; no AI service reads invoices.

Selectable PDF text is parsed directly; image-only PDFs and image files use OCR. Unsupported layouts or ambiguous fields remain unverified/missing and can be corrected or manually entered against the retained original. Prices/tax are stored as integer minor currency units. Missing cost is unknown, not zero.

The original upload and processing status are persisted before extraction. Failure leaves the document visible with a real error and retry path. Interrupted processing can be retried after its lease expires. Processing tokens prevent stale attempts overwriting newer results. Review is blocked while extraction is running.

Review corrections require a reason and retain the previous values and actor. Upload, extraction and review never post stock. Receiving is a separate explicit Owner confirmation, with physical quantity, product match, batch and expiry (or explicit expiry-not-applicable). Invoiced and received quantities remain separate. Partial and multiple deliveries are supported; over-delivery needs a discrepancy reason.

Receiving runs in one database transaction under the business-state row lock. A stable request reference plus payload fingerprint makes a repeated receipt idempotent and detects conflicting reuse. Duplicate file hashes and duplicate known supplier/invoice references are rejected. Invalid multi-line receipts roll back entirely. Stock, movements, receipt history, invoice status and activity are committed together.

Use the ledger's reversal action to correct a posted receipt; the receipt remains in history, its received balance/status is adjusted, and a correction records the reason. Cancellation retains documents/history and never silently reverses physical stock.

## Insights and assistant

Recorded selling prices and costs are inputs, not invented accounting data. Revenue sums recorded sales quantity × selling price; waste loss sums recorded waste quantity × cost. Reversals affect their actual recording period. Mixed-unit quantities are displayed by unit. Missing prices/costs and missing historical movements have explicit completeness warnings; no margin, savings, avoided loss, or causation is fabricated.

The model selects a bounded typed read plan; it cannot supply SQL, business identity, mutation commands or narrative metrics. The server executes a fixed business-scoped SELECT and derives the answer/evidence from actual records and deterministic calculations. No complete invoice contents or unrestricted business state is sent to the model. Staff cannot select financial or decision tools. AI failure is explicit. The per-process request limiter is a basic cost safeguard, not a cross-instance quota.

## Reviewed sample-data removal

Nothing is deleted automatically. Owner Settings shows a provenance report with its exact digest, candidate record identifiers, preserved invoice/task counts and ambiguous records requiring manual review. `simulated: true` alone is not proof: older user-created inventory used that flag too.

Confirmation must name the current report digest. The same locked database transaction stores an exact original-state backup in `freshflow_state_backups`, removes only positively fingerprinted initial fixtures and their safe dependencies, and appends a genuine cleanup audit event. A changed report, mixed provenance, or failed backup aborts the operation. Ambiguous or operationally referenced records remain untouched.

The old reset/restore-to-seed mutation is disabled; there is no production reset button. Backups are recovery records, not an automatic restoration source.

## Verification and remaining release checks

`npm run build` and `npm test` pass. Tests include real PostgreSQL concurrent receipt retries and transaction rollback, permission checks, unsigned API rejection, role caps, deterministic summaries, partial receiving, reversals, preservation, and migration confirmation.

The signed-out landing page and unauthorized API boundary were checked in the running app. Signed-in pages were **not visually verified**, because the inspection browser has no authenticated account. The real AI connection/model response, verified Owner bootstrap, reviewed cleanup confirmation and final production identity/domain configuration remain release gates. No production data was deleted or overwritten.
