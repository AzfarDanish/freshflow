# FreshFlow hackathon preview

## Access and safety

This preview opens without sign-in, account creation, or authentication. The Owner and Staff buttons are public testing profiles, not user accounts or security boundaries. Anyone who can open the URL can choose Owner; do not store private, customer, or sensitive production information in this workspace.

The business workspace is fixed to FreshFlow Demo Shop. There is no shop selector in the interface, and the retired Kedai Runcit demo is not available in the application.

The Owner/Staff matrix controls which pages and actions the interface shows: Staff can view Overview, Inventory, Tasks, and Activity and record task progress/outcomes; Owner can also view decisions, invoices, insights, and settings and perform Owner operations. This matrix is for testing only because each visitor can switch profiles.

## Data and operations

Persisted application records remain the source of truth. Supported changes update the existing database and are retained when navigating or refreshing. Counts and operation pages are loaded from the current stored state; action responses report actual validation or storage errors rather than manufacturing a success result.

The profile switcher stores the selected testing role in a short-lived, signed browser cookie. This preserves the display choice; it does not authenticate a person or protect records.

Task completion records the reported outcome and audit history; it does not claim to change stock quantities. Invoice review retains the uploaded original, extracted values, Owner-approved receipt lines, and correction history. The assistant's answers are grounded in the stored records and its failures remain visible; it does not invent activity or missing facts. OCR and AI output still require operational review.

Refreshing or moving between pages never resets the database. The settings page offers no blanket reset for operational records. The separate legacy-cleanup review is a deliberate, digest-confirmed operation that first backs up the state and only affects individually reviewed eligible records; ambiguous records are retained.

## Public-data warning

Because there is no authentication, any visitor can switch to Owner and read or change the persistent FreshFlow records, including invoice contents and uploaded documents. Only use data appropriate for an openly accessible hackathon preview. This build is not secure for production use.

## Validation

Run `npm test` and `npm run build` to verify the current code. The PostgreSQL concurrency test runs only when a test database URL is explicitly configured; local file-backed tests do not prove production database concurrency.
