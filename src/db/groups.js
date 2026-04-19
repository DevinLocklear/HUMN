"use strict";

/**
 * db/groups.js
 * All queries against the groups and group_members tables.
 */

const { supabase } = require("../config");
const { createLogger } = require("../logger");

const log = createLogger("db:groups");

// ── groups table ──────────────────────────────────────────────────────────────

async function getGroupById(groupId) {
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();

  if (error) {
    log.error("Failed to load group by id", { groupId, error: error.message });
  }

  return { data, error };
}

async function getGroupByOwnerId(discordUserId) {
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("owner_discord_id", discordUserId)
    .maybeSingle();

  if (error) {
    log.error("Failed to load group by owner", {
      discordUserId,
      error: error.message,
    });
  }

  return { data, error };
}

async function getGroupByJoinCode(joinCode) {
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("join_code", joinCode)
    .maybeSingle();

  if (error) {
    log.error("Failed to load group by join code", { error: error.message });
  }

  return { data, error };
}

async function createGroup({ name, ownerDiscordId, joinCode }) {
  const { data, error } = await supabase
    .from("groups")
    .insert({
      name,
      owner_discord_id: ownerDiscordId,
      join_code: joinCode,
    })
    .select()
    .single();

  if (error) {
    log.error("Failed to create group", {
      ownerDiscordId,
      error: error.message,
    });
  }

  return { data, error };
}

async function setGroupWebhook(groupId, webhookUrl) {
  const { error } = await supabase
    .from("groups")
    .update({ discord_webhook_url: webhookUrl })
    .eq("id", groupId);

  if (error) {
    log.error("Failed to set group webhook", { groupId, error: error.message });
  }

  return { error };
}

async function getGroupWebhook(groupId) {
  const { data, error } = await supabase
    .from("groups")
    .select("discord_webhook_url")
    .eq("id", groupId)
    .maybeSingle();

  if (error) {
    log.error("Failed to load group webhook", { groupId, error: error.message });
  }

  return { data, error };
}

// ── group_members table ───────────────────────────────────────────────────────

async function getMembershipByDiscordUserId(discordUserId) {
  const { data, error } = await supabase
    .from("group_members")
    .select("group_id, role")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (error) {
    log.error("Failed to load membership", {
      discordUserId,
      error: error.message,
    });
  }

  return { data, error };
}

async function getMembershipInGroup(groupId, discordUserId) {
  const { data, error } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (error) {
    log.error("Failed to verify membership in group", {
      groupId,
      discordUserId,
      error: error.message,
    });
  }

  return { data, error };
}

async function addMember({ groupId, discordUserId, role }) {
  const { error } = await supabase
    .from("group_members")
    .insert({ group_id: groupId, discord_user_id: discordUserId, role });

  if (error) {
    log.error("Failed to add member", {
      groupId,
      discordUserId,
      error: error.message,
    });
  }

  return { error };
}

async function removeMember(discordUserId) {
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("discord_user_id", discordUserId);

  if (error) {
    log.error("Failed to remove member", {
      discordUserId,
      error: error.message,
    });
  }

  return { error };
}

async function getMemberCount(groupId) {
  const { count, error } = await supabase
    .from("group_members")
    .select("*", { count: "exact", head: true })
    .eq("group_id", groupId);

  if (error) {
    log.error("Failed to count members", { groupId, error: error.message });
  }

  return { count, error };
}

module.exports = {
  getGroupById,
  getGroupByOwnerId,
  getGroupByJoinCode,
  createGroup,
  setGroupWebhook,
  getGroupWebhook,
  getMembershipByDiscordUserId,
  getMembershipInGroup,
  addMember,
  removeMember,
  getMemberCount,
};
