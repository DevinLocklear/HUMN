"use strict";

/**
 * src/stripe/index.js
 * Stripe client and checkout session helpers.
 * Loaded lazily — only when /subscribe is called.
 */

const Stripe = require("stripe");
const { createLogger } = require("../logger");

const log = createLogger("stripe");

// Price IDs
const PRICES = {
  SETUP_FEE: "price_1TLAPERtQY1gSYr0cUuAAUll",   // $350 one-time
  PRO_MONTHLY: "price_1TLAOTRtQY1gSYr0UWNvg5Gk", // $50/month
  BETA: "price_1TNvLeRtQY1gSYr0EBiN9w3l",         // $0 one-time
};

const BASE_URL = process.env.APP_BASE_URL || "https://positive-passion-production.up.railway.app";

const SUCCESS_URL = `${BASE_URL}/subscribe/success`;
const CANCEL_URL = `${BASE_URL}/subscribe/cancel`;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Missing env: STRIPE_SECRET_KEY");
  }
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

/**
 * Create a Stripe checkout session for the full plan.
 * $350 setup fee + $50/month with 30-day trial (setup fee covers first month).
 */
async function createSubscriptionCheckout(groupId, discordUserId) {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      { price: PRICES.SETUP_FEE, quantity: 1 },
      { price: PRICES.PRO_MONTHLY, quantity: 1 },
    ],
    subscription_data: {
      trial_period_days: 30,
      metadata: { group_id: groupId, discord_user_id: discordUserId },
    },
    metadata: { group_id: groupId, discord_user_id: discordUserId },
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
  });

  log.info("Checkout session created", { groupId, discordUserId, sessionId: session.id });
  return session;
}

/**
 * Create a $0 beta checkout session — 30 days free access.
 */
async function createBetaCheckout(groupId, discordUserId) {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: PRICES.BETA, quantity: 1 }],
    metadata: { group_id: groupId, discord_user_id: discordUserId, is_beta: "true" },
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
  });

  log.info("Beta checkout session created", { groupId, discordUserId });
  return session;
}

module.exports = { getStripe, PRICES, createSubscriptionCheckout, createBetaCheckout };
