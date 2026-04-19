require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");
const { supabase, oauth2Client } = require("./src/config");
const { createLogger } = require("./src/logger");
const { checkEmails } = require("./gmailReader");

const log = createLogger("server");
const app = express();
const PORT = process.env.PORT || 3000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateParams(discordUserId, groupId) {
  return Boolean(discordUserId && groupId);
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.send("HUMN Gmail Auth is running.");
});

app.get("/auth/google", async (req, res) => {
  const { discord_user_id, group_id } = req.query;

  if (!validateParams(discord_user_id, group_id)) {
    return res.status(400).send("Missing discord_user_id or group_id.");
  }

  const state = JSON.stringify({ discord_user_id, group_id });

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    state,
  });

  return res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send("Missing code or state.");
  }

  let parsedState;
  try {
    parsedState = JSON.parse(state);
  } catch (err) {
    log.error("Invalid OAuth state", err);
    return res.status(400).send("Invalid state.");
  }

  const { discord_user_id, group_id } = parsedState;

  if (!validateParams(discord_user_id, group_id)) {
    return res.status(400).send("Invalid state payload.");
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const { data: userInfo } = await oauth2.userinfo.get();

    const payload = {
      group_id,
      discord_user_id,
      google_email: userInfo.email,
      google_user_id: userInfo.id,
      access_token: tokens.access_token || null,
      refresh_token: tokens.refresh_token || null,
      token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      email: userInfo.email,
      status: "connected",
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("gmail_connections")
      .upsert(payload, { onConflict: "group_id,discord_user_id,email" });

    if (error) {
      log.error("Supabase upsert failed during OAuth callback", error);
      return res.status(500).send("Failed to save Gmail connection.");
    }

    log.info("Gmail connected via OAuth", {
      discordUserId: discord_user_id,
      email: userInfo.email,
    });

    return res.send(`
      <html>
        <head><title>HUMN — Gmail Connected</title></head>
        <body style="font-family:Arial,sans-serif;background:#0b1020;color:white;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
          <div style="max-width:560px;padding:32px;border:1px solid rgba(255,255,255,0.1);border-radius:20px;background:#151c32;box-shadow:0 10px 30px rgba(0,0,0,0.35);">
            <h1 style="margin-top:0;font-size:32px;">Gmail Connected ✅</h1>
            <p style="font-size:16px;line-height:1.6;">
              Your Gmail account <strong>${userInfo.email}</strong> is now linked to HUMN.
            </p>
            <p style="font-size:16px;line-height:1.6;">
              You can close this window and return to Discord.
            </p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    log.error("OAuth callback failed", err);
    return res.status(500).send("Google authentication failed.");
  }
});

// ── Server start ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  log.info(`HUMN Gmail Auth running on port ${PORT}`);
});

// ── Email polling loop ────────────────────────────────────────────────────────
//
// Guard flag prevents overlapping runs. If a poll cycle takes longer than
// 30 seconds (e.g. a slow IMAP connection), the next tick is skipped rather
// than stacking a second concurrent run on top of the first.

let isPolling = false;

setInterval(async () => {
  if (isPolling) {
    log.warn("Poll skipped — previous cycle still running");
    return;
  }

  isPolling = true;

  try {
    await checkEmails();
  } catch (err) {
    log.error("Scheduled email check failed", err);
  } finally {
    isPolling = false;
  }
}, 30000);
