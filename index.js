"use strict";

require("dotenv").config();
require("./server");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");

const { supabase, GMAIL_AUTH_BASE_URL, ENABLE_TEST_EVENT } = require("./src/config");
const { createLogger } = require("./src/logger");
const { encrypt } = require("./src/crypto");
const { getMembershipByDiscordUserId, getMembershipInGroup, getGroupById, getGroupByOwnerId, getGroupByJoinCode, createGroup, setGroupWebhook, addMember, removeMember, getMemberCount } = require("./src/db/groups");
const { getConnectionByDiscordUserId, upsertYahooConnection, deleteConnectionByDiscordUserId } = require("./src/db/connections");
const { getFilteredEvents, getGroupSpendLast30Days, insertCheckoutEvent } = require("./src/db/events");
const { normalizeRetailerName, sumOrderTotals, averageOrderValue, buildRetailerBreakdown, buildTopProducts, buildDailyTrend, buildWeekdayBreakdown, computeUserRankAndSpend } = require("./src/analytics/compute");
const { formatMoney, formatDateTime, shortenText, formatRangeLabel, renderStatsDashboard, renderTrendDashboard } = require("./src/analytics/render");
const { buildSuccessEmbed, buildErrorEmbed, buildAnalyticsEmbed, buildCheckoutEmbed, buildHelpEmbedForGuest, buildHelpEmbedForMember, buildHelpEmbedForOwner } = require("./src/discord/embeds");
const notify = require("./src/discord/notify");
const { getSubscriptionByGroupId, groupHasAccess, groupInGracePeriod, activateSubscription } = require("./src/db/subscriptions");

// Bot owner ID — only this user can run /beta-activate
const BOT_OWNER_ID = process.env.BOT_OWNER_DISCORD_ID || "";

const log = createLogger("bot");

// ── Discord client ────────────────────────────────────────────────────────────

log.info("BOT STARTING...");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function normalizeRetailerFilter(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return null;
  const lower = trimmed.toLowerCase();
  if (lower === "pokemon" || lower === "pokemoncenter" || lower === "pokemon center") return "Pokemon Center";
  if (lower === "target") return "Target";
  if (lower === "walmart") return "Walmart";
  return trimmed;
}

function isValidYahooEmail(email) {
  return /^[^\s@]+@yahoo\.com$/i.test(email);
}

function isReasonableYahooAppPassword(value) {
  return typeof value === "string" && value.trim().length >= 8;
}

function requireOwner(interaction, membership) {
  if (membership?.role !== "owner") {
    interaction.editReply({ embeds: [buildErrorEmbed("Only the group owner can use this command.")] });
    return true;
  }
  return false;
}

