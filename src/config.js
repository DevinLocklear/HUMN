"use strict";

require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");

// ── Feature flags ─────────────────────────────────────────────────────────────
const DEBUG = process.env.DEBUG === "true";
const ENABLE_TEST_EVENT = process.env.ENABLE_TEST_EVENT === "true";
const ENABLE_TEST_SENDERS = process.env.ENABLE_TEST_SENDERS === "true";

// ── Supabase ──────────────────────────────────────────────────────────────────
if (!process.env.SUPABASE_URL) throw new Error("Missing env: SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_KEY)
  throw new Error("Missing env: SUPABASE_SERVICE_KEY");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Google OAuth2 ─────────────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// ── App URLs ──────────────────────────────────────────────────────────────────
const GMAIL_AUTH_BASE_URL =
  process.env.GMAIL_AUTH_BASE_URL ||
  "https://positive-passion-production.up.railway.app";

module.exports = {
  DEBUG,
  ENABLE_TEST_EVENT,
  ENABLE_TEST_SENDERS,
  supabase,
  oauth2Client,
  GMAIL_AUTH_BASE_URL,
};
