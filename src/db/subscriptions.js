"use strict";

/**
 * db/subscriptions.js
 * All queries against the group_subscriptions table.
 *
 * Table schema (run in Supabase SQL editor):
 *
 * create table group_subscriptions (
 *   id uuid default gen_random_uuid() primary key,
 *   group_id uuid references groups(id) not null unique,
 *   discord_user_id text not null,
 *   status text not null default 'inactive',
 *   plan text not null default 'none',
 *   stripe_customer_id text,
 *   stripe_subscription_id text,
 *   current_period_end timestamptz,
 *   grace_period_end timestamptz,
 *   is_beta boolean default false,
 *   created_at timestamptz default now(),
 *   updated_at timestamptz default now()
 * );
 *
 * Status values:
 *   'inactive'  — never paid
 *   'active'    — paid and current
 *   'trialing'  — in trial period (setup fee paid, first month free)
 *   'grace'     — payment failed, within 3-day grace period
 *   'suspended' — grace period expired, access blocked
 *   'beta'      — beta access granted, expires at current_period_end
 */

const { supabase } = require("../config");
const { createLogger } = require("../logger");

const log = createLogger("db:subscriptions");

/**
 * Get subscription for a group.
 */
async function getSubscriptionByGroupId(groupId) {
  const { data, error } = await supabase
    .from("group_subscriptions")
    .select("*")
    .eq("group_id", groupId)
    .maybeSingle();

  if (error) {
    log.error("Failed to load subscription", { groupId, error: error.message });
  }

  return { data, error };
}

/**
 * Check if a group has active access.
 * Returns true for: active, trialing, grace, beta (if not expired)
 */
async function groupHasAccess(groupId) {
  const { data, error } = await getSubscriptionByGroupId(groupId);

  if (error || !data) return false;

  const now = new Date();

  if (data.status === "active" || data.status === "trialing") return true;

  if (data.status === "grace") {
    const graceEnd = data.grace_period_end ? new Date(data.grace_period_end) : null;
    return graceEnd ? now < graceEnd : false;
  }

  if (data.status === "beta") {
    const periodEnd = data.current_period_end ? new Date(data.current_period_end) : null;
    return periodEnd ? now < periodEnd : false;
  }

  return false;
}

/**
 * Check if a group is in grace period (payment failed but still has access).
 */
async function groupInGracePeriod(groupId) {
  const { data, error } = await getSubscriptionByGroupId(groupId);
  if (error || !data) return false;
  if (data.status !== "grace") return false;
  const graceEnd = data.grace_period_end ? new Date(data.grace_period_end) : null;
  return graceEnd ? new Date() < graceEnd : false;
}

/**
 * Upsert subscription record.
 */
async function upsertSubscription(payload) {
  const { error } = await supabase
    .from("group_subscriptions")
    .upsert(
      { ...payload, updated_at: new Date().toISOString() },
      { onConflict: "group_id" }
    );

  if (error) {
    log.error("Failed to upsert subscription", { groupId: payload.group_id, error: error.message });
  }

  return { error };
}

/**
 * Activate a subscription after successful payment.
 */
async function activateSubscription(groupId, discordUserId, {
  stripeCustomerId,
  stripeSubscriptionId,
  status,
  plan,
  periodEnd,
  isBeta = false,
}) {
  return upsertSubscription({
    group_id: groupId,
    discord_user_id: discordUserId,
    status,
    plan,
    stripe_customer_id: stripeCustomerId || null,
    stripe_subscription_id: stripeSubscriptionId || null,
    current_period_end: periodEnd || null,
    grace_period_end: null,
    is_beta: isBeta,
  });
}

/**
 * Set a group into grace period (payment failed).
 * Grace period is 3 days from now.
 */
async function setGracePeriod(groupId) {
  const graceEnd = new Date();
  graceEnd.setDate(graceEnd.getDate() + 3);

  return upsertSubscription({
    group_id: groupId,
    status: "grace",
    grace_period_end: graceEnd.toISOString(),
  });
}

/**
 * Suspend a group (grace period expired).
 */
async function suspendSubscription(groupId) {
  return upsertSubscription({
    group_id: groupId,
    status: "suspended",
    grace_period_end: null,
  });
}

module.exports = {
  getSubscriptionByGroupId,
  groupHasAccess,
  groupInGracePeriod,
  upsertSubscription,
  activateSubscription,
  setGracePeriod,
  suspendSubscription,
};
