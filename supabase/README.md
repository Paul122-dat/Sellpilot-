# Supabase database setup

The initial SellPilot schema is split into four smaller SQL scripts to make setup easier on mobile devices. Run these files in the exact order below from the Supabase SQL Editor:

1. `migrations/20261104000100_identity_and_businesses.sql`
2. `migrations/20261104000200_seller_operations.sql`
3. `migrations/20261104000300_financial_ledgers_and_views.sql`
4. `migrations/20261104000400_updated_at_rls_and_grants.sql`

The Product & Inventory feature requires three additional migrations. Run all three in order after the four core schema migrations when setting up a new database:

5. `migrations/20261104000500_product_image_storage.sql`
6. `migrations/20261104000600_simplify_product_image_storage_policies.sql`
7. `migrations/20261104000700_prevent_archived_product_stock_changes.sql`

The sixth migration replaces the initial Storage policy checks with UUID-validated business-membership checks. It is required for the current direct browser-to-Storage upload flow. The seventh migration updates the stock-validation trigger so archived products cannot receive stock movements, including requests that bypass the application interface.

Each script is a separate transaction. Wait for the success message after each part before running the next. If any part reports an error, stop there and share the exact error. Do not continue to later parts and do not rerun a successful part.

**Do not run the older consolidated file** `migrations/20261104000000_initial_schema.sql`; it has been superseded by the four smaller scripts above. Do not run both the consolidated file and the split scripts.

## What the scripts create

- Seller profiles, businesses and business membership roles.
- Customers, products, orders and order items.
- Append-only stock movement, payment/refund and expense/reversal ledgers.
- Read-only stock, order-payment, order-cost and expense summaries.
- Row Level Security policies for every public table.
- Private authorization and validation trigger functions.

The fifth migration creates a private Supabase Storage bucket for product photos and adds the image path to product records. The sixth migration defines the final private Storage access policies, scoped to members of the owning business. The seventh migration blocks stock movements for archived products at database level.

## Data rules

- Business records are tenant-scoped. A signed-in user can access a business only if they own it or are recorded as a member.
- Order status and payment status are separate. Payment status is calculated from payment and refund entries.
- Order subtotals are recalculated from saved order-item snapshots.
- Stock on hand is calculated from stock movements. Stock cannot become negative.
- Payment and refund entries are append-only. A refund cannot exceed the unrefunded amount received.
- Expense entries are append-only; use a reversal entry to correct an expense.
- Product cost snapshots may be missing. The cost summary reports whether cost data is complete.
- Do not display net profit until cost and expense data are sufficiently complete.
- Product photos are optional, private to the business, and limited to JPG, PNG or WebP files up to 5 MB.

## Important limitations

The database migrations establish the storage and security foundation. Application flows must still be validated with real signed-in accounts before production release.
