# Supabase database setup

This folder contains the versioned database schema for SellPilot.

## Initial migration

File: `migrations/20261104000000_initial_schema.sql`

It creates:
- Seller profiles, businesses and business membership roles.
- Customers, products, orders and order items.
- Append-only stock movement, payment/refund and expense/reversal ledgers.
- Read-only stock, order-payment, order-cost and expense summaries.
- Row Level Security (RLS) policies for every public table.
- Private authorization and validation trigger functions.

The migration keeps business data tenant-scoped. A signed-in user can access a business only if they own it or are recorded as a member. The private helper schema must not be added to Supabase's exposed API schemas.

## Applying it in Supabase

1. Open the SellPilot project in the Supabase Dashboard.
2. Open **SQL Editor** and create a new query.
3. Open the migration file in this repository and copy its complete contents.
4. Paste the SQL into the editor and run it once.
5. Check the Table Editor for the new tables and confirm that RLS is enabled on each public table.

**Run this initial migration only once.** It creates tables, functions and policies without using destructive reset commands. Do not paste only part of the file. If the query reports an error, stop and share the exact error message; do not try random fixes or rerun a partially successful migration.

## Important data rules

- Order status and payment status are separate. Payment status is calculated from payment and refund entries.
- Order subtotals are recalculated from saved order-item snapshots.
- Stock on hand is calculated from stock movements. Stock cannot become negative.
- Payment and refund entries are append-only. A refund cannot exceed the unrefunded amount received.
- Expense entries are append-only; use a reversal entry to correct an expense.
- Product cost snapshots may be missing. The cost summary reports whether cost data is complete.
- A net profit figure must not be displayed until the app has enough reliable cost and expense data to calculate it.

## Current limitations

This migration establishes the database foundation; it does not create the user interface for signup, business setup, invitations, order entry or payment recording. Those application flows still need to be implemented and tested.

The project has not yet been connected to production credentials, and this migration has not yet been executed against the live Supabase database.