const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve website files from the public folder
app.use(express.static(path.join(__dirname, "public")));

// Homepage
app.get("/", (req, res) => {
res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health check for Railway
app.get("/health", (req, res) => {
res.status(200).json({
success: true,
message: "MONEVIA backend is running!",
status: "OK"
});
});

// API status
app.get("/api", (req, res) => {
res.status(200).json({
name: "MONEVIA",
message: "Welcome to the MONEVIA API",
status: "online"
});
});

// Handle unknown API routes
app.use("/api", (req, res) => {
res.status(404).json({
success: false,
message: "API endpoint not found"
});
});

// Handle server errors
app.use((err, req, res, next) => {
console.error("Server error:", err.message);

res.status(500).json({
success: false,
message: "An internal server error occurred"
});
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
console.log("MONEVIA server running on port ${PORT}");
});
