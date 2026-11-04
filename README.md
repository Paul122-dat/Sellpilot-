# SellPilot

**Your business. Organised. Understood. Growing.**

A mobile-first business workspace for small sellers, beginning with Instagram and WhatsApp sellers.

## Principles
- Reliable records before automation.
- AI assists; the seller decides.
- Order value, collected payments, balances, costs and profit remain distinct.
- Mobile-first and data-conscious.
- Integrations are not called active until connected and tested.

## Initial modules
Dashboard, orders, customers, products and inventory, financial tracking, and seller-reviewed AI assistance.

## Stack
Next.js App Router, TypeScript, Tailwind CSS, Supabase/PostgreSQL.

## Local development
Requires Node.js 20.9+ and npm.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Add your Supabase project URL and publishable key to `.env.local`. Never commit real credentials. Do not expose Supabase secret/service-role keys in browser code.

## Authentication progress
Email/password sign-up, sign-in, email confirmation callback, sign-out, server-side dashboard protection, and first-business onboarding have been added. Live authentication testing is still pending.

## Current status
The frontend foundation and Supabase client helpers are in place. Database schema, authentication flows, row-level security policies, AI, notifications, payments and social integrations are not active until implemented and verified. Never treat sample data as real seller financial records.
