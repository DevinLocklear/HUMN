"use strict";

/**
 * db/dedupe.js
 * Queries against the processed_gmail_messages table.
 * Prevents the same email from being processed more than once per connection.
 *
 * Used for both Gmail message IDs and Yahoo UIDs (prefixed "yahoo-{uid}").
 */

const { supabase } = require("../config");
const { createLogger } = require("../logger");

const log = createLogger("db:dedupe");

/**
 * Returns true if this message has already been processed for this connection.
 * Fails OPEN (returns false) on error — we'd rather double-check than skip.
 */
async function wasMessageProcessed(connectionId, messageId) {
  const { data, error } = await supabase
    .from("processed_gmail_messages")
    .select("id")
    .eq("gmail_connection_id", connectionId)
    .eq("gmail_message_id", messageId)
    .maybeSingle();

  if (error) {
    log.error("Dedupe check failed — treating as unprocessed", {
      connectionId,
      messageId,
      error: error.message,
    });
    // Fail open: let it be processed again rather than silently skipping
    return false;
  }

  return Boolean(data);
}

/**
 * Mark a message as processed.
 * Uses upsert so a double-mark is safe.
 */
async function markMessageProcessed(connectionId, messageId) {
  const { error } = await supabase
    .from("processed_gmail_messages")
    .upsert(
      {
        gmail_connection_id: connectionId,
        gmail_message_id: messageId,
      },
      {
        onConflict: "gmail_connection_id,gmail_message_id",
      }
    );

  if (error) {
    log.error("Failed to mark message as processed", {
      connectionId,
      messageId,
      error: error.message,
    });
  }

  return { error };
}

module.exports = {
  wasMessageProcessed,
  markMessageProcessed,
};
