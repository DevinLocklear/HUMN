"use strict";

/**
 * src/stripe/index.js
 * Stripe client and checkout session helpers.
 */

const Stripe = require("stripe");
const { createLogger } = require("../logger");

const log = createLogger("stripe");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing env: STRIPE_SECRET_KEY");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ── Price IDs ─────────────────────────────────────────────────────────────────
const PRICES = {
  SETUP_FEE: "price_1TLAPERtQY1gSYr0cUuAAUll",   // $350 one-time
  PRO_MONTHLY: "price_1TLAOTRtQY1gSYr0UWNvg5Gk", // $50/month
  BETA: "price_1TNvLeRtQY1gSYr0EBiN9w3l",         // $0 one-time
};

const SUCCESS_URL = `${process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : "https://positive-passion-production.up.railway.app"}/subscribe/success`;

const CANCEL_URL = `${process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : "https://positive-passion-production.up.railway.app"}/subscribe/cancel`;

/**
 * Create a Stripe checkout session for the full plan.
 * Charges $350 setup fee + starts $50/month subscription.
 * First month is free since setup fee covers it (30-day trial).
 */
async function createSubscriptionCheckout(groupId, discordUserId) {
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price: PRICES.SETUP_FEE,
        quantity: 1,
      },
      {
        price: PRICES.PRO_MONTHLY,
        quantity: 1,
      },
    ],
    subscription_data: {
      trial_period_days: 30, // Setup fee covers first month
      metadata: {
        group_id: groupId,
        discord_user_id: discordUserId,
      },
    },
    metadata: {
      group_id: groupId,
      discord_user_id: discordUserId,
    },
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
  });

  log.info("Checkout session created", { groupId, discordUserId, sessionId: session.id });
  return session;
}

/**
 * Create a $0 beta checkout session.
 * Grants 30 days of full access at no cost.
 */
async function createBetaCheckout(groupId, discordUserId) {
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price: PRICES.BETA,
        quantity: 1,
      },
    ],
    metadata: {
      group_id: groupId,
      discord_user_id: discordUserId,
      is_beta: "true",
    },
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
  });

  log.info("Beta checkout session created", { groupId, discordUserId });
  return session;
}

module.exports = { stripe, PRICES, createSubscriptionCheckout, createBetaCheckout };
