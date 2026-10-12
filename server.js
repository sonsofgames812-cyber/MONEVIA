require("dotenv").config();
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const Stripe = require("stripe");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const path = require("path");
const crypto = require("crypto");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const PORT = Number(process.env.PORT || 8080);
const FEE_PERCENT = Math.min(30, Math.max(0, Number(process.env.PLATFORM_FEE_PERCENT || 12)));
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: BASE_URL, credentials: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));

// Stripe needs the raw body for signature verification. This route is registered before express.json().
app.post("/api/payments/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send("Payments not configured");
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (err) { return res.status(400).send(`Webhook signature error: ${err.message}`); }
  try {
    if (event.type === "checkout.session.completed") {
      const checkout = event.data.object;
      if (checkout.metadata?.kind === "marketplace_order" && checkout.payment_status === "paid") {
        await pool.query("BEGIN");
        try {
          const seen = await pool.query("SELECT id FROM payment_events WHERE provider_event_id=$1", [event.id]);
          if (!seen.rowCount) {
            await pool.query("INSERT INTO payment_events(provider_event_id, event_type) VALUES($1,$2)", [event.id, event.type]);
            const orderId = checkout.metadata.orderId;
            const result = await pool.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [orderId]);
            if (result.rowCount && result.rows[0].status === "pending_payment") {
              const order = result.rows[0];
              const gross = Number(order.amount_cents);
              const fee = Math.round(gross * FEE_PERCENT / 100);
              const sellerNet = gross - fee;
              await pool.query("UPDATE orders SET status='paid', stripe_session_id=$2, platform_fee_cents=$3, seller_net_cents=$4, paid_at=NOW() WHERE id=$1",
                [orderId, checkout.id, fee, sellerNet]);
              await pool.query("INSERT INTO ledger(user_id, order_id, entry_type, amount_cents, currency, note) VALUES($1,$2,'earning',$3,$4,'Marketplace sale; pending payout review')",
                [order.seller_id, orderId, sellerNet, order.currency]);
            }
          }
          await pool.query("COMMIT");
        } catch (e) { await pool.query("ROLLBACK"); throw e; }
      }
    }
    res.json({ received: true });
  } catch (e) { console.error("Webhook processing failed", e); res.status(500).send("Webhook processing failed"); }
});

app.use(express.json({ limit: "32kb" }));
app.use(session({
  store: process.env.DATABASE_URL ? new PgSession({ pool, createTableIfMissing: true }) : undefined,
  secret: process.env.SESSION_SECRET || "local-dev-only-change-this-secret",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
      stripe_account_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS listings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      seller_id UUID NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('service','digital_product','task')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 300),
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      buyer_id UUID NOT NULL REFERENCES users(id),
      seller_id UUID NOT NULL REFERENCES users(id),
      listing_id UUID NOT NULL REFERENCES listings(id),
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid','cancelled','refunded')),
      stripe_session_id TEXT UNIQUE,
      platform_fee_cents INTEGER,
      seller_net_cents INTEGER,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      order_id UUID REFERENCES orders(id),
      entry_type TEXT NOT NULL CHECK (entry_type IN ('earning','payout','adjustment')),
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payment_events (
      id BIGSERIAL PRIMARY KEY,
      provider_event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payout_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','paid','rejected')),
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireAuth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: "Please sign in first." });
const requireAdmin = (req, res, next) => req.session.user?.role === "admin" ? next() : res.status(403).json({ error: "Admin access required." });

app.get("/api/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true, app: "MONEVIA", payments: Boolean(stripe), checkoutEnabled: process.env.ENABLE_CHECKOUT === "true" });
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254), password: z.string().min(10).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid name/email and password of at least 10 characters." });
  const { name, email, password } = parsed.data;
  const hash = await bcrypt.hash(password, 12);
  try {
    const r = await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,LOWER($2),$3) RETURNING id,name,email,role", [name, email, hash]);
    req.session.user = r.rows[0];
    res.status(201).json({ user: r.rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    throw e;
  }
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email and password." });
  const r = await pool.query("SELECT id,name,email,password_hash,role FROM users WHERE email=LOWER($1)", [parsed.data.email]);
  if (!r.rowCount || !(await bcrypt.compare(parsed.data.password, r.rows[0].password_hash))) return res.status(401).json({ error: "Incorrect email or password." });
  const { password_hash, ...user } = r.rows[0];
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start a secure session." });
    req.session.user = user;
    res.json({ user });
  });
}));

