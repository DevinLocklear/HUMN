"use strict";

/**
 * db/events.js
 * All queries against the checkout_events table.
 */

const { supabase } = require("../config");
const { createLogger } = require("../logger");

const log = createLogger("db:events");

/**
 * Insert a single checkout event.
 * Returns the inserted row so callers can use it for webhook sending.
 */
async function insertCheckoutEvent(payload) {
  const { data, error } = await supabase
    .from("checkout_events")
    .insert(payload)
    .select()
    .single();

  if (error) {
    log.error("Failed to insert checkout event", {
      retailer: payload.retailer,
      discordUserId: payload.discord_user_id,
      error: error.message,
    });
  }

  return { data, error };
}

/**
 * Fetch checkout events for a group, with optional time range and retailer filter.
 * rangeValue: '7' | '20' | '30' | 'all'
 * retailerFilter: string | null
 * limit: number | null
 */
async function getFilteredEvents(groupId, rangeValue, retailerFilter, limit = null) {
  let query = supabase
    .from("checkout_events")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (rangeValue !== "all") {
    const since = new Date();
    since.setDate(since.getDate() - parseInt(rangeValue, 10));
    query = query.gte("created_at", since.toISOString());
  }

  if (retailerFilter) {
    query = query.ilike("retailer", retailerFilter);
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    log.error("Failed to load filtered events", {
      groupId,
      rangeValue,
      retailerFilter,
      error: error.message,
    });
  }

  return { data, error };
}

/**
 * Fetch 30-day checkout totals per user in a group.
 * Used to compute rank and spend for webhook embeds.
 */
async function getGroupSpendLast30Days(groupId) {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data, error } = await supabase
    .from("checkout_events")
    .select("discord_user_id, order_total")
    .eq("group_id", groupId)
    .gte("created_at", since.toISOString());

  if (error) {
    log.error("Failed to load 30-day group spend", {
      groupId,
      error: error.message,
    });
  }

  return { data, error };
}

module.exports = {
  insertCheckoutEvent,
  getFilteredEvents,
  getGroupSpendLast30Days,
};