async function sendWebhookWithRetry(url, payload, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) return response;
      log.warn("Webhook attempt failed", { attempt: i + 1, status: response.status });
    } catch (err) {
      log.warn("Webhook attempt error", { attempt: i + 1, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

// ── Command definitions ───────────────────────────────────────────────────────

const RANGE_CHOICES = [
  { name: "7 days", value: "7" },
  { name: "20 days", value: "20" },
  { name: "30 days", value: "30" },
  { name: "All time", value: "all" },
];

const commands = [
  new SlashCommandBuilder().setName("help").setDescription("View HUMN commands and setup help"),
  new SlashCommandBuilder().setName("setup").setDescription("Check your full HUMN setup status"),
  new SlashCommandBuilder()
    .setName("create-group").setDescription("Create your private group")
    .addStringOption((o) => o.setName("name").setDescription("Group name").setRequired(true)),
  new SlashCommandBuilder()
    .setName("join").setDescription("Join a group with a code")
    .addStringOption((o) => o.setName("code").setDescription("Group join code").setRequired(true)),
  new SlashCommandBuilder().setName("leave-group").setDescription("Leave your current group"),
  new SlashCommandBuilder().setName("disconnect-email").setDescription("Disconnect your current Gmail or Yahoo account"),
  new SlashCommandBuilder()
    .setName("set-webhook").setDescription("Save the Discord webhook for your group")
    .addStringOption((o) => o.setName("url").setDescription("Discord webhook URL").setRequired(true)),
  new SlashCommandBuilder().setName("connect-gmail").setDescription("Get your Gmail connection link"),
  new SlashCommandBuilder().setName("connect-yahoo").setDescription("Get Yahoo setup instructions"),
  new SlashCommandBuilder()
    .setName("save-yahoo").setDescription("Save your Yahoo email and app password")
    .addStringOption((o) => o.setName("email").setDescription("Your Yahoo email").setRequired(true))
    .addStringOption((o) => o.setName("app_password").setDescription("Yahoo app password").setRequired(true)),
  new SlashCommandBuilder().setName("status").setDescription("Check your email connection status"),
  new SlashCommandBuilder().setName("test-event").setDescription("Send a test checkout event"),

  new SlashCommandBuilder()
    .setName("subscribe")
    .setDescription("Subscribe to HUMN — $350 setup + $50/month"),

  new SlashCommandBuilder()
    .setName("subscription")
    .setDescription("Check your group subscription status"),

  new SlashCommandBuilder()
    .setName("beta-activate")
    .setDescription("Grant beta access to a group (bot owner only)")
    .addStringOption((o) =>
      o.setName("group_id").setDescription("Group ID to activate").setRequired(true)
    )
    .addUserOption((o) =>
      o.setName("user").setDescription("Group owner Discord user").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("stats").setDescription("View group analytics")
    .addStringOption((o) => o.setName("range").setDescription("Select time range").setRequired(true).addChoices(...RANGE_CHOICES))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter, or type all").setRequired(false)),
  new SlashCommandBuilder()
    .setName("leaderboard").setDescription("View top users by checkouts")
    .addStringOption((o) => o.setName("range").setDescription("Select time range").setRequired(true).addChoices(...RANGE_CHOICES))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter, or type all").setRequired(false)),
  new SlashCommandBuilder()
    .setName("recent-checkouts").setDescription("View recent checkout activity")
    .addIntegerOption((o) => o.setName("limit").setDescription("Number of recent checkouts to show").setRequired(false).setMinValue(1).setMaxValue(10))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter, or type all").setRequired(false)),
  new SlashCommandBuilder()
    .setName("user-stats").setDescription("View stats for a user in your group")
    .addStringOption((o) => o.setName("range").setDescription("Select time range").setRequired(true).addChoices(...RANGE_CHOICES))
    .addUserOption((o) => o.setName("user").setDescription("User to view stats for").setRequired(false))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter, or type all").setRequired(false)),
  new SlashCommandBuilder()
    .setName("top-products").setDescription("View the most purchased products in your group")
    .addStringOption((o) => o.setName("range").setDescription("Select time range").setRequired(true).addChoices(...RANGE_CHOICES))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter, or type all").setRequired(false))
    .addIntegerOption((o) => o.setName("limit").setDescription("Number of products to show").setRequired(false).setMinValue(1).setMaxValue(10)),
  new SlashCommandBuilder()
    .setName("trend-analytics").setDescription("View checkout trend analytics by day")
    .addStringOption((o) => o.setName("range").setDescription("Select time range").setRequired(true).addChoices(...RANGE_CHOICES))
    .addStringOption((o) => o.setName("retailer").setDescription("Optional retailer filter, or type all").setRequired(false)),
].map((c) => c.toJSON());

// ── Command registration ──────────────────────────────────────────────────────

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// Commands are registered via: node register-commands.js

// ── Interaction handler ───────────────────────────────────────────────────────

client.once("clientReady", () => {
  log.info(`Logged in as ${client.user.tag}`);
  notify.setClient(client);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const discordUserId = interaction.user.id;

  // ── /help ──────────────────────────────────────────────────────────────────
  if (commandName === "help") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const { data: membership, error } = await getMembershipByDiscordUserId(discordUserId);
      if (error) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load help.")] });
      if (!membership) return interaction.editReply({ embeds: [buildHelpEmbedForGuest()] });
      if (membership.role === "owner") return interaction.editReply({ embeds: [buildHelpEmbedForOwner()] });
      return interaction.editReply({ embeds: [buildHelpEmbedForMember()] });
    } catch (err) {
      log.error("/help failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load help.")] });
    }
  }

  // ── /setup ─────────────────────────────────────────────────────────────────
  if (commandName === "setup") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load setup status.")] });

      if (!membership) {
        return interaction.editReply({
          embeds: [buildAnalyticsEmbed({
            title: "🛠️ HUMN Setup",
            description: "You are not in a group yet.",
            fields: [
              { name: "Group", value: "❌ Not connected", inline: false },
              { name: "Next Step", value: "Run `/create-group name:YourGroup` to start a group, or `/join code:XXXXXX` if you already have an invite code.", inline: false },
            ],
          })],
        });
      }

      const { data: group, error: groupError } = await getGroupById(membership.group_id);
      if (groupError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load group setup.")] });

      const { data: emailConnection, error: emailError } = await getConnectionByDiscordUserId(discordUserId);
      if (emailError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load email setup.")] });

      const hasWebhook = Boolean(group?.discord_webhook_url);
      const hasEmail = Boolean(emailConnection?.email || emailConnection?.google_email);
      const isOwner = membership.role === "owner";
      const nextSteps = [];
      if (!hasWebhook && isOwner) nextSteps.push("Run `/set-webhook url:YOUR_WEBHOOK_URL`");
      if (!hasEmail) nextSteps.push("Run `/connect-gmail` or `/connect-yahoo`");
      if (!nextSteps.length) nextSteps.push("Everything looks good. You're ready to use HUMN.");

      const providerLabel = emailConnection?.provider
        ? emailConnection.provider.charAt(0).toUpperCase() + emailConnection.provider.slice(1)
        : null;

      return interaction.editReply({
        embeds: [buildAnalyticsEmbed({
          title: "🛠️ HUMN Setup",
          description: "Full setup health check",
          fields: [
            { name: "Group", value: group?.name ? `✅ ${group.name}` : "❌ Missing", inline: false },
            { name: "Role", value: membership.role === "owner" ? "👑 Owner" : "👤 Member", inline: true },
            { name: "Webhook", value: hasWebhook ? "✅ Connected" : "❌ Not connected", inline: true },
            { name: "Your Email", value: hasEmail ? `✅ ${emailConnection.email || emailConnection.google_email}${providerLabel ? ` (${providerLabel})` : ""}` : "❌ Not connected", inline: false },
            { name: "Next Step", value: nextSteps.join("\n"), inline: false },
          ],
        })],
      });
    } catch (err) {
      log.error("/setup failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load setup status.")] });
    }
  }

  // ── /create-group ──────────────────────────────────────────────────────────
  if (commandName === "create-group") {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.options.getString("name");
    try {
      const { data: existingGroup, error: existingError } = await getGroupByOwnerId(discordUserId);
      if (existingError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to check existing group.")] });
      if (existingGroup) return interaction.editReply({ embeds: [buildErrorEmbed("You already own a group.")] });

      const { data: existingMembership, error: membershipCheckError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipCheckError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to check existing membership.")] });
      if (existingMembership) return interaction.editReply({ embeds: [buildErrorEmbed("You are already in a group. Leave your current group before creating a new one.")] });

      const joinCode = generateJoinCode();
      const { data: group, error: groupError } = await createGroup({ name, ownerDiscordId: discordUserId, joinCode });
      if (groupError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to create group.")] });

      const { error: memberError } = await addMember({ groupId: group.id, discordUserId, role: "owner" });
      if (memberError) return interaction.editReply({ embeds: [buildErrorEmbed("Group created, but failed to create owner membership.")] });

      log.info("Group created", { groupId: group.id, name, ownerDiscordId: discordUserId });
      return interaction.editReply({ embeds: [buildSuccessEmbed("Group Created", `Your group **${name}** is now live.\n\n**Join Code:** \`${joinCode}\``)] });
    } catch (err) {
      log.error("/create-group failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Error creating group.")] });
    }
  }

  // ── /join ──────────────────────────────────────────────────────────────────
  if (commandName === "join") {
    await interaction.deferReply({ ephemeral: true });
    const code = interaction.options.getString("code").trim().toUpperCase();
    try {
      const { data: group, error: groupError } = await getGroupByJoinCode(code);
      if (groupError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find group.")] });
      if (!group) return interaction.editReply({ embeds: [buildErrorEmbed("Invalid join code.")] });

      const { data: existingMembership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to check membership.")] });
      if (existingMembership) return interaction.editReply({ embeds: [buildErrorEmbed("You are already in a group. Leave your current group before joining another.")] });

      const { error: insertError } = await addMember({ groupId: group.id, discordUserId, role: "member" });
      if (insertError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to join group.")] });

      log.info("Member joined group", { groupId: group.id, discordUserId });
      return interaction.editReply({ embeds: [buildSuccessEmbed("Joined Group", `You successfully joined **${group.name}**.`)] });
    } catch (err) {
      log.error("/join failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Error joining group.")] });
    }
  }

  // ── /leave-group ───────────────────────────────────────────────────────────
  if (commandName === "leave-group") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your group.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });
      if (membership.role === "owner") return interaction.editReply({ embeds: [buildErrorEmbed("Group owners cannot leave their group. Transfer ownership or delete the group first.")] });

      const { error: deleteMembershipError } = await removeMember(discordUserId);
      if (deleteMembershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to leave group.")] });

      await deleteConnectionByDiscordUserId(discordUserId);

      log.info("Member left group", { discordUserId });
      return interaction.editReply({ embeds: [buildSuccessEmbed("Left Group", "You have successfully left the group and your email connection was removed.")] });
    } catch (err) {
      log.error("/leave-group failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Error leaving group.")] });
    }
  }

  // ── /disconnect-email ──────────────────────────────────────────────────────
  if (commandName === "disconnect-email") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });

      const { data: connection, error: connectionError } = await getConnectionByDiscordUserId(discordUserId);
      if (connectionError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load your email connection.")] });
      if (!connection) return interaction.editReply({ embeds: [buildErrorEmbed("No connected email account was found.")] });

      const providerLabel = connection.provider
        ? connection.provider.charAt(0).toUpperCase() + connection.provider.slice(1)
        : "Email";
      const connectedAddress = connection.email || connection.google_email;

      const { error: deleteError } = await deleteConnectionByDiscordUserId(discordUserId);
      if (deleteError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to disconnect your email account.")] });

      log.info("Email disconnected", { discordUserId, provider: connection.provider });
      return interaction.editReply({ embeds: [buildSuccessEmbed("Email Disconnected", `${providerLabel} connection removed for **${connectedAddress}**.`)] });
    } catch (err) {
      log.error("/disconnect-email failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to disconnect email.")] });
    }
  }

  // ── /set-webhook ───────────────────────────────────────────────────────────
  if (commandName === "set-webhook") {
    await interaction.deferReply({ ephemeral: true });
    const webhookUrl = interaction.options.getString("url").trim();

    if (!webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
      return interaction.editReply({ embeds: [buildErrorEmbed("That does not look like a valid Discord webhook URL.")] });
    }

    try {
      const { data: ownedGroup, error: ownedGroupError } = await getGroupByOwnerId(discordUserId);
      if (ownedGroupError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your group.")] });
      if (!ownedGroup) return interaction.editReply({ embeds: [buildErrorEmbed("You do not own a group yet.")] });

      const testResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "✅ HUMN webhook connected successfully." }),
      });

      if (!testResponse.ok) return interaction.editReply({ embeds: [buildErrorEmbed("Webhook test failed. Make sure the webhook URL is correct.")] });

      const { error: updateError } = await setGroupWebhook(ownedGroup.id, webhookUrl);
      if (updateError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to save webhook.")] });

      log.info("Webhook set", { groupId: ownedGroup.id, discordUserId });
      return interaction.editReply({ embeds: [buildSuccessEmbed("Webhook Connected", "Your group webhook was saved and tested successfully.")] });
    } catch (err) {
      log.error("/set-webhook failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Error saving webhook.")] });
    }
  }

  // ── /connect-gmail ─────────────────────────────────────────────────────────
  if (commandName === "connect-gmail") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });

      const authUrl =
        `${GMAIL_AUTH_BASE_URL}/auth/google` +
        `?discord_user_id=${encodeURIComponent(discordUserId)}` +
        `&group_id=${encodeURIComponent(membership.group_id)}`;

      return interaction.editReply({ embeds: [buildSuccessEmbed("Connect Gmail", `Use the link below to connect your Gmail account.\n\n${authUrl}`)] });
    } catch (err) {
      log.error("/connect-gmail failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to generate Gmail connection link.")] });
    }
  }

  // ── /connect-yahoo ─────────────────────────────────────────────────────────
  if (commandName === "connect-yahoo") {
    await interaction.deferReply({ ephemeral: true });
    return interaction.editReply({
      embeds: [buildSuccessEmbed(
        "Connect Yahoo",
        "**Step 1:** Go to https://login.yahoo.com/account/security\n" +
        "**Step 2:** Click **Generate App Password**\n" +
        "**Step 3:** Select **Other App** → type `HUMN`\n" +
        "**Step 4:** Copy the password\n" +
        "**Step 5:** Run `/save-yahoo email:your@yahoo.com app_password:YOUR_PASSWORD`"
      )],
    });
  }

  // ── /save-yahoo ────────────────────────────────────────────────────────────
  if (commandName === "save-yahoo") {
    await interaction.deferReply({ ephemeral: true });
    const email = interaction.options.getString("email").trim().toLowerCase();
    const appPassword = interaction.options.getString("app_password").trim();

    if (!isValidYahooEmail(email)) return interaction.editReply({ embeds: [buildErrorEmbed("Please enter a valid Yahoo email address.")] });
    if (!isReasonableYahooAppPassword(appPassword)) return interaction.editReply({ embeds: [buildErrorEmbed("Please enter a valid Yahoo app password.")] });

    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });

      const payload = {
        group_id: membership.group_id,
        discord_user_id: discordUserId,
        email,
        google_email: email,
        status: "connected",
        provider: "yahoo",
        yahoo_app_password: encrypt(appPassword),
        created_at: new Date().toISOString(),
      };

      const { error: upsertError } = await upsertYahooConnection(payload);
      if (upsertError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to save Yahoo connection.")] });

      log.info("Yahoo connection saved", { discordUserId, email });
      return interaction.editReply({ embeds: [buildSuccessEmbed("Yahoo Connected", `Yahoo connected for **${email}**.`)] });
    } catch (err) {
      log.error("/save-yahoo failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to save Yahoo connection.")] });
    }
  }

  // ── /status ────────────────────────────────────────────────────────────────
  if (commandName === "status") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const { data: connection, error } = await getConnectionByDiscordUserId(discordUserId);
      if (error) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to check email status.")] });
      if (!connection) return interaction.editReply({ embeds: [buildErrorEmbed("No email account connected yet.")] });

      const providerLabel = connection.provider
        ? connection.provider.charAt(0).toUpperCase() + connection.provider.slice(1)
        : "Email";
      const statusLabel = connection.status === "disconnected" ? " ⚠️ Disconnected" : "";

      return interaction.editReply({
        embeds: [buildSuccessEmbed(
          `${providerLabel} Connected${statusLabel}`,
          `Connected as: **${connection.email || connection.google_email}**${connection.status === "disconnected" ? "\n\n⚠️ Your connection was disabled. Please run `/save-yahoo` or `/connect-gmail` to reconnect." : ""}`
        )],
      });
    } catch (err) {
      log.error("/status failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Error checking status.")] });
    }
  }

  // ── /test-event ────────────────────────────────────────────────────────────
  if (commandName === "test-event") {
    await interaction.deferReply({ ephemeral: true });

    if (!ENABLE_TEST_EVENT) return interaction.editReply({ embeds: [buildErrorEmbed("Test events are disabled in this environment.")] });

    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });

      const denied = requireOwner(interaction, membership);
      if (denied) return;

      const { data: group, error: groupError } = await getGroupById(membership.group_id);
      if (groupError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your group.")] });
      if (!group?.discord_webhook_url) return interaction.editReply({ embeds: [buildErrorEmbed("No webhook is set for this group.")] });

      const eventPayload = {
        group_id: group.id,
        discord_user_id: discordUserId,
        retailer: "Target",
        product_name: "Pokemon Booster Pack",
        product_url: "https://www.target.com/p/pokemon-trading-card-game-scarlet-violet-3-booster-pack/-/A-90000000",
        product_image: "https://target.scene7.com/is/image/Target/GUEST_example",
        quantity: 1,
        order_total: 5.99,
        source: "test",
        created_at: new Date().toISOString(),
      };

      const { data: insertedEvent, error: eventInsertError } = await insertCheckoutEvent(eventPayload);
      if (eventInsertError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to save test event.")] });

      const { data: spendEvents } = await getGroupSpendLast30Days(group.id);
      const { rank, spend } = computeUserRankAndSpend(spendEvents || [], discordUserId);
      const embed = buildCheckoutEmbed(insertedEvent, discordUserId, { rank, spend });

      const webhookResponse = await sendWebhookWithRetry(group.discord_webhook_url, { embeds: [embed.toJSON()] });
      if (!webhookResponse) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to send test event to webhook.")] });

      log.info("Test event sent", { groupId: group.id, discordUserId });
      return interaction.editReply({ embeds: [buildSuccessEmbed("Test Event Sent", "A test checkout event was sent and saved.")] });
    } catch (err) {
      log.error("/test-event failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to send test event.")] });
    }
  }

  // ── /stats ─────────────────────────────────────────────────────────────────
  if (commandName === "stats") {
    await interaction.deferReply({ ephemeral: true });
    const range = interaction.options.getString("range");
    const retailerFilter = normalizeRetailerFilter(interaction.options.getString("retailer"));

    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });

      const denied = requireOwner(interaction, membership);
      if (denied) return;

      const { data: events, error: eventsError } = await getFilteredEvents(membership.group_id, range, retailerFilter);
      if (eventsError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load stats.")] });

      const { count: memberCount, error: memberCountError } = await getMemberCount(membership.group_id);
      if (memberCountError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load member stats.")] });

      const evList = events || [];
      const totalCheckouts = evList.length;
      const totalSpend = sumOrderTotals(evList);
      const avgValue = averageOrderValue(evList);

      const retailerCounts = {};
      const userCounts = {};
      for (const e of evList) {
        const r = normalizeRetailerName(e.retailer);
        retailerCounts[r] = (retailerCounts[r] || 0) + 1;
        userCounts[e.discord_user_id] = (userCounts[e.discord_user_id] || 0) + 1;
      }

      const topRetailer = Object.entries(retailerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "None";
      const topUserId = Object.entries(userCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const uniqueUsers = Object.keys(userCounts).length;
      const retailerBreakdownText = buildRetailerBreakdown(evList).slice(0, 5).map(([r, c]) => `${r}: ${c}`).join("\n") || "No retailer data";
      const latestEvent = evList[0];

      // Fetch top user display name so it shows inside the dashboard box
      let topUserDisplay = "None";
      if (topUserId) {
        try {
          const member = await interaction.guild?.members.fetch(topUserId);
          topUserDisplay = member?.displayName || member?.user?.username || topUserId;
        } catch {
          topUserDisplay = topUserId;
        }
      }

      const statsDashboard = renderStatsDashboard({ totalCheckouts, totalSpend, avgValue, memberCount: memberCount || 0, uniqueUsers, topRetailer, topUserDisplay, retailerBreakdownText, latestEvent });

      return interaction.editReply({
        embeds: [buildAnalyticsEmbed({
          title: `📊 ${interaction.guild?.name || "Group"} Stats`,
          description: `${formatRangeLabel(range)} analytics snapshot${retailerFilter ? ` • Retailer: ${retailerFilter}` : ""}`,
          fields: [
            { name: "Dashboard", value: statsDashboard, inline: false },
          ],
        })],
      });
    } catch (err) {
      log.error("/stats failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load stats.")] });
    }
  }

  // ── /leaderboard ───────────────────────────────────────────────────────────
  if (commandName === "leaderboard") {
    await interaction.deferReply({ ephemeral: true });
    const range = interaction.options.getString("range");
    const retailerFilter = normalizeRetailerFilter(interaction.options.getString("retailer"));

    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });

      const denied = requireOwner(interaction, membership);
      if (denied) return;

      const { data: events, error: eventsError } = await getFilteredEvents(membership.group_id, range, retailerFilter);
      if (eventsError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load leaderboard.")] });

      const userStats = {};
      for (const e of events || []) {
        if (!userStats[e.discord_user_id]) userStats[e.discord_user_id] = { count: 0, spend: 0 };
        userStats[e.discord_user_id].count += 1;
        userStats[e.discord_user_id].spend += Number(e.order_total || 0);
      }

      const sortedUsers = Object.entries(userStats)
        .sort((a, b) => b[1].count !== a[1].count ? b[1].count - a[1].count : b[1].spend - a[1].spend)
        .slice(0, 10);

      const description = sortedUsers.length > 0
        ? sortedUsers.map(([id, stats], i) => {
            const avg = stats.count > 0 ? stats.spend / stats.count : 0;
            return `**#${i + 1}** <@${id}>\n${stats.count} checkouts • ${formatMoney(stats.spend)} spent • avg ${formatMoney(avg)}`;
          }).join("\n\n")
        : "No data yet.";

      return interaction.editReply({
        embeds: [buildAnalyticsEmbed({
          title: `🏆 ${interaction.guild?.name || "Group"} Leaderboard (${formatRangeLabel(range)})`,
          description: retailerFilter ? `${description}\n\n**Retailer Filter:** ${retailerFilter}` : description,
          fields: [],
        })],
      });
    } catch (err) {
      log.error("/leaderboard failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load leaderboard.")] });
    }
  }

  // ── /recent-checkouts ──────────────────────────────────────────────────────
  if (commandName === "recent-checkouts") {
    await interaction.deferReply({ ephemeral: true });
    const limit = interaction.options.getInteger("limit") || 5;
    const retailerFilter = normalizeRetailerFilter(interaction.options.getString("retailer"));

    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });

      const { data: events, error: eventsError } = await getFilteredEvents(membership.group_id, "all", retailerFilter, limit);
      if (eventsError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load recent checkouts.")] });

      const description = events?.length > 0
        ? events.map((e, i) =>
            `**#${i + 1}** ${normalizeRetailerName(e.retailer)} • ${shortenText(e.product_name, 75)}\n` +
            `${formatMoney(e.order_total)} • Qty ${e.quantity || 1} • <@${e.discord_user_id}> • ${formatDateTime(e.created_at)}`
          ).join("\n\n")
        : "No recent checkout activity found.";

      return interaction.editReply({
        embeds: [buildAnalyticsEmbed({
          title: `🧾 ${interaction.guild?.name || "Group"} Recent Checkouts`,
          description: retailerFilter ? `${description}\n\n**Retailer Filter:** ${retailerFilter}` : description,
          fields: [],
        })],
      });
    } catch (err) {
      log.error("/recent-checkouts failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load recent checkouts.")] });
    }
  }

  // ── /user-stats ────────────────────────────────────────────────────────────
  if (commandName === "user-stats") {
    await interaction.deferReply({ ephemeral: true });
    const selectedUser = interaction.options.getUser("user") || interaction.user;
    const targetUserId = selectedUser.id;
    const range = interaction.options.getString("range");
    const retailerFilter = normalizeRetailerFilter(interaction.options.getString("retailer"));

    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });

      if (membership.role !== "owner" && targetUserId !== discordUserId) {
        return interaction.editReply({ embeds: [buildErrorEmbed("Members can only view their own stats.")] });
      }

      const { data: targetMembership, error: targetMembershipError } = await getMembershipInGroup(membership.group_id, targetUserId);
      if (targetMembershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to verify the selected user.")] });
      if (!targetMembership) return interaction.editReply({ embeds: [buildErrorEmbed("That user is not in your group.")] });

      const { data: events, error: eventsError } = await getFilteredEvents(membership.group_id, range, retailerFilter);
      if (eventsError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load user stats.")] });

      const userEvents = (events || []).filter((e) => e.discord_user_id === targetUserId);
      const totalCheckouts = userEvents.length;
      const totalSpend = sumOrderTotals(userEvents);
      const avgValue = averageOrderValue(userEvents);
      const latestEvent = userEvents[0] || null;

      const retailerCounts = {};
      for (const e of userEvents) {
        const r = normalizeRetailerName(e.retailer);
        retailerCounts[r] = (retailerCounts[r] || 0) + 1;
      }

      const favoriteRetailer = Object.entries(retailerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "None";
      const retailerBreakdownText = Object.entries(retailerCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([r, c]) => `${r}: ${c}`).join("\n") || "No retailer data";

      return interaction.editReply({
        embeds: [buildAnalyticsEmbed({
          title: `📈 ${selectedUser.username} Stats`,
          description: `${formatRangeLabel(range)} user snapshot${retailerFilter ? ` • Retailer: ${retailerFilter}` : ""}`,
          fields: [
            { name: "User", value: `<@${targetUserId}>`, inline: true },
            { name: "Total Checkouts", value: String(totalCheckouts), inline: true },
            { name: "Favorite Retailer", value: favoriteRetailer, inline: true },
            { name: "Total Spend", value: formatMoney(totalSpend), inline: true },
            { name: "Average Order Value", value: formatMoney(avgValue), inline: true },
            { name: "Retailer Breakdown", value: retailerBreakdownText, inline: false },
            {
              name: "Latest Checkout",
              value: latestEvent
                ? `${normalizeRetailerName(latestEvent.retailer)} • ${shortenText(latestEvent.product_name, 80)} • ${formatMoney(latestEvent.order_total)} • ${formatDateTime(latestEvent.created_at)}`
                : "No events found for this user",
              inline: false,
            },
          ],
        })],
      });
    } catch (err) {
      log.error("/user-stats failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load user stats.")] });
    }
  }

  // ── /top-products ──────────────────────────────────────────────────────────
  if (commandName === "top-products") {
    await interaction.deferReply({ ephemeral: true });
    const range = interaction.options.getString("range");
    const retailerFilter = normalizeRetailerFilter(interaction.options.getString("retailer"));
    const limit = interaction.options.getInteger("limit") || 5;

    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });

      const denied = requireOwner(interaction, membership);
      if (denied) return;

      const { data: events, error: eventsError } = await getFilteredEvents(membership.group_id, range, retailerFilter);
      if (eventsError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load top products.")] });

      const topProducts = buildTopProducts(events || []).slice(0, limit);
      const description = topProducts.length > 0
        ? topProducts.map((p, i) =>
            `**#${i + 1}** ${shortenText(p.product_name, 75)}\n` +
            `${p.count} checkouts • ${p.quantity} qty • ${formatMoney(p.spend)} • ${p.retailer}`
          ).join("\n\n")
        : "No product data yet.";

      return interaction.editReply({
        embeds: [buildAnalyticsEmbed({
          title: `📦 ${interaction.guild?.name || "Group"} Top Products`,
          description: `${formatRangeLabel(range)} product rankings${retailerFilter ? ` • Retailer: ${retailerFilter}` : ""}\n\n${description}`,
          fields: [],
        })],
      });
    } catch (err) {
      log.error("/top-products failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load top products.")] });
    }
  }

  // ── /trend-analytics ───────────────────────────────────────────────────────
  if (commandName === "trend-analytics") {
    await interaction.deferReply({ ephemeral: true });
    const range = interaction.options.getString("range");
    const retailerFilter = normalizeRetailerFilter(interaction.options.getString("retailer"));

    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });

      const denied = requireOwner(interaction, membership);
      if (denied) return;

      const { data: events, error: eventsError } = await getFilteredEvents(membership.group_id, range, retailerFilter);
      if (eventsError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load trend analytics.")] });

      const dailyTrend = buildDailyTrend(events || []);
      const weekdayBreakdown = buildWeekdayBreakdown(events || []);
      const trendDashboard = renderTrendDashboard(dailyTrend, weekdayBreakdown);

      return interaction.editReply({
        embeds: [buildAnalyticsEmbed({
          title: `📈 ${interaction.guild?.name || "Group"} Trend Analytics`,
          description: `${formatRangeLabel(range)} checkout trends${retailerFilter ? ` • Retailer: ${retailerFilter}` : ""}`,
          fields: [{ name: "Trend Dashboard", value: trendDashboard, inline: false }],
        })],
      });
    } catch (err) {
      log.error("/trend-analytics failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load trend analytics.")] });
    }
  }

  // ── /subscribe ─────────────────────────────────────────────────────────────
  if (commandName === "subscribe") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You need to create a group first with `/create-group`.")] });
      if (membership.role !== "owner") return interaction.editReply({ embeds: [buildErrorEmbed("Only the group owner can manage the subscription.")] });

      // Check if already subscribed
      const { data: existingSub } = await getSubscriptionByGroupId(membership.group_id);
      if (existingSub && ["active", "trialing", "beta"].includes(existingSub.status)) {
        return interaction.editReply({ embeds: [buildSuccessEmbed("Already Subscribed", `Your group is on the **${existingSub.plan}** plan and active. Use \`/subscription\` to see details.`)] });
      }

      const { createSubscriptionCheckout } = require('./src/stripe');
      const session = await createSubscriptionCheckout(membership.group_id, discordUserId);

      return interaction.editReply({
        embeds: [buildAnalyticsEmbed({
          title: "🚀 Subscribe to HUMN",
          description:
            "**HUMN Pro** — $350 setup fee + $50/month\n\n" +
            "Your setup fee covers your first month. Billing begins after 30 days.\n\n" +
            `**[Click here to complete payment](${session.url})**\n\n` +
            "Once payment is confirmed your group will be activated automatically.",
          fields: [],
        })],
      });
    } catch (err) {
      log.error("/subscribe failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to create checkout session.")] });
    }
  }

  // ── /subscription ──────────────────────────────────────────────────────────
  if (commandName === "subscription") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const { data: membership, error: membershipError } = await getMembershipByDiscordUserId(discordUserId);
      if (membershipError) return interaction.editReply({ embeds: [buildErrorEmbed("Failed to find your membership.")] });
      if (!membership) return interaction.editReply({ embeds: [buildErrorEmbed("You are not in a group.")] });
      if (membership.role !== "owner") return interaction.editReply({ embeds: [buildErrorEmbed("Only the group owner can view subscription details.")] });

      const { data: sub } = await getSubscriptionByGroupId(membership.group_id);

      if (!sub || sub.status === "inactive") {
        return interaction.editReply({
          embeds: [buildAnalyticsEmbed({
            title: "💳 Subscription Status",
            description: "Your group does not have an active subscription.\n\nRun `/subscribe` to get started.",
            fields: [],
          })],
        });
      }

      const statusEmoji = {
        active: "✅",
        trialing: "🔄",
        grace: "⚠️",
        suspended: "❌",
        beta: "🧪",
        inactive: "❌",
      }[sub.status] || "❓";

      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end).toLocaleDateString()
        : "N/A";

      const graceEnd = sub.grace_period_end
        ? new Date(sub.grace_period_end).toLocaleDateString()
        : null;

      return interaction.editReply({
        embeds: [buildAnalyticsEmbed({
          title: "💳 Subscription Status",
          description: `${statusEmoji} **${sub.plan?.toUpperCase() || "Unknown"}** plan`,
          fields: [
            { name: "Status", value: `${statusEmoji} ${sub.status}`, inline: true },
            { name: "Plan", value: sub.plan || "N/A", inline: true },
            { name: "Period End", value: periodEnd, inline: true },
            ...(graceEnd ? [{ name: "⚠️ Grace Period Ends", value: graceEnd, inline: true }] : []),
          ],
        })],
      });
    } catch (err) {
      log.error("/subscription failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to load subscription status.")] });
    }
  }

  // ── /beta-activate ─────────────────────────────────────────────────────────
  if (commandName === "beta-activate") {
    await interaction.deferReply({ ephemeral: true });

    if (discordUserId !== BOT_OWNER_ID) {
      return interaction.editReply({ embeds: [buildErrorEmbed("This command is restricted to the bot owner.")] });
    }

    const targetGroupId = interaction.options.getString("group_id");
    const targetUser = interaction.options.getUser("user");

    try {
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + 30);

      await activateSubscription(targetGroupId, targetUser.id, {
        status: "beta",
        plan: "beta",
        periodEnd: periodEnd.toISOString(),
        isBeta: true,
      });

      // DM the group owner to let them know
      const { EmbedBuilder } = require("discord.js");
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🧪 HUMN Beta Access Activated")
        .setDescription(
          "You have been granted **30 days of free beta access** to HUMN.\n\n" +
          "Your group is now fully active. Run `/setup` in your server to get started.\n\n" +
          "At the end of your beta period, run `/subscribe` to continue with HUMN Pro."
        )
        .setFooter({ text: "HUMN Beta", iconURL: "https://i.imgur.com/ywgtHOK.png" });

      await notify.sendDM(targetUser.id, embed);

      log.info("Beta access granted", { groupId: targetGroupId, discordUserId: targetUser.id });
      return interaction.editReply({ embeds: [buildSuccessEmbed("Beta Access Granted", `Beta access activated for <@${targetUser.id}> — 30 days from today.`)] });
    } catch (err) {
      log.error("/beta-activate failed", err);
      return interaction.editReply({ embeds: [buildErrorEmbed("Failed to activate beta access.")] });
    }
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  await client.login(process.env.DISCORD_TOKEN);
})();
