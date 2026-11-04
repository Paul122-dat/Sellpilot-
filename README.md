# SellPilot

**Your business. Organised. Understood. Growing.**

SellPilot is a mobile-first business management workspace for small sellers, starting with sellers who operate through Instagram and WhatsApp.

## Product principles
- Reliable records before automation.
- AI assists; the seller makes the decision.
- Order value, money collected, outstanding balances, costs and profit are distinct figures.
- Mobile-first, lightweight and clear.
- No integrations are described as active until connected and tested.

## Initial product areas
1. Dashboard
2. Orders
3. Customers
4. Products and inventory
5. Financial tracking
6. AI assistance (seller-reviewed drafts and grounded insights)

## Technology foundation
- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase (PostgreSQL and authentication), to be configured

## Local development
Requirements: Node.js 20.9+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Environment variables
See `.env.example`. Never commit real secrets or expose service-role keys in browser code.

## Current status
This repository contains the application foundation. Authentication, database persistence, AI, notifications, payment providers and social integrations are not active until implemented, configured and tested.

All demo figures must be clearly labelled as sample data and must never be treated as a seller's real financial records.
