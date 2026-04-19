require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");
const { supabase, oauth2Client } = require("./src/config");
const { createLogger } = require("./src/logger");
const { checkEmails } = require("./gmailReader");
const { activateSubscription, setGracePeriod, suspendSubscription, getSubscriptionByGroupId } = require("./src/db/subscriptions");

const log = createLogger("server");
const app = express();
const PORT = process.env.PORT || 3000;

// ── Raw body needed for Stripe webhook signature verification ─────────────────
app.use("/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateParams(discordUserId, groupId) {
  return Boolean(discordUserId && groupId);
}

// ── Gmail OAuth routes ────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.send("HUMN is running.");
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

// ── Stripe pages ──────────────────────────────────────────────────────────────

app.get("/subscribe/success", (_req, res) => {
  res.send(`
    <html>
      <head><title>HUMN — Payment Successful</title></head>
      <body style="font-family:Arial,sans-serif;background:#0b1020;color:white;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
        <div style="max-width:560px;padding:32px;border:1px solid rgba(255,255,255,0.1);border-radius:20px;background:#151c32;box-shadow:0 10px 30px rgba(0,0,0,0.35);">
          <h1 style="margin-top:0;font-size:32px;">Payment Successful ✅</h1>
          <p style="font-size:16px;line-height:1.6;">
            Welcome to HUMN. Your group is now active.
          </p>
          <p style="font-size:16px;line-height:1.6;">
            Return to Discord — your bot is ready to use.
          </p>
        </div>
      </body>
    </html>
  `);
});

app.get("/subscribe/cancel", (_req, res) => {
  res.send(`
    <html>
      <head><title>HUMN — Payment Cancelled</title></head>
      <body style="font-family:Arial,sans-serif;background:#0b1020;color:white;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
        <div style="max-width:560px;padding:32px;border:1px solid rgba(255,255,255,0.1);border-radius:20px;background:#151c32;box-shadow:0 10px 30px rgba(0,0,0,0.35);">
          <h1 style="margin-top:0;font-size:32px;">Payment Cancelled</h1>
          <p style="font-size:16px;line-height:1.6;">
            No charge was made. Return to Discord and run <strong>/subscribe</strong> when you're ready.
          </p>
        </div>
      </body>
    </html>
  `);
});

// ── Stripe webhook ────────────────────────────────────────────────────────────

app.post("/stripe/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    log.error("STRIPE_WEBHOOK_SECRET not set");
    return res.status(500).send("Webhook secret not configured.");
  }

  let event;
  try {
    const { getStripe } = require("./src/stripe");
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    log.error("Stripe webhook signature verification failed", { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  log.info("Stripe webhook received", { type: event.type });

  try {
    switch (event.type) {

      // ── Payment succeeded (setup fee or beta) ───────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object;
        const groupId = session.metadata?.group_id;
        const discordUserId = session.metadata?.discord_user_id;
        const isBeta = session.metadata?.is_beta === "true";

        if (!groupId || !discordUserId) {
          log.warn("checkout.session.completed missing metadata", { sessionId: session.id });
          break;
        }

        if (isBeta) {
          // Beta — 30 days from now
          const periodEnd = new Date();
          periodEnd.setDate(periodEnd.getDate() + 30);

          await activateSubscription(groupId, discordUserId, {
            status: "beta",
            plan: "beta",
            periodEnd: periodEnd.toISOString(),
            isBeta: true,
          });

          log.info("Beta access activated", { groupId, discordUserId });
        } else {
          // Full plan — subscription starts with 30-day trial
          await activateSubscription(groupId, discordUserId, {
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            status: "trialing",
            plan: "pro",
            isBeta: false,
          });

          log.info("Pro subscription activated (trialing)", { groupId, discordUserId });
        }
        break;
      }

      // ── Subscription became active (trial ended, first real charge) ─────────
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const groupId = sub.metadata?.group_id;
        if (!groupId) break;

        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        const status = sub.status === "trialing" ? "trialing"
          : sub.status === "active" ? "active"
          : sub.status === "past_due" ? "grace"
          : "suspended";

        await activateSubscription(groupId, sub.metadata?.discord_user_id, {
          stripeCustomerId: sub.customer,
          stripeSubscriptionId: sub.id,
          status,
          plan: "pro",
          periodEnd,
        });

        log.info("Subscription updated", { groupId, status });
        break;
      }

      // ── Payment failed ──────────────────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (!subId) break;

        // Look up group by stripe_subscription_id
        const { data: sub } = await supabase
          .from("group_subscriptions")
          .select("group_id, discord_user_id")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();

        if (!sub) break;

        await setGracePeriod(sub.group_id);

        // DM the group owner
        const notify = require("./src/discord/notify");
        const { EmbedBuilder } = require("discord.js");
        const embed = new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle("⚠️ HUMN — Payment Failed")
          .setDescription(
            "Your HUMN subscription payment failed.\n\n" +
            "You have **3 days** to update your payment method before your group loses access.\n\n" +
            "Update your card at: https://billing.stripe.com"
          )
          .setFooter({ text: "HUMN Billing", iconURL: "https://i.imgur.com/ywgtHOK.png" });

        await notify.sendDM(sub.discord_user_id, embed);
        log.warn("Payment failed — grace period started", { groupId: sub.group_id });
        break;
      }

      // ── Subscription cancelled ──────────────────────────────────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const groupId = sub.metadata?.group_id;
        if (!groupId) break;

        await suspendSubscription(groupId);
        log.info("Subscription cancelled — group suspended", { groupId });
        break;
      }

      default:
        log.debug("Unhandled Stripe event", { type: event.type });
    }
  } catch (err) {
    log.error("Stripe webhook handler failed", { type: event.type, error: err.message });
  }

  res.json({ received: true });
});

// ── Server start ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  log.info(`HUMN Gmail Auth running on port ${PORT}`);
});

// ── Email polling loop ────────────────────────────────────────────────────────

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
