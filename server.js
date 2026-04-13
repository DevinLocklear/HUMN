require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");
const { createClient } = require("@supabase/supabase-js");
const { checkEmails } = require("./gmailReader");

const app = express();

const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

function validateParams(discordUserId, groupId) {
  return Boolean(discordUserId && groupId);
}

app.get("/", (_req, res) => {
  res.send("Lumen Gmail Auth is running.");
});

app.get("/auth/google", async (req, res) => {
  const { discord_user_id, group_id } = req.query;

  if (!validateParams(discord_user_id, group_id)) {
    return res.status(400).send("Missing discord_user_id or group_id.");
  }

  const state = JSON.stringify({
    discord_user_id,
    group_id,
  });

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
    console.error("Invalid state parse error:", err);
    return res.status(400).send("Invalid state.");
  }

  const { discord_user_id, group_id } = parsedState;

  if (!validateParams(discord_user_id, group_id)) {
    return res.status(400).send("Invalid state payload.");
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({
      auth: oauth2Client,
      version: "v2",
    });

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
      .upsert(payload, {
        onConflict: "group_id,discord_user_id,email",
      });

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).send("Failed to save Gmail connection.");
    }

    return res.send(`
      <html>
        <head>
          <title>Lumen Gmail Connected</title>
        </head>
        <body style="font-family: Arial, sans-serif; background:#0b1020; color:white; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0;">
          <div style="max-width:560px; padding:32px; border:1px solid rgba(255,255,255,0.1); border-radius:20px; background:#151c32; box-shadow: 0 10px 30px rgba(0,0,0,0.35);">
            <h1 style="margin-top:0; font-size:32px;">Gmail Connected</h1>
            <p style="font-size:16px; line-height:1.6;">
              Your Gmail account <strong>${userInfo.email}</strong> is now linked to Lumen.
            </p>
            <p style="font-size:16px; line-height:1.6;">
              You can close this window and go back to Discord.
            </p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("OAuth callback error:", err);
    return res.status(500).send("Google authentication failed.");
  }
});

app.listen(PORT, () => {
  console.log(`Lumen Gmail Auth running on port ${PORT}`);
});

// Check inboxes every 30 seconds
setInterval(async () => {
  try {
    await checkEmails();
  } catch (err) {
    console.error("Scheduled email check failed:", err);
  }
}, 30000);