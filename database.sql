-- MONEVIA PostgreSQL schema. The server also creates these tables on startup.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
 stripe_account_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS listings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), seller_id UUID NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 description TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('service','digital_product','task')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents >= 300), currency TEXT NOT NULL DEFAULT 'usd',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id UUID NOT NULL REFERENCES users(id), seller_id UUID NOT NULL REFERENCES users(id),
 listing_id UUID NOT NULL REFERENCES listings(id), amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','paid','cancelled','refunded')),
 stripe_session_id TEXT UNIQUE, platform_fee_cents INTEGER, seller_net_cents INTEGER, paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ledger (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), order_id UUID REFERENCES orders(id),
 entry_type TEXT NOT NULL CHECK(entry_type IN ('earning','payout','adjustment')), amount_cents INTEGER NOT NULL,
 currency TEXT NOT NULL, note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS payment_events (
 id BIGSERIAL PRIMARY KEY, provider_event_id TEXT NOT NULL UNIQUE, event_type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS payout_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','paid','rejected')),
 note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
