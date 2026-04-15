require("dotenv").config();
require("./server");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

console.log("BOT STARTING...");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const GMAIL_AUTH_BASE_URL =
  process.env.GMAIL_AUTH_BASE_URL ||
  "https://positive-passion-production.up.railway.app";

const RANGE_CHOICES = [
  { name: "7 days", value: "7" },
  { name: "20 days", value: "20" },
  { name: "30 days", value: "30" },
  { name: "All time", value: "all" },
];

const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View Lumen commands and setup help"),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Check your full Lumen setup status"),

  new SlashCommandBuilder()
    .setName("create-group")
    .setDescription("Create your private group")
    .addStringOption((option) =>
      option.setName("name").setDescription("Group name").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join a group with a code")
    .addStringOption((option) =>
      option.setName("code").setDescription("Group join code").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("leave-group")
    .setDescription("Leave your current group"),

  new SlashCommandBuilder()
    .setName("set-webhook")
    .setDescription("Save the Discord webhook for your group")
    .addStringOption((option) =>
      option
        .setName("url")
        .setDescription("Discord webhook URL")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("connect-gmail")
    .setDescription("Get your Gmail connection link"),

  new SlashCommandBuilder()
    .setName("connect-yahoo")
    .setDescription("Get Yahoo setup instructions"),

  new SlashCommandBuilder()
    .setName("save-yahoo")
    .setDescription("Save your Yahoo email and app password")
    .addStringOption((option) =>
      option
        .setName("email")
        .setDescription("Your Yahoo email")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("app_password")
        .setDescription("Yahoo app password")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check your email connection status"),

  new SlashCommandBuilder()
    .setName("test-event")
    .setDescription("Send a test checkout event"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("View group analytics")
    .addStringOption((option) =>
      option
        .setName("range")
        .setDescription("Select time range")
        .setRequired(true)
        .addChoices(...RANGE_CHOICES)
    )
    .addStringOption((option) =>
      option
        .setName("retailer")
        .setDescription("Optional retailer filter, or type all")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View top users by checkouts")
    .addStringOption((option) =>
      option
        .setName("range")
        .setDescription("Select time range")
        .setRequired(true)
        .addChoices(...RANGE_CHOICES)
    )
    .addStringOption((option) =>
      option
        .setName("retailer")
        .setDescription("Optional retailer filter, or type all")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("recent-checkouts")
    .setDescription("View recent checkout activity")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Number of recent checkouts to show")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    )
    .addStringOption((option) =>
      option
        .setName("retailer")
        .setDescription("Optional retailer filter, or type all")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("user-stats")
    .setDescription("View stats for a user in your group")
    .addStringOption((option) =>
      option
        .setName("range")
        .setDescription("Select time range")
        .setRequired(true)
        .addChoices(...RANGE_CHOICES)
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User to view stats for")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("retailer")
        .setDescription("Optional retailer filter, or type all")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("top-products")
    .setDescription("View the most purchased products in your group")
    .addStringOption((option) =>
      option
        .setName("range")
        .setDescription("Select time range")
        .setRequired(true)
        .addChoices(...RANGE_CHOICES)
    )
    .addStringOption((option) =>
      option
        .setName("retailer")
        .setDescription("Optional retailer filter, or type all")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Number of products to show")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    ),

  new SlashCommandBuilder()
    .setName("trend-analytics")
    .setDescription("View checkout trend analytics by day")
    .addStringOption((option) =>
      option
        .setName("range")
        .setDescription("Select time range")
        .setRequired(true)
        .addChoices(...RANGE_CHOICES)
    )
    .addStringOption((option) =>
      option
        .setName("retailer")
        .setDescription("Optional retailer filter, or type all")
        .setRequired(false)
    ),
].map((c) => c.toJSON());

console.log("TOKEN:", process.env.DISCORD_TOKEN ? "Loaded ✅" : "Missing ❌");
console.log("SUPABASE URL:", process.env.SUPABASE_URL ? "Loaded ✅" : "Missing ❌");
console.log("APP ID:", process.env.APPLICATION_ID ? "Loaded ✅" : "Missing ❌");
console.log("COMMANDS TO REGISTER:", commands.map((c) => c.name));

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log("Registering commands...");

    await rest.put(Routes.applicationCommands(process.env.APPLICATION_ID), {
      body: [],
    });

    console.log("Old commands cleared.");

    await rest.put(Routes.applicationCommands(process.env.APPLICATION_ID), {
      body: commands,
    });

    console.log("Commands registered.");
  } catch (err) {
    console.error("COMMAND ERROR:", err);
  }
}

function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

function getSinceIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function normalizeRetailerFilter(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return null;

  const lower = trimmed.toLowerCase();
  if (
    lower === "pokemon" ||
    lower === "pokemoncenter" ||
    lower === "pokemon center"
  ) {
    return "Pokemon Center";
  }
  if (lower === "target") return "Target";
  if (lower === "walmart") return "Walmart";

  return trimmed;
}

function normalizeProductKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDateTime(value) {
  return new Date(value || new Date()).toLocaleString();
}

function shortenText(text, maxLength = 90) {
  const value = String(text || "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function sumOrderTotals(events = []) {
  return events.reduce((sum, event) => sum + Number(event.order_total || 0), 0);
}

function averageOrderValue(events = []) {
  if (!events.length) return 0;
  return sumOrderTotals(events) / events.length;
}

function buildRetailerBreakdown(events = []) {
  const counts = {};

  for (const event of events) {
    const retailer = event.retailer || "Unknown";
    counts[retailer] = (counts[retailer] || 0) + 1;
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function formatRangeLabel(rangeValue) {
  return rangeValue === "all" ? "All-time" : `${rangeValue}-day`;
}

function buildTopProducts(events = []) {
  const productStats = {};

  for (const event of events) {
    const key = normalizeProductKey(event.product_name);
    if (!key) continue;

    if (!productStats[key]) {
      productStats[key] = {
        product_name: event.product_name || "Unknown Product",
        retailer: event.retailer || "Unknown",
        count: 0,
        spend: 0,
        quantity: 0,
      };
    }

    productStats[key].count += 1;
    productStats[key].spend += Number(event.order_total || 0);
    productStats[key].quantity += Number(event.quantity || 1);
  }

  return Object.values(productStats).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.spend - a.spend;
  });
}

function buildDailyTrend(events = []) {
  const daily = {};

  for (const event of events) {
    const key = new Date(event.created_at).toLocaleDateString();
    if (!daily[key]) {
      daily[key] = {
        count: 0,
        spend: 0,
      };
    }

    daily[key].count += 1;
    daily[key].spend += Number(event.order_total || 0);
  }

  return Object.entries(daily).sort((a, b) => new Date(a[0]) - new Date(b[0]));
}

function buildWeekdayBreakdown(events = []) {
  const weekdayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const counts = {};

  for (const name of weekdayNames) {
    counts[name] = 0;
  }

  for (const event of events) {
    const date = new Date(event.created_at);
    const dayName = weekdayNames[date.getDay()];
    counts[dayName] += 1;
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

async function getUserRankAndSpend(groupId, discordUserId) {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: events, error } = await supabase
    .from("checkout_events")
    .select("discord_user_id, order_total")
    .eq("group_id", groupId)
    .gte("created_at", since.toISOString());

  if (error || !events) {
    console.error("Rank calc error:", error);
    return { rank: null, spend: 0 };
  }

  const userTotals = {};

  for (const event of events) {
    const id = event.discord_user_id;
    userTotals[id] = (userTotals[id] || 0) + Number(event.order_total || 0);
  }

  const sorted = Object.entries(userTotals).sort((a, b) => b[1] - a[1]);

  let rank = null;
  let spend = 0;

  sorted.forEach(([id, total], index) => {
    if (id === discordUserId) {
      rank = index + 1;
      spend = total;
    }
  });

  return { rank, spend };
}

async function buildCheckoutEmbed(event, discordUserId) {
  const { rank, spend } = await getUserRankAndSpend(
    event.group_id,
    discordUserId
  );

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`Successful Checkout | ${event.retailer || "Unknown Retailer"}`)
    .addFields(
      {
        name: "User",
        value: `<@${discordUserId}>`,
        inline: false,
      },
      {
        name: "Product",
        value: event.product_url
          ? `[${shortenText(
              event.product_name || "Unknown Product",
              120
            )}](${event.product_url})`
          : `${shortenText(event.product_name || "Unknown Product", 120)}`,
        inline: false,
      },
      {
        name: "Price",
        value: formatMoney(event.order_total),
        inline: true,
      },
      {
        name: "Quantity",
        value: String(event.quantity || 1),
        inline: true,
      },
      {
        name: "Checkout Time",
        value: formatDateTime(event.created_at),
        inline: false,
      },
      {
        name: "🏆 Rank (30d)",
        value: rank ? `#${rank}` : "N/A",
        inline: true,
      },
      {
        name: "💰 Spend (30d)",
        value: formatMoney(spend || 0),
        inline: true,
      }
    )
    .setFooter({
      text: "Lumen Beta • Real-Time Checkout Feed",
      iconURL: "https://cdn-icons-png.flaticon.com/512/4712/4712027.png",
    });

  if (
    event.product_image &&
    !String(event.product_image).includes("example")
  ) {
    embed.setThumbnail(event.product_image);
  }

  return embed;
}

function buildSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: "Lumen",
      iconURL: "https://cdn-icons-png.flaticon.com/512/4712/4712027.png",
    });
}

function buildErrorEmbed(message) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Action Failed")
    .setDescription(message)
    .setFooter({
      text: "Lumen",
      iconURL: "https://cdn-icons-png.flaticon.com/512/4712/4712027.png",
    });
}

function buildAnalyticsEmbed({ title, description, fields }) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: "Lumen Analytics",
      iconURL: "https://cdn-icons-png.flaticon.com/512/4712/4712027.png",
    });

  if (fields && fields.length) {
    embed.addFields(fields);
  }

  return embed;
}

function buildHelpEmbedForGuest() {
  return buildAnalyticsEmbed({
    title: "📘 Lumen Help",
    description: "Get started with Lumen",
    fields: [
      {
        name: "Start Here",
        value:
          "Use `/create-group name:YourGroup` to create your own group, or `/join code:XXXXXX` if you have an invite code.",
        inline: false,
      },
      {
        name: "After Joining",
        value:
          "Run `/setup` to see what is connected and what still needs to be finished.",
        inline: false,
      },
      {
        name: "Main Commands",
        value:
          "`/create-group`\n`/join`\n`/setup`\n`/connect-gmail`\n`/connect-yahoo`\n`/status`",
        inline: false,
      },
    ],
  });
}

function buildHelpEmbedForMember() {
  return buildAnalyticsEmbed({
    title: "📘 Lumen Help • Member",
    description: "Your personal commands and setup tools",
    fields: [
      {
        name: "Setup",
        value:
          "`/setup` — full setup check\n`/connect-gmail` — connect Gmail\n`/connect-yahoo` — connect Yahoo\n`/status` — see your email status\n`/leave-group` — leave your current group",
        inline: false,
      },
      {
        name: "Your Analytics",
        value:
          "`/user-stats range:30` — view your stats\n`/recent-checkouts` — view the public checkout log",
        inline: false,
      },
      {
        name: "Notes",
        value:
          "Members can view their own stats and the group checkout feed. Group-wide analytics are owner-only.",
        inline: false,
      },
    ],
  });
}

function buildHelpEmbedForOwner() {
  return buildAnalyticsEmbed({
    title: "📘 Lumen Help • Owner",
    description: "Owner setup tools and group analytics",
    fields: [
      {
        name: "Setup",
        value:
          "`/setup` — full setup check\n`/set-webhook url:...` — connect your Discord webhook\n`/connect-gmail` — connect Gmail\n`/connect-yahoo` — connect Yahoo\n`/status` — check email status",
        inline: false,
      },
      {
        name: "Group Analytics",
        value:
          "`/stats range:30`\n`/leaderboard range:30`\n`/top-products range:30`\n`/trend-analytics range:30`\n`/recent-checkouts`",
        inline: false,
      },
      {
        name: "Testing + Management",
        value:
          "`/test-event` — send a test checkout\n`/create-group` — create a new group\n`/join` — join a group with code",
        inline: false,
      },
    ],
  });
}

async function getMembershipByDiscordUserId(discordUserId) {
  const { data, error } = await supabase
    .from("group_members")
    .select("group_id, role")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  return { data, error };
}

async function getGroupById(groupId) {
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();

  return { data, error };
}

async function sendWebhookEmbed(webhookUrl, embed) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      embeds: [embed.toJSON()],
    }),
  });

  return response;
}