app.post("/api/auth/logout", (req, res) => req.session.destroy(() => { res.clearCookie("connect.sid"); res.json({ ok: true }); }));
app.get("/api/auth/me", (req, res) => res.json({ user: req.session.user || null }));

app.get("/api/listings", asyncRoute(async (req, res) => {
  const category = req.query.category;
  const allowed = ["service", "digital_product", "task"];
  const params = [];
  let sql = `SELECT l.id,l.title,l.description,l.category,l.amount_cents,l.currency,l.created_at,u.name AS seller_name
             FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.status='active'`;
  if (allowed.includes(category)) { params.push(category); sql += ` AND l.category=$${params.length}`; }
  sql += " ORDER BY l.created_at DESC LIMIT 100";
  res.json({ listings: (await pool.query(sql, params)).rows });
}));

app.post("/api/listings", requireAuth, asyncRoute(async (req, res) => {
  const p = z.object({
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().min(10).max(2000),
    category: z.enum(["service", "digital_product", "task"]),
    amountCents: z.number().int().min(300).max(100000000),
    currency: z.enum(["usd", "eur", "gbp", "ngn"]).default("usd")
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Check the listing fields. Minimum price is 3 currency units." });
  const { title, description, category, amountCents, currency } = p.data;
  const r = await pool.query("INSERT INTO listings(seller_id,title,description,category,amount_cents,currency) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [req.session.user.id, title, description, category, amountCents, currency]);
  res.status(201).json({ listing: r.rows[0] });
}));

app.post("/api/orders/:listingId/checkout", requireAuth, asyncRoute(async (req, res) => {
  if (process.env.ENABLE_CHECKOUT !== "true") return res.status(503).json({ error: "Checkout is disabled until Stripe account, webhook, refund policy, and business review are complete." });
  if (!stripe) return res.status(503).json({ error: "Stripe is not configured." });
  const listingResult = await pool.query("SELECT * FROM listings WHERE id=$1 AND status='active'", [req.params.listingId]);
  if (!listingResult.rowCount) return res.status(404).json({ error: "Listing not found." });
  const listing = listingResult.rows[0];
  if (listing.seller_id === req.session.user.id) return res.status(400).json({ error: "You cannot purchase your own listing." });
  if (listing.currency !== "usd") return res.status(400).json({ error: "This starter checkout currently supports USD listings only. Add and test a suitable regional payment provider before offering other currencies." });
  const order = await pool.query("INSERT INTO orders(buyer_id,seller_id,listing_id,amount_cents,currency) VALUES($1,$2,$3,$4,$5) RETURNING id",
    [req.session.user.id, listing.seller_id, listing.id, listing.amount_cents, listing.currency]);
  const orderId = order.rows[0].id;
  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price_data: { currency: listing.currency, product_data: { name: listing.title, description: listing.description.slice(0, 500) }, unit_amount: listing.amount_cents }, quantity: 1 }],
      success_url: `${BASE_URL}/?payment=success&order=${orderId}`,
      cancel_url: `${BASE_URL}/?payment=cancelled`,
      client_reference_id: orderId,
      metadata: { kind: "marketplace_order", orderId }
    }, { idempotencyKey: `monevia-order-${orderId}` });
    await pool.query("UPDATE orders SET stripe_session_id=$2 WHERE id=$1", [orderId, checkout.id]);
    res.json({ checkoutUrl: checkout.url });
  } catch (e) {
    await pool.query("UPDATE orders SET status='cancelled' WHERE id=$1", [orderId]);
    throw e;
  }
}));

