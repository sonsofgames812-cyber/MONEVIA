const express = require("express");
const cors = require("cors");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 8080;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY.");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);

app.use(cors());
app.use(express.json({ limit: "100kb" }));

// Serve MONEVIA website files.
app.use(express.static(path.join(__dirname, "public")));

// Health check.
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "MONEVIA backend is running"
  });
});

// Registration.
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        error: "Please provide your name, email and password."
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2 || cleanName.length > 80) {
      return res.status(400).json({
        error: "Your name must contain between 2 and 80 characters."
      });
    }

    if (
      cleanEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      return res.status(400).json({
        error: "Please enter a valid email address."
      });
    }

    if (password.length < 10 || password.length > 100) {
      return res.status(400).json({
        error: "Your password must contain between 10 and 100 characters."
      });
    }

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          full_name: cleanName
        }
      }
    });

    if (error) {
      console.error("Registration failed:", error.message);

      return res.status(400).json({
        error: error.message
      });
    }

    return res.status(201).json({
      success: true,
      message: data.session
        ? "Your MONEVIA account has been created."
        : "Account request received. Check your email to confirm your account.",
      requiresEmailConfirmation: !data.session,
      user: data.user
        ? {
            id: data.user.id,
            name: cleanName,
            email: data.user.email
          }
        : null,
      accessToken: data.session?.access_token || null,
      refreshToken: data.session?.refresh_token || null
    });
  } catch (error) {
    console.error("Registration error:", error.message);

    return res.status(500).json({
      error: "Registration could not be completed. Please try again."
    });
  }
});

// Login.
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        error: "Please enter your email and password."
      });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });

    if (error) {
      return res.status(401).json({
        error: "Invalid email or password, or your email needs confirmation."
      });
    }

    return res.json({
      success: true,
      message: "Welcome back to MONEVIA.",
      user: {
        id: data.user.id,
        name:
          data.user.user_metadata?.full_name ||
          data.user.user_metadata?.name ||
          data.user.email,
        email: data.user.email
      },
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      error: "Login failed. Please try again."
    });
  }
});

// Verify a user's access token.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  if (!token) {
    return res.status(401).json({
      error: "Please sign in to access your account."
    });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        error: "Your session is invalid or expired. Please sign in again."
      });
    }

    req.user = data.user;
    next();
  } catch (error) {
    return res.status(401).json({
      error: "Unable to verify your session."
    });
  }
}

// Get the signed-in user's profile.
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      name:
        req.user.user_metadata?.full_name ||
        req.user.user_metadata?.name ||
        req.user.email,
      email: req.user.email
    }
  });
});

// Logout from Supabase.
app.post("/api/auth/logout", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase.auth.admin
      ? { error: new Error("Admin API must not be used with a public key.") }
      : { error: null };

    // This endpoint does not use the admin API.
    // The frontend should also sign out its local Supabase session.
    return res.json({
      success: true,
      message: "Please clear your local session to finish signing out."
    });
  } catch (error) {
    return res.status(500).json({
      error: "Logout failed."
    });
  }
});

// Homepage.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Wallet page.
app.get("/wallet", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "wallet.html"));
});

// Demo wallet endpoint.
// Real balances must be calculated from verified database transactions.
app.get("/api/wallet", requireAuth, (req, res) => {
  res.json({
    success: true,
    userId: req.user.id,
    balances: [],
    payouts: [],
    message: "No verified earnings have been recorded."
  });
});

// Basic orders endpoint.
app.get("/api/orders", requireAuth, (req, res) => {
  res.json({
    success: true,
    orders: []
  });
});

// Unknown API routes.
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

// Handle invalid JSON and unexpected errors.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      error: "Invalid JSON request."
    });
  }

  console.error(err);

  res.status(500).json({
    error: "Internal server error."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MONEVIA backend running on port ${PORT}`);
});
