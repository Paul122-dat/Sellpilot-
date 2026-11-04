# Supabase database setup

The initial SellPilot schema is split into four smaller SQL scripts to make setup easier on mobile devices. Run these files in the exact order below from the Supabase SQL Editor:

1. `migrations/20261104000100_identity_and_businesses.sql`
2. `migrations/20261104000200_seller_operations.sql`
3. `migrations/20261104000300_financial_ledgers_and_views.sql`
4. `migrations/20261104000400_updated_at_rls_and_grants.sql`

Each script is a separate transaction. Wait for the success message after each part before running the next. If any part reports an error, stop there and share the exact error. Do not continue to later parts and do not rerun a successful part.

**Do not run the older consolidated file** `migrations/20261104000000_initial_schema.sql`; it has been superseded by the four smaller scripts above. Do not run both the consolidated file and the split scripts.

## What the scripts create

- Seller profiles, businesses and business membership roles.
- Customers, products, orders and order items.
- Append-only stock movement, payment/refund and expense/reversal ledgers.
- Read-only stock, order-payment, order-cost and expense summaries.
- Row Level Security policies for every public table.
- Private authorization and validation trigger functions.

## Data rules

- Business records are tenant-scoped. A signed-in user can access a business only if they own it or are recorded as a member.
- Order status and payment status are separate. Payment status is calculated from payment and refund entries.
- Order subtotals are recalculated from saved order-item snapshots.
- Stock on hand is calculated from stock movements. Stock cannot become negative.
- Payment and refund entries are append-only. A refund cannot exceed the unrefunded amount received.
- Expense entries are append-only; use a reversal entry to correct an expense.
- Product cost snapshots may be missing. The cost summary reports whether cost data is complete.
- Do not display net profit until cost and expense data are sufficiently complete.

## Important limitations

This migration establishes the database foundation; it does not create the application flows for signup, business setup, invitations, order entry or payment recording. Those still need to be implemented and tested.

The scripts have been committed to GitHub but have not yet been executed against the live Supabase database.