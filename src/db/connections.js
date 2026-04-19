"use strict";

/**
 * db/connections.js
 * All queries against the gmail_connections table.
 * Table stores both Gmail OAuth connections and Yahoo IMAP connections.
 */

const { supabase } = require("../config");
const { createLogger } = require("../logger");

const log = createLogger("db:connections");

/**
 * Load all connections with status = 'connected'.
 * Used by the email polling loop.
 */
async function getActiveConnections() {
  const { data, error } = await supabase
    .from("gmail_connections")
    .select("*")
    .eq("status", "connected");

  if (error) {
    log.error("Failed to load active connections", error);
  }

  return { data, error };
}

/**
 * Load a single connection for a Discord user.
 * Returns null data (not an error) if none exists.
 */
async function getConnectionByDiscordUserId(discordUserId) {
  const { data, error } = await supabase
    .from("gmail_connections")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (error) {
    log.error("Failed to load connection by discord user", {
      discordUserId,
      error: error.message,
    });
  }

  return { data, error };
}

/**
 * Upsert a Yahoo connection record.
 * Conflict key: group_id + discord_user_id + email
 */
async function upsertYahooConnection(payload) {
  const { error } = await supabase
    .from("gmail_connections")
    .upsert(payload, {
      onConflict: "group_id,discord_user_id,email",
    });

  if (error) {
    log.error("Failed to upsert Yahoo connection", {
      discordUserId: payload.discord_user_id,
      error: error.message,
    });
  }

  return { error };
}

/**
 * Update Gmail OAuth tokens after a refresh.
 */
async function updateTokens(connectionId, { accessToken, refreshToken, expiry }) {
  const { error } = await supabase
    .from("gmail_connections")
    .update({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expiry: expiry,
    })
    .eq("id", connectionId);

  if (error) {
    log.error("Failed to update tokens", {
      connectionId,
      error: error.message,
    });
  }

  return { error };
}

/**
 * Update the yahoo_last_uid watermark for a connection.
 */
async function updateYahooLastUid(connectionId, uid) {
  const { error } = await supabase
    .from("gmail_connections")
    .update({ yahoo_last_uid: uid })
    .eq("id", connectionId);

  if (error) {
    log.error("Failed to update Yahoo last UID", {
      connectionId,
      uid,
      error: error.message,
    });
  }

  return { error };
}

/**
 * Delete all connection rows for a Discord user.
 * Used by /disconnect-email and /leave-group.
 */
async function deleteConnectionByDiscordUserId(discordUserId) {
  const { error } = await supabase
    .from("gmail_connections")
    .delete()
    .eq("discord_user_id", discordUserId);

  if (error) {
    log.error("Failed to delete connection", {
      discordUserId,
      error: error.message,
    });
  }

  return { error };
}

module.exports = {
  getActiveConnections,
  getConnectionByDiscordUserId,
  upsertYahooConnection,
  updateTokens,
  updateYahooLastUid,
  deleteConnectionByDiscordUserId,
};
