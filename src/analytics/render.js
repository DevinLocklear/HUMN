"use strict";

/**
 * analytics/render.js
 * Turns computed data into formatted strings for Discord embeds.
 * No Supabase, no Discord SDK, no side effects.
 */

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

function formatRangeLabel(rangeValue) {
  return rangeValue === "all" ? "All-time" : `${rangeValue}-day`;
}

function padRight(value, length) {
  return String(value ?? "").padEnd(length, " ");
}

function padLeft(value, length) {
  return String(value ?? "").padStart(length, " ");
}

function compactNumber(value) {
  const num = Number(value || 0);
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

function sparkline(values = []) {
  const bars = "▁▂▃▄▅▆▇█";
  if (!values.length) return "—";
  const max = Math.max(...values, 1);
  return values
    .map((v) => bars[Math.min(bars.length - 1, Math.floor((Number(v || 0) / max) * (bars.length - 1)))])
    .join("");
}

function normalizeRetailerName(retailer) {
  const value = String(retailer || "").trim().toLowerCase();
  if (value === "pokemoncenter" || value === "pokemon center") return "Pokemon Center";
  if (value === "target") return "Target";
  if (value === "walmart") return "Walmart";
  return retailer || "Unknown Retailer";
}

function renderStatsDashboard({
  totalCheckouts,
  totalSpend,
  avgValue,
  memberCount,
  uniqueUsers,
  topRetailer,
  topUserDisplay,
  retailerBreakdownText,
  latestEvent,
}) {
  const lines = [
    "```",
    "CHECKOUT STATISTICS",
    "─".repeat(30),
    `${padRight("Orders", 14)} ${padLeft(compactNumber(totalCheckouts), 8)}`,
    `${padRight("Members", 14)} ${padLeft(compactNumber(memberCount), 8)}`,
    `${padRight("Unique Users", 14)} ${padLeft(compactNumber(uniqueUsers), 8)}`,
    `${padRight("Spend", 14)} ${padLeft(formatMoney(totalSpend), 8)}`,
    `${padRight("Avg Order", 14)} ${padLeft(formatMoney(avgValue), 8)}`,
    `${padRight("Top Retailer", 14)} ${topRetailer}`,
    `${padRight("Top User", 14)} ${topUserDisplay || "None"}`,
    "─".repeat(30),
    "RETAILER BREAKDOWN",
    retailerBreakdownText || "No retailer data",
    "─".repeat(30),
    "LATEST EVENT",
    latestEvent
      ? `${normalizeRetailerName(latestEvent.retailer)} | ${shortenText(latestEvent.product_name, 32)}`
      : "No events yet",
    latestEvent ? `${formatMoney(latestEvent.order_total)}` : "",
    "```",
  ];
  return lines.join("\n");
}

function renderTrendDashboard(dailyTrend = [], weekdayBreakdown = []) {
  const recentTrend = dailyTrend.slice(-7);
  const trendValues = recentTrend.map(([, s]) => Number(s.count || 0));
  const trendSpark = sparkline(trendValues);

  const trendRows = recentTrend.length
    ? recentTrend.map(([date, stats]) => {
        const shortDate = new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return `${padRight(shortDate, 8)} ${padLeft(stats.count, 4)}  ${padLeft(formatMoney(stats.spend), 8)}`;
      })
    : ["No daily trend data"];

  const weekdayRows = weekdayBreakdown.length
    ? weekdayBreakdown
        .filter(([, count]) => count > 0)
        .map(([day, count]) => `${padRight(day.slice(0, 3), 4)} ${padLeft(count, 4)}`)
    : ["No weekday activity"];

  const lines = [
    "```",
    "TREND ANALYTICS",
    "─".repeat(34),
    `7D Sparkline  ${trendSpark}`,
    "─".repeat(34),
    `${padRight("Day", 8)} ${padLeft("Orders", 6)} ${padLeft("Spend", 10)}`,
    ...trendRows,
    "─".repeat(34),
    "WEEKDAY BREAKDOWN",
    ...weekdayRows,
    "```",
  ];
  return lines.join("\n");
}

module.exports = {
  formatMoney,
  formatDateTime,
  shortenText,
  formatRangeLabel,
  renderStatsDashboard,
  renderTrendDashboard,
};
