const path = require("path");

// Upland's ToS restricts automated access, so the indexer is polite by default:
// one request per second, an honest User-Agent, and backoff on any error.
module.exports = {
  HISTORY_URL: process.env.UPLAND_HISTORY_URL || "https://chain-history.upland.me/v2",
  RPC_URL: process.env.UPLAND_RPC_URL || "https://chain-api.upland.me",
  REQUESTS_PER_SECOND: Number(process.env.INDEXER_RPS) || 1,
  USER_AGENT:
    process.env.INDEXER_USER_AGENT ||
    "kingfyscher-manufacturing-indexer/0.1 (+https://github.com/fyscher/Kingfyscher-Manufacturing)",
  DB_PATH: process.env.INDEXER_DB_PATH || path.join(__dirname, "..", "data", "indexer.db"),
  // Appchain genesis (block 2). Earlier history lives on EOS mainnet.
  APPCHAIN_START: "2025-04-26T17:30:00.000Z",
  // Never checkpoint closer to head than this, so a re-read covers anything late.
  TAIL_LAG_MS: 60_000,
  TAIL_INTERVAL_MS: Number(process.env.INDEXER_TAIL_INTERVAL_MS) || 15_000,
};
