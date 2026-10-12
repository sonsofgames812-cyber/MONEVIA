# MONEVIA — global earning marketplace starter

MONEVIA is a full-stack starter for a real-value marketplace. Users can register, publish services/digital products/tasks, buy USD listings through Stripe Checkout (when deliberately enabled), and see earnings recorded only after a verified Stripe webhook. Payout requests are manually reviewed; this starter does **not** automatically transfer funds.

## Revenue model

- **Marketplace commission:** configurable default 12% of each paid order. The seller's ledger receives the remainder.
- **Later, optional revenue:** clearly disclosed promoted listings and business-sponsored tasks, once sponsor funding and task-verification workflows exist.
- **Affiliate commissions:** add only with approved affiliate programs and reliable conversion tracking. Do not credit a referral merely for signing up.
- No pay-to-join requirement, guaranteed-income claims, or recruitment-based rewards.

## Project structure

```text
MONEVIA/
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── login.html
│   ├── register.html
│   ├── dashboard.html
│   ├── tasks.html
│   ├── marketplace.html
│   ├── wallet.html
│   ├── transactions.html
│   ├── profile.html
│   └── assets/
│       ├── logo.png
│       └── images/
├── server.js
├── package.json
├── .env
├── .env.example
├── .gitignore
├── database.sql
└── README.md
```

## Run locally

Requirements: Node.js 20+ and PostgreSQL 14+.

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a long random `SESSION_SECRET`, and `BASE_URL`.
3. Install and run:
   ```bash
   npm install
   npm start
   ```
4. Open `http://localhost:8080`. The API health check is `/api/health`.

The database schema is created at startup. For production, use managed PostgreSQL and a migration system instead of relying on ad-hoc schema creation.

## Stripe setup — test mode first

1. Create a Stripe account for your actual legal entity and confirm the country, business model, supported countries, tax obligations, and marketplace rules with Stripe before launch.
2. Set `STRIPE_SECRET_KEY` to a **test-mode** secret key.
3. Set a webhook endpoint to `https://YOUR_DOMAIN/api/payments/stripe-webhook`, listening for `checkout.session.completed`, and copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
4. Use HTTPS and set `BASE_URL` to the exact public origin.
5. Run test purchases and confirm a signed webhook creates exactly one ledger earning.
6. Set `ENABLE_CHECKOUT=true` only after testing and compliance review. Do not use live keys until ready for real transactions.

**Important payment limitation:** this starter accepts buyer payments for USD listings using Stripe Checkout. It does not onboard sellers to Stripe Connect or automatically send payouts. Payout requests are manual records only. Before enabling real production commerce, implement seller identity/KYC onboarding, a compliant connected-account/marketplace payment flow, refund/dispute handling, reconciliation, tax disclosures, and an actual supported payout provider. Availability differs by country and account; global access is not guaranteed. Never collect card details directly in this app.

## Deploy to Railway

1. Push this folder to a GitHub repository.
2. In Railway, create a project and deploy the repo.
3. Add a PostgreSQL service and connect its `DATABASE_URL` variable to the app service.
4. Add `NODE_ENV=production`, `BASE_URL`, `SESSION_SECRET`, Stripe test keys, `STRIPE_WEBHOOK_SECRET`, and `ENABLE_CHECKOUT=false`.
5. Generate a public HTTPS domain. Update `BASE_URL` and the Stripe webhook endpoint to that domain.
6. Check `/api/health` and server logs before testing.

Never commit `.env` or live secrets. Rotate any secret accidentally exposed in logs or chat.

## Security and launch checklist

- HTTPS, secure cookies, strong session secret, rate limiting, Helmet, password hashing, parameterized SQL, and input validation are included.
- Add email verification, password reset, CSRF protection appropriate to the chosen deployment, audit logs, monitoring, privacy/terms/refund policies, moderation/reporting, seller verification, and fraud controls before public launch.
- Set the initial admin role manually in PostgreSQL only after creating the owner account:
  `UPDATE users SET role='admin' WHERE email=LOWER('owner@example.com');`
- Admin payout approval is a review workflow, not a money transfer. Mark a request `paid` only after you have independently sent and reconciled the actual transfer.
- This code is a starter, not a legal, tax, security, or payment-provider approval.
