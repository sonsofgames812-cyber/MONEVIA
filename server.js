const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "100kb" }));

// Serve the website from the public folder.
app.use(express.static(path.join(__dirname, "public")));

// Backend health check.
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "MONEVIA backend is running",
    status: "online"
  });
});

// Homepage.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Wallet page.
app.get("/wallet", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "wallet.html"));
});

// Basic wallet API.
// This is a demonstration only; it does not store real balances.
app.get("/api/wallet", (req, res) => {
  res.status(200).json({
    success: true,
    currency: "NGN",
    balance: 0,
    message: "Wallet API is running. Connect a secure database for real accounts."
  });
});

// Basic orders API.
app.get("/api/orders", (req, res) => {
  res.status(200).json({
    success: true,
    orders: [],
    message: "No orders are available from this demonstration endpoint."
  });
});

// Unknown API routes.
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found"
  });
});

// Handle invalid JSON.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON request"
    });
  }

  console.error(err);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MONEVIA backend running on port ${PORT}`);
});