async function getFilteredEvents(
  groupId,
  rangeValue,
  retailerFilter,
  limit = null
) {
  let query = supabase
    .from("checkout_events")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (rangeValue !== "all") {
    query = query.gte("created_at", getSinceIso(parseInt(rangeValue, 10)));
  }

  if (retailerFilter) {
    query = query.ilike("retailer", retailerFilter);
  }

  if (limit) {
    query = query.limit(limit);
  }

  return query;
}

function requireOwner(interaction, membership) {
  if (membership?.role !== "owner") {
    interaction.editReply({
      embeds: [buildErrorEmbed("Only the group owner can use this command.")],
    });
    return true;
  }
  return false;
}

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "help") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;

    try {
      const { data: membership, error } =
        await getMembershipByDiscordUserId(discordUserId);

      if (error) {
        console.error(error);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load help.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildHelpEmbedForGuest()],
        });
      }

      if (membership.role === "owner") {
        return interaction.editReply({
          embeds: [buildHelpEmbedForOwner()],
        });
      }

      return interaction.editReply({
        embeds: [buildHelpEmbedForMember()],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to load help.")],
      });
    }
  }

  if (interaction.commandName === "setup") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load setup status.")],
        });
      }

      if (!membership) {
        const embed = buildAnalyticsEmbed({
          title: "🛠️ Lumen Setup",
          description: "You are not in a group yet.",
          fields: [
            {
              name: "Group",
              value: "❌ Not connected",
              inline: false,
            },
            {
              name: "Next Step",
              value:
                "Run `/create-group name:YourGroup` to start a group, or `/join code:XXXXXX` if you already have an invite code.",
              inline: false,
            },
          ],
        });

        return interaction.editReply({ embeds: [embed] });
      }

      const { data: group, error: groupError } = await getGroupById(
        membership.group_id
      );

      if (groupError) {
        console.error(groupError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load group setup.")],
        });
      }

      const { data: emailConnection, error: emailError } = await supabase
        .from("gmail_connections")
        .select("*")
        .eq("discord_user_id", discordUserId)
        .maybeSingle();

      if (emailError) {
        console.error(emailError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load email setup.")],
        });
      }

      const hasWebhook = Boolean(group?.discord_webhook_url);
      const hasEmail = Boolean(emailConnection?.email || emailConnection?.google_email);
      const isOwner = membership.role === "owner";

      let nextSteps = [];
      if (!hasWebhook && isOwner) {
        nextSteps.push("Run `/set-webhook url:YOUR_WEBHOOK_URL`");
      }
      if (!hasEmail) {
        nextSteps.push("Run `/connect-gmail` or `/connect-yahoo`");
      }
      if (!nextSteps.length) {
        nextSteps.push("Everything looks good. You're ready to use Lumen.");
      }

      const providerLabel = emailConnection?.provider
        ? emailConnection.provider.charAt(0).toUpperCase() +
          emailConnection.provider.slice(1)
        : null;

      const embed = buildAnalyticsEmbed({
        title: "🛠️ Lumen Setup",
        description: "Full setup health check",
        fields: [
          {
            name: "Group",
            value: group?.name ? `✅ ${group.name}` : "❌ Missing",
            inline: false,
          },
          {
            name: "Role",
            value: membership.role === "owner" ? "👑 Owner" : "👤 Member",
            inline: true,
          },
          {
            name: "Webhook",
            value: hasWebhook ? "✅ Connected" : "❌ Not connected",
            inline: true,
          },
          {
            name: "Your Email",
            value: hasEmail
              ? `✅ ${emailConnection.email || emailConnection.google_email}${
                  providerLabel ? ` (${providerLabel})` : ""
                }`
              : "❌ Not connected",
            inline: false,
          },
          {
            name: "Next Step",
            value: nextSteps.join("\n"),
            inline: false,
          },
        ],
      });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to load setup status.")],
      });
    }
  }

  if (interaction.commandName === "create-group") {
    await interaction.deferReply({ ephemeral: true });

    const name = interaction.options.getString("name");
    const discordUserId = interaction.user.id;

    try {
      const { data: existingGroup, error: existingError } = await supabase
        .from("groups")
        .select("*")
        .eq("owner_discord_id", discordUserId)
        .maybeSingle();

      if (existingError) {
        console.error(existingError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to check existing group.")],
        });
      }

      if (existingGroup) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You already own a group.")],
        });
      }

      const { data: existingMembership, error: membershipCheckError } =
        await supabase
          .from("group_members")
          .select("*")
          .eq("discord_user_id", discordUserId)
          .maybeSingle();

      if (membershipCheckError) {
        console.error(membershipCheckError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to check existing membership.")],
        });
      }

      if (existingMembership) {
        return interaction.editReply({
          embeds: [
            buildErrorEmbed(
              "You are already in a group. Leave your current group before creating a new one."
            ),
          ],
        });
      }

      const joinCode = generateJoinCode();

      const { data: group, error: groupError } = await supabase
        .from("groups")
        .insert({
          name,
          owner_discord_id: discordUserId,
          join_code: joinCode,
        })
        .select()
        .single();

      if (groupError) {
        console.error(groupError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to create group.")],
        });
      }

      const { error: memberError } = await supabase
        .from("group_members")
        .insert({
          group_id: group.id,
          discord_user_id: discordUserId,
          role: "owner",
        });

      if (memberError) {
        console.error(memberError);
        return interaction.editReply({
          embeds: [
            buildErrorEmbed(
              "Group created, but failed to create owner membership."
            ),
          ],
        });
      }

      return interaction.editReply({
        embeds: [
          buildSuccessEmbed(
            "Group Created",
            `Your group **${name}** is now live.\n\n**Join Code:** \`${joinCode}\``
          ),
        ],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Error creating group.")],
      });
    }
  }

  if (interaction.commandName === "join") {
    await interaction.deferReply({ ephemeral: true });

    const code = interaction.options.getString("code").trim().toUpperCase();
    const discordUserId = interaction.user.id;

    try {
      const { data: group, error: groupError } = await supabase
        .from("groups")
        .select("*")
        .eq("join_code", code)
        .maybeSingle();

      if (groupError) {
        console.error(groupError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find group.")],
        });
      }

      if (!group) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("Invalid join code.")],
        });
      }

      const { data: existingMembership, error: membershipError } = await supabase
        .from("group_members")
        .select("*")
        .eq("discord_user_id", discordUserId)
        .maybeSingle();

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to check membership.")],
        });
      }

      if (existingMembership) {
        return interaction.editReply({
          embeds: [
            buildErrorEmbed(
              "You are already in a group. Leave your current group before joining another."
            ),
          ],
        });
      }

      const { error: insertError } = await supabase
        .from("group_members")
        .insert({
          group_id: group.id,
          discord_user_id: discordUserId,
          role: "member",
        });

      if (insertError) {
        console.error(insertError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to join group.")],
        });
      }

      return interaction.editReply({
        embeds: [
          buildSuccessEmbed(
            "Joined Group",
            `You successfully joined **${group.name}**.`
          ),
        ],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Error joining group.")],
      });
    }
  }

  if (interaction.commandName === "leave-group") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your group.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You are not in a group.")],
        });
      }

      if (membership.role === "owner") {
        return interaction.editReply({
          embeds: [
            buildErrorEmbed(
              "Group owners cannot leave their group. Transfer ownership or delete the group first."
            ),
          ],
        });
      }

      const { error: deleteMembershipError } = await supabase
        .from("group_members")
        .delete()
        .eq("discord_user_id", discordUserId);

      if (deleteMembershipError) {
        console.error(deleteMembershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to leave group.")],
        });
      }

      await supabase
        .from("gmail_connections")
        .delete()
        .eq("discord_user_id", discordUserId);

      return interaction.editReply({
        embeds: [
          buildSuccessEmbed(
            "Left Group",
            "You have successfully left the group and your email connection was removed."
          ),
        ],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Error leaving group.")],
      });
    }
  }

  if (interaction.commandName === "set-webhook") {
    await interaction.deferReply({ ephemeral: true });

    const webhookUrl = interaction.options.getString("url").trim();
    const discordUserId = interaction.user.id;

    if (!webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
      return interaction.editReply({
        embeds: [
          buildErrorEmbed(
            "That does not look like a valid Discord webhook URL."
          ),
        ],
      });
    }

    try {
      const { data: ownedGroup, error: ownedGroupError } = await supabase
        .from("groups")
        .select("*")
        .eq("owner_discord_id", discordUserId)
        .maybeSingle();

      if (ownedGroupError) {
        console.error(ownedGroupError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your group.")],
        });
      }

      if (!ownedGroup) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You do not own a group yet.")],
        });
      }

      const testResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: "✅ Lumen webhook connected successfully.",
        }),
      });

      if (!testResponse.ok) {
        return interaction.editReply({
          embeds: [
            buildErrorEmbed(
              "Webhook test failed. Make sure the webhook URL is correct."
            ),
          ],
        });
      }

      const { error: updateError } = await supabase
        .from("groups")
        .update({
          discord_webhook_url: webhookUrl,
        })
        .eq("id", ownedGroup.id);

      if (updateError) {
        console.error(updateError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to save webhook.")],
        });
      }

      return interaction.editReply({
        embeds: [
          buildSuccessEmbed(
            "Webhook Connected",
            "Your group webhook was saved and tested successfully."
          ),
        ],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Error saving webhook.")],
      });
    }
  }

  if (interaction.commandName === "connect-gmail") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your membership.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You are not in a group.")],
        });
      }

      const authUrl =
        `${GMAIL_AUTH_BASE_URL}/auth/google` +
        `?discord_user_id=${encodeURIComponent(discordUserId)}` +
        `&group_id=${encodeURIComponent(membership.group_id)}`;

      return interaction.editReply({
        embeds: [
          buildSuccessEmbed(
            "Connect Gmail",
            `Use the link below to connect your Gmail account.\n\n${authUrl}`
          ),
        ],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to generate Gmail connection link.")],
      });
    }
  }

  if (interaction.commandName === "connect-yahoo") {
    await interaction.deferReply({ ephemeral: true });

    return interaction.editReply({
      content:
        "Connect Yahoo\n\n" +
        "1. Go here: https://login.yahoo.com/account/security\n" +
        "2. Click 'Generate App Password'\n" +
        "3. Select 'Other App' → type 'Lumen'\n" +
        "4. Copy the password\n" +
        "5. Run /save-yahoo email:your@yahoo.com app_password:YOUR_PASSWORD",
    });
  }

  if (interaction.commandName === "save-yahoo") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;
    const email = interaction.options.getString("email").trim().toLowerCase();
    const appPassword = interaction.options.getString("app_password").trim();

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your membership.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You are not in a group.")],
        });
      }

      const payload = {
        group_id: membership.group_id,
        discord_user_id: discordUserId,
        email,
        google_email: email,
        status: "connected",
        provider: "yahoo",
        yahoo_app_password: appPassword,
        created_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("gmail_connections")
        .upsert(payload, {
          onConflict: "group_id,discord_user_id,email",
        });

      if (upsertError) {
        console.error("Yahoo save error:", upsertError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to save Yahoo connection.")],
        });
      }

      return interaction.editReply({
        content: `✅ Yahoo connected for ${email}`,
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to save Yahoo connection.")],
      });
    }
  }

  if (interaction.commandName === "status") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;

    try {
      const { data: connection, error } = await supabase
        .from("gmail_connections")
        .select("*")
        .eq("discord_user_id", discordUserId)
        .maybeSingle();

      if (error) {
        console.error(error);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to check email status.")],
        });
      }

      if (!connection) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("No email account connected yet.")],
        });
      }

      const providerLabel = connection.provider
        ? connection.provider.charAt(0).toUpperCase() +
          connection.provider.slice(1)
        : "Email";

      return interaction.editReply({
        embeds: [
          buildSuccessEmbed(
            `${providerLabel} Connected`,
            `Connected as: **${connection.email || connection.google_email}**`
          ),
        ],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Error checking status.")],
      });
    }
  }

  if (interaction.commandName === "test-event") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your membership.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You are not in a group.")],
        });
      }

      const denied = requireOwner(interaction, membership);
      if (denied) return;

      const { data: group, error: groupError } = await getGroupById(
        membership.group_id
      );

      if (groupError) {
        console.error(groupError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your group.")],
        });
      }

      if (!group?.discord_webhook_url) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("No webhook is set for this group.")],
        });
      }

      const eventPayload = {
        group_id: group.id,
        discord_user_id: discordUserId,
        retailer: "Target",
        product_name: "Pokemon Booster Pack",
        product_url:
          "https://www.target.com/p/pokemon-trading-card-game-scarlet-violet-3-booster-pack/-/A-90000000",
        product_image:
          "https://target.scene7.com/is/image/Target/GUEST_example",
        quantity: 1,
        order_total: 5.99,
        source: "test",
        created_at: new Date().toISOString(),
      };

      const { data: insertedEvent, error: eventInsertError } = await supabase
        .from("checkout_events")
        .insert(eventPayload)
        .select()
        .single();

      if (eventInsertError) {
        console.error(eventInsertError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to save test event.")],
        });
      }

      const embed = await buildCheckoutEmbed(insertedEvent, discordUserId);
      const webhookResponse = await sendWebhookEmbed(
        group.discord_webhook_url,
        embed
      );

      if (!webhookResponse.ok) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to send test event to webhook.")],
        });
      }

      return interaction.editReply({
        embeds: [
          buildSuccessEmbed(
            "Test Event Sent",
            "A test checkout event was sent and saved."
          ),
        ],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to send test event.")],
      });
    }
  }

  if (interaction.commandName === "stats") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;
    const range = interaction.options.getString("range");
    const retailerFilter = normalizeRetailerFilter(
      interaction.options.getString("retailer")
    );

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your membership.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You are not in a group.")],
        });
      }

      const denied = requireOwner(interaction, membership);
      if (denied) return;

      const { data: events, error: eventsError } = await getFilteredEvents(
        membership.group_id,
        range,
        retailerFilter
      );

      if (eventsError) {
        console.error(eventsError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load stats.")],
        });
      }

      const { count: memberCount, error: memberCountError } = await supabase
        .from("group_members")
        .select("*", { count: "exact", head: true })
        .eq("group_id", membership.group_id);

      if (memberCountError) {
        console.error(memberCountError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load member stats.")],
        });
      }

      const totalCheckouts = events?.length || 0;
      const totalSpend = sumOrderTotals(events || []);
      const avgValue = averageOrderValue(events || []);
      const retailerCounts = {};
      const userCounts = {};

      for (const event of events || []) {
        const retailer = event.retailer || "Unknown";
        retailerCounts[retailer] = (retailerCounts[retailer] || 0) + 1;
        userCounts[event.discord_user_id] =
          (userCounts[event.discord_user_id] || 0) + 1;
      }

      const topRetailer =
        Object.entries(retailerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        "None";

      const topUserId =
        Object.entries(userCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      const latestEvent = events?.[0];
      const uniqueUsers = Object.keys(userCounts).length;

      const retailerBreakdownText =
        buildRetailerBreakdown(events || [])
          .slice(0, 5)
          .map(([retailer, count]) => `${retailer}: ${count}`)
          .join("\n") || "No retailer data";

      const embed = buildAnalyticsEmbed({
        title: `📊 ${interaction.guild?.name || "Group"} Stats`,
        description: `${formatRangeLabel(range)} analytics snapshot${
          retailerFilter ? ` • Retailer: ${retailerFilter}` : ""
        }`,
        fields: [
          {
            name: "Total Checkouts",
            value: String(totalCheckouts),
            inline: true,
          },
          {
            name: "Members",
            value: String(memberCount || 0),
            inline: true,
          },
          { name: "Unique Users", value: String(uniqueUsers), inline: true },
          { name: "Total Spend", value: formatMoney(totalSpend), inline: true },
          {
            name: "Average Order Value",
            value: formatMoney(avgValue),
            inline: true,
          },
          { name: "Top Retailer", value: topRetailer, inline: true },
          {
            name: "Top User",
            value: topUserId ? `<@${topUserId}>` : "None",
            inline: true,
          },
          {
            name: "Retailer Breakdown",
            value: retailerBreakdownText,
            inline: false,
          },
          {
            name: "Latest Event",
            value: latestEvent
              ? `${latestEvent.retailer} • ${shortenText(
                  latestEvent.product_name,
                  80
                )} • ${formatMoney(latestEvent.order_total)}`
              : "No events yet",
            inline: false,
          },
        ],
      });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to load stats.")],
      });
    }
  }

  if (interaction.commandName === "leaderboard") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;
    const range = interaction.options.getString("range");
    const retailerFilter = normalizeRetailerFilter(
      interaction.options.getString("retailer")
    );

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your membership.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You are not in a group.")],
        });
      }

      const denied = requireOwner(interaction, membership);
      if (denied) return;

      const { data: events, error: eventsError } = await getFilteredEvents(
        membership.group_id,
        range,
        retailerFilter
      );

      if (eventsError) {
        console.error(eventsError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load leaderboard.")],
        });
      }

      const userStats = {};

      for (const event of events || []) {
        if (!userStats[event.discord_user_id]) {
          userStats[event.discord_user_id] = { count: 0, spend: 0 };
        }

        userStats[event.discord_user_id].count += 1;
        userStats[event.discord_user_id].spend += Number(event.order_total || 0);
      }

      const sortedUsers = Object.entries(userStats)
        .sort((a, b) => {
          if (b[1].count !== a[1].count) return b[1].count - a[1].count;
          return b[1].spend - a[1].spend;
        })
        .slice(0, 10);

      const description =
        sortedUsers.length > 0
          ? sortedUsers
              .map(([id, stats], index) => {
                const avg = stats.count > 0 ? stats.spend / stats.count : 0;
                return `**#${index + 1}** <@${id}>\n${stats.count} checkouts • ${formatMoney(
                  stats.spend
                )} spent • avg ${formatMoney(avg)}`;
              })
              .join("\n\n")
          : "No data yet.";

      const embed = buildAnalyticsEmbed({
        title: `🏆 ${interaction.guild?.name || "Group"} Leaderboard (${formatRangeLabel(
          range
        )})`,
        description: retailerFilter
          ? `${description}\n\n**Retailer Filter:** ${retailerFilter}`
          : description,
        fields: [],
      });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to load leaderboard.")],
      });
    }
  }

  if (interaction.commandName === "recent-checkouts") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;
    const limit = interaction.options.getInteger("limit") || 5;
    const retailerFilter = normalizeRetailerFilter(
      interaction.options.getString("retailer")
    );

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your membership.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You are not in a group.")],
        });
      }

      let query = supabase
        .from("checkout_events")
        .select("*")
        .eq("group_id", membership.group_id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (retailerFilter) {
        query = query.ilike("retailer", retailerFilter);
      }

      const { data: events, error: eventsError } = await query;

      if (eventsError) {
        console.error(eventsError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load recent checkouts.")],
        });
      }

      const description =
        events && events.length > 0
          ? events
              .map(
                (event, index) =>
                  `**#${index + 1}** ${event.retailer} • ${shortenText(
                    event.product_name,
                    75
                  )}\n` +
                  `${formatMoney(event.order_total)} • Qty ${
                    event.quantity || 1
                  } • <@${event.discord_user_id}> • ${formatDateTime(
                    event.created_at
                  )}`
              )
              .join("\n\n")
          : "No recent checkout activity found.";

      const embed = buildAnalyticsEmbed({
        title: `🧾 ${interaction.guild?.name || "Group"} Recent Checkouts`,
        description: retailerFilter
          ? `${description}\n\n**Retailer Filter:** ${retailerFilter}`
          : description,
        fields: [],
      });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to load recent checkouts.")],
      });
    }
  }

  if (interaction.commandName === "user-stats") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;
    const selectedUser = interaction.options.getUser("user") || interaction.user;
    const targetUserId = selectedUser.id;
    const range = interaction.options.getString("range");
    const retailerFilter = normalizeRetailerFilter(
      interaction.options.getString("retailer")
    );

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your membership.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You are not in a group.")],
        });
      }

      if (membership.role !== "owner" && targetUserId !== discordUserId) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("Members can only view their own stats.")],
        });
      }

      const { data: targetMembership, error: targetMembershipError } =
        await supabase
          .from("group_members")
          .select("group_id")
          .eq("group_id", membership.group_id)
          .eq("discord_user_id", targetUserId)
          .maybeSingle();

      if (targetMembershipError) {
        console.error(targetMembershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to verify the selected user.")],
        });
      }

      if (!targetMembership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("That user is not in your group.")],
        });
      }

      const { data: events, error: eventsError } = await getFilteredEvents(
        membership.group_id,
        range,
        retailerFilter
      );

      if (eventsError) {
        console.error(eventsError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load user stats.")],
        });
      }

      const userEvents = (events || []).filter(
        (event) => event.discord_user_id === targetUserId
      );

      const totalCheckouts = userEvents.length;
      const totalSpend = sumOrderTotals(userEvents);
      const avgValue = averageOrderValue(userEvents);
      const latestEvent = userEvents[0] || null;

      const retailerCounts = {};
      for (const event of userEvents) {
        const retailer = event.retailer || "Unknown";
        retailerCounts[retailer] = (retailerCounts[retailer] || 0) + 1;
      }

      const favoriteRetailer =
        Object.entries(retailerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        "None";

      const retailerBreakdownText =
        Object.entries(retailerCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([retailer, count]) => `${retailer}: ${count}`)
          .join("\n") || "No retailer data";

      const embed = buildAnalyticsEmbed({
        title: `📈 ${selectedUser.username} Stats`,
        description: `${formatRangeLabel(range)} user snapshot${
          retailerFilter ? ` • Retailer: ${retailerFilter}` : ""
        }`,
        fields: [
          { name: "User", value: `<@${targetUserId}>`, inline: true },
          {
            name: "Total Checkouts",
            value: String(totalCheckouts),
            inline: true,
          },
          {
            name: "Favorite Retailer",
            value: favoriteRetailer,
            inline: true,
          },
          { name: "Total Spend", value: formatMoney(totalSpend), inline: true },
          {
            name: "Average Order Value",
            value: formatMoney(avgValue),
            inline: true,
          },
          {
            name: "Retailer Breakdown",
            value: retailerBreakdownText,
            inline: false,
          },
          {
            name: "Latest Checkout",
            value: latestEvent
              ? `${latestEvent.retailer} • ${shortenText(
                  latestEvent.product_name,
                  80
                )} • ${formatMoney(
                  latestEvent.order_total
                )} • ${formatDateTime(latestEvent.created_at)}`
              : "No events found for this user",
            inline: false,
          },
        ],
      });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to load user stats.")],
      });
    }
  }

  if (interaction.commandName === "top-products") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;
    const range = interaction.options.getString("range");
    const retailerFilter = normalizeRetailerFilter(
      interaction.options.getString("retailer")
    );
    const limit = interaction.options.getInteger("limit") || 5;

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your membership.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You are not in a group.")],
        });
      }

      const denied = requireOwner(interaction, membership);
      if (denied) return;

      const { data: events, error: eventsError } = await getFilteredEvents(
        membership.group_id,
        range,
        retailerFilter
      );

      if (eventsError) {
        console.error(eventsError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load top products.")],
        });
      }

      const topProducts = buildTopProducts(events || []).slice(0, limit);

      const description =
        topProducts.length > 0
          ? topProducts
              .map(
                (product, index) =>
                  `**#${index + 1}** ${shortenText(product.product_name, 75)}\n` +
                  `${product.count} checkouts • ${product.quantity} qty • ${formatMoney(
                    product.spend
                  )} • ${product.retailer}`
              )
              .join("\n\n")
          : "No product data yet.";

      const embed = buildAnalyticsEmbed({
        title: `📦 ${interaction.guild?.name || "Group"} Top Products`,
        description: `${formatRangeLabel(range)} product rankings${
          retailerFilter ? ` • Retailer: ${retailerFilter}` : ""
        }\n\n${description}`,
        fields: [],
      });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to load top products.")],
      });
    }
  }

  if (interaction.commandName === "trend-analytics") {
    await interaction.deferReply({ ephemeral: true });

    const discordUserId = interaction.user.id;
    const range = interaction.options.getString("range");
    const retailerFilter = normalizeRetailerFilter(
      interaction.options.getString("retailer")
    );

    try {
      const { data: membership, error: membershipError } =
        await getMembershipByDiscordUserId(discordUserId);

      if (membershipError) {
        console.error(membershipError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to find your membership.")],
        });
      }

      if (!membership) {
        return interaction.editReply({
          embeds: [buildErrorEmbed("You are not in a group.")],
        });
      }

      const denied = requireOwner(interaction, membership);
      if (denied) return;

      const { data: events, error: eventsError } = await getFilteredEvents(
        membership.group_id,
        range,
        retailerFilter
      );

      if (eventsError) {
        console.error(eventsError);
        return interaction.editReply({
          embeds: [buildErrorEmbed("Failed to load trend analytics.")],
        });
      }

      const dailyTrend = buildDailyTrend(events || []);
      const weekdayBreakdown = buildWeekdayBreakdown(events || []);

      const trendText =
        dailyTrend.length > 0
          ? dailyTrend
              .slice(-10)
              .map(
                ([date, stats]) =>
                  `${date}: ${stats.count} checkouts • ${formatMoney(
                    stats.spend
                  )}`
              )
              .join("\n")
          : "No daily trend data";

      const topDay =
        weekdayBreakdown.find(([, count]) => count > 0)?.[0] || "None";

      const weekdayText =
        weekdayBreakdown
          .filter(([, count]) => count > 0)
          .slice(0, 7)
          .map(([day, count]) => `${day}: ${count}`)
          .join("\n") || "No weekday activity";

      const embed = buildAnalyticsEmbed({
        title: `📈 ${interaction.guild?.name || "Group"} Trend Analytics`,
        description: `${formatRangeLabel(range)} checkout trends${
          retailerFilter ? ` • Retailer: ${retailerFilter}` : ""
        }`,
        fields: [
          { name: "Checkouts by Day", value: trendText, inline: false },
          { name: "Busiest Day of Week", value: topDay, inline: true },
          { name: "Weekday Breakdown", value: weekdayText, inline: false },
        ],
      });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        embeds: [buildErrorEmbed("Failed to load trend analytics.")],
      });
    }
  }
});

(async () => {
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);

  setInterval(() => {
    console.log("Heartbeat: bot alive");
  }, 60000);
})();