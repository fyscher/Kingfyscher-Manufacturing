const { uplandUserFetch } = require("./uplandClient");

// Kingfyscher Gong: Fyscher's Map Asset Factory design, approved 2026-09-05.
// category=outdoordecor, planned production run of 100. See vault:
// Upland UGC Research.md
//
// Upland's /user/assets/nfts returns the internal dGood token_name in its
// `name` field, NOT the human display name ("Kingfyscher Gong" only shows
// up in the mint memo) — confirmed 2026-09-09 against a real connected
// account. Match on the real identifier instead.
const CATEGORY = "outdoordecor";
const TOKEN_NAME = "jpqvm4gitndu";
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
      // `categories` must be array-encoded (categories[]=...) — a plain
      // `categories=outdoordecor` gets rejected with 400 "categories must
      // be an array". Confirmed directly against Upland's API 2026-09-09;
      // a real account with 360 total NFTs made the unfiltered/paginated
      // approach both slow and liable to miss items past MAX_PAGES.
      const params = new URLSearchParams({ currentPage: page, pageSize: PAGE_SIZE });
      params.append("categories[]", CATEGORY);
      const result = await uplandUserFetch(`/user/assets/nfts?${params}`, accessToken);
      const items = result?.results || [];

      if (items.some((i) => i.name === TOKEN_NAME)) {
        qualifies = true;
        break;
      }
      if (items.length < PAGE_SIZE) break; // reached the last page
    }
  } catch (err) {
    console.error("hasKingfyscherGong check failed:", err.status, JSON.stringify(err.data));
    qualifies = false;
  }

  cache.set(accessToken, { qualifies, expiresAt: Date.now() + CACHE_TTL_MS });
  return qualifies;
}

module.exports = { hasKingfyscherGong };