app.get("/api/wallet", requireAuth, asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT currency,
    SUM(CASE WHEN entry_type IN ('earning','adjustment') THEN amount_cents ELSE -amount_cents END)::bigint AS balance_cents
    FROM ledger WHERE user_id=$1 GROUP BY currency`, [req.session.user.id]);
  const payouts = await pool.query("SELECT id,amount_cents,currency,status,created_at FROM payout_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [req.session.user.id]);
  res.json({ balances: r.rows, payouts: payouts.rows, note: "Balances represent recorded marketplace sales, not guaranteed income. Payouts require verification and review." });
}));

app.get("/api/transactions", requireAuth, asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT id,entry_type,amount_cents,currency,note,created_at FROM ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.session.user.id]);
  res.json({ transactions: r.rows });
}));

app.post("/api/payouts", requireAuth, asyncRoute(async (req, res) => {
  const p = z.object({ amountCents: z.number().int().min(1000), currency: z.enum(["usd","eur","gbp","ngn"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Minimum payout request is 10 currency units." });
  const available = await pool.query(`SELECT COALESCE(SUM(CASE WHEN entry_type IN ('earning','adjustment') THEN amount_cents ELSE -amount_cents END),0)::bigint AS cents FROM ledger WHERE user_id=$1 AND currency=$2`,
    [req.session.user.id, p.data.currency]);
  if (Number(available.rows[0].cents) < p.data.amountCents) return res.status(400).json({ error: "Requested amount exceeds your recorded balance." });
  const already = await pool.query("SELECT COALESCE(SUM(amount_cents),0)::bigint AS cents FROM payout_requests WHERE user_id=$1 AND currency=$2 AND status IN ('requested','approved','paid')",
    [req.session.user.id, p.data.currency]);
  if (Number(available.rows[0].cents) - Number(already.rows[0].cents) < p.data.amountCents) return res.status(400).json({ error: "That balance is already reserved by another payout request." });
  const r = await pool.query("INSERT INTO payout_requests(user_id,amount_cents,currency) VALUES($1,$2,$3) RETURNING id,status,amount_cents,currency,created_at",
    [req.session.user.id, p.data.amountCents, p.data.currency]);
  res.status(201).json({ payout: r.rows[0], message: "Request recorded for manual review. This does not mean a transfer has been sent." });
}));

// Admin is assigned manually in the database after the owner account is created.
app.get("/api/admin/payouts", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  res.json({ payouts: (await pool.query(`SELECT p.*,u.email,u.name FROM payout_requests p JOIN users u ON u.id=p.user_id ORDER BY p.created_at ASC LIMIT 200`)).rows });
}));
app.post("/api/admin/payouts/:id/status", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const p = z.object({ status: z.enum(["approved","paid","rejected"]), note: z.string().max(500).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid payout status." });
  const payout = await pool.query("SELECT * FROM payout_requests WHERE id=$1 FOR UPDATE", [req.params.id]);
  if (!payout.rowCount) return res.status(404).json({ error: "Payout request not found." });
  const item = payout.rows[0];
  if (item.status === "paid" || item.status === "rejected") return res.status(409).json({ error: "This payout request is already final." });
  if (p.data.status === "paid") {
    await pool.query("BEGIN");
    try {
      await pool.query("UPDATE payout_requests SET status='paid',note=$2 WHERE id=$1", [item.id, p.data.note || null]);
      await pool.query("INSERT INTO ledger(user_id,entry_type,amount_cents,currency,note) VALUES($1,'payout',$2,$3,$4)",
        [item.user_id, item.amount_cents, item.currency, `Admin-confirmed payout: ${item.id}`]);
      await pool.query("COMMIT");
    } catch (e) { await pool.query("ROLLBACK"); throw e; }
  } else {
    await pool.query("UPDATE payout_requests SET status=$2,note=$3 WHERE id=$1", [item.id, p.data.status, p.data.note || null]);
  }
  res.json({ ok: true });
}));

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Check server logs for details." });
});

initDb().then(() => app.listen(PORT, () => console.log(`MONEVIA listening on ${PORT}`)))
  .catch(err => { console.error("Database initialization failed:", err); process.exit(1); });
            
