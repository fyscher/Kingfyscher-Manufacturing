const { uplandUserFetch } = require("./uplandClient");

// Kingfyscher Gong: Fyscher's Map Asset Factory design, approved 2026-09-05.
// category=outdoordecor, dGood token_name=jpqvm4gitndu (confirmed on-chain),
// planned production run of 100. See vault: Upland UGC Research.md
const CATEGORY = "outdoordecor";
const DISPLAY_NAME = "kingfyscher gong";
const MAX_PAGES = 5;
const PAGE_SIZE = 50;
const CACHE_TTL_MS = 10 * 60_000;

const cache = new Map(); // accessToken -> { qualifies, expiresAt }

// Checks a connected user's real Upland inventory (via their stored access
// token) for a Kingfyscher Gong. Authoritative regardless of chain traffic,
// since it reads Upland's own current-ownership record, not chain history.
async function hasKingfyscherGong(accessToken) {
  if (!accessToken) return false;

  const hit = cache.get(accessToken);
  if (hit && hit.expiresAt > Date.now()) return hit.qualifies;

  let qualifies = false;
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        currentPage: page,
        pageSize: PAGE_SIZE,
        categories: CATEGORY,
      });
      const result = await uplandUserFetch(`/user/assets/nfts?${params}`, accessToken);
      const items = result?.results || [];

      if (items.some((i) => (i.name || "").trim().toLowerCase() === DISPLAY_NAME)) {
        qualifies = true;
        break;
      }
      if (items.length < PAGE_SIZE) break; // reached the last page
    }
  } catch {
    qualifies = false;
  }

  cache.set(accessToken, { qualifies, expiresAt: Date.now() + CACHE_TTL_MS });
  return qualifies;
}

module.exports = { hasKingfyscherGong };
