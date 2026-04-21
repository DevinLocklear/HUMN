"use strict";

/**
 * discord/embeds.js
 * All Discord EmbedBuilder factories in one place.
 * Single source of truth for HUMN embed styling.
 */

const { EmbedBuilder } = require("discord.js");
const { formatMoney, formatDateTime, shortenText } = require("../analytics/render");

const HUMN_ICON = "https://i.imgur.com/ywgtHOK.png";

function normalizeRetailerName(retailer) {
  const value = String(retailer || "").trim().toLowerCase();
  if (value === "pokemoncenter" || value === "pokemon center") return "Pokemon Center";
  if (value === "target") return "Target";
  if (value === "walmart") return "Walmart";
  return retailer || "Unknown Retailer";
}

// ── Base builders ─────────────────────────────────────────────────────────────

function buildSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "HUMN", iconURL: HUMN_ICON });
}

function buildErrorEmbed(message) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Action Failed")
    .setDescription(message)
    .setFooter({ text: "HUMN", iconURL: HUMN_ICON });
}

const SOCIAL_LINKS_FIELD = {
  name: "​",
  value: "[𝕏 @UseHUMN](https://x.com/UseHUMN) • [🌐 humnbot.com](https://www.humnbot.com)",
  inline: false,
};

function buildAnalyticsEmbed({ title, description, fields }) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .setThumbnail(HUMN_ICON)
    .setFooter({ text: "HUMN Analytics", iconURL: HUMN_ICON });
  if (fields?.length) embed.addFields(fields);
  embed.addFields(SOCIAL_LINKS_FIELD);
  return embed;
}

// ── Checkout embed (for /test-event) ─────────────────────────────────────────

function buildCheckoutEmbed(event, discordUserId, { rank, spend }) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`Successful Checkout | ${normalizeRetailerName(event.retailer)}`)
    .addFields(
      { name: "User", value: `<@${discordUserId}>`, inline: false },
      {
        name: "Product",
        value: event.product_url
          ? `[${shortenText(event.product_name || "Unknown Product", 120)}](${event.product_url})`
          : shortenText(event.product_name || "Unknown Product", 120),
        inline: false,
      },
      { name: "Price", value: formatMoney(event.order_total), inline: true },
      { name: "Quantity", value: String(event.quantity || 1), inline: true },
      { name: "Checkout Time", value: formatDateTime(event.created_at), inline: false },
      { name: "🏆 Rank (30d)", value: rank ? `#${rank}` : "N/A", inline: true },
      { name: "💰 Spend (30d)", value: formatMoney(spend || 0), inline: true }
    )
    .setFooter({ text: "HUMN Beta • Real-Time Checkout Feed", iconURL: HUMN_ICON });

  if (event.product_image && !String(event.product_image).includes("example")) {
    embed.setThumbnail(event.product_image);
  }

  return embed;
}

// ── Help embeds ───────────────────────────────────────────────────────────────

function buildHelpEmbedForGuest() {
  return buildAnalyticsEmbed({
    title: "📘 HUMN Help",
    description: "Get started with HUMN",
    fields: [
      {
        name: "Start Here",
        value: "Use `/create-group name:YourGroup` to create your own group, or `/join code:XXXXXX` if you have an invite code.",
        inline: false,
      },
      {
        name: "After Joining",
        value: "Run `/setup` to see what is connected and what still needs to be finished.",
        inline: false,
      },
      {
        name: "Main Commands",
        value: "`/create-group`\n`/join`\n`/setup`\n`/connect-gmail`\n`/connect-yahoo`\n`/status`\n`/disconnect-email`",
        inline: false,
      },
    ],
  });
}

function buildHelpEmbedForMember() {
  return buildAnalyticsEmbed({
    title: "📘 HUMN Help • Member",
    description: "Your personal commands and setup tools",
    fields: [
      {
        name: "Setup",
        value: "`/setup` — full setup check\n`/connect-gmail` — connect Gmail\n`/connect-yahoo` — connect Yahoo\n`/status` — see your email status\n`/disconnect-email` — remove your email connection\n`/leave-group` — leave your current group",
        inline: false,
      },
      {
        name: "Your Analytics",
        value: "`/user-stats range:30` — view your stats\n`/recent-checkouts` — view the public checkout log",
        inline: false,
      },
      {
        name: "Notes",
        value: "Members can view their own stats and the group checkout feed. Group-wide analytics are owner-only.",
        inline: false,
      },
    ],
  });
}

function buildHelpEmbedForOwner() {
  return buildAnalyticsEmbed({
    title: "📘 HUMN Help • Owner",
    description: "Owner setup tools and group analytics",
    fields: [
      {
        name: "Setup",
        value: "`/setup` — full setup check\n`/set-webhook url:...` — connect your Discord webhook\n`/connect-gmail` — connect Gmail\n`/connect-yahoo` — connect Yahoo\n`/status` — check email status\n`/disconnect-email` — remove your email connection",
        inline: false,
      },
      {
        name: "Group Analytics",
        value: "`/stats range:30`\n`/leaderboard range:30`\n`/top-products range:30`\n`/trend-analytics range:30`\n`/recent-checkouts`",
        inline: false,
      },
      {
        name: "Testing + Management",
        value: "`/test-event` — send a test checkout\n`/create-group` — create a new group\n`/join` — join a group with code",
        inline: false,
      },
    ],
  });
}

module.exports = {
  buildSuccessEmbed,
  buildErrorEmbed,
  buildAnalyticsEmbed,
  buildCheckoutEmbed,
  buildHelpEmbedForGuest,
  buildHelpEmbedForMember,
  buildHelpEmbedForOwner,
};
