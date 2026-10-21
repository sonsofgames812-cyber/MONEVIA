const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "100kb" }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabase =
supabaseUrl && supabaseAnonKey
? createClient(supabaseUrl, supabaseAnonKey)
: null;

app.get("/", (req, res) => {
res.status(200).send("MONEVIA backend is running!");
});

app.get("/health", (req, res) => {
res.status(200).json({
status: "OK",
application: "MONEVIA"
});
});

app.post("/api/register", async (req, res) => {
try {
if (!supabase) {
return res.status(503).json({
success: false,
message: "Supabase is not configured."
});
}

const { email, password, fullName } = req.body || {};

if (
  typeof email !== "string" ||
  typeof password !== "string" ||
  !email.trim() ||
  password.length < 8 ||
  password.length > 128
) {
  return res.status(400).json({
    success: false,
    message: "Enter a valid email and a password of at least 8 characters."
  });
}

const options = {};

if (typeof fullName === "string" && fullName.trim()) {
  options.data = {
    full_name: fullName.trim().slice(0, 100)
  };
}

const { data, error } = await supabase.auth.signUp({
  email: email.trim(),
  password,
  options
});

if (error) {
  return res.status(400).json({
    success: false,
    message: error.message
  });
}

return res.status(201).json({
  success: true,
  message: data.session
    ? "Registration successful."
    : "Registration received. Check your email to confirm your account.",
  user: data.user
    ? {
        id: data.user.id,
        email: data.user.email
      }
    : null
});

} catch (error) {
console.error("MONEVIA registration error:", error.message);

return res.status(500).json({
  success: false,
  message: "Registration failed. Please try again."
});

}
});

app.listen(PORT, "0.0.0.0", () => {
console.log("MONEVIA backend running on port ${PORT}");
});
