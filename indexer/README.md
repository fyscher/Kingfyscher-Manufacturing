# Upland market indexer (Stage 1)

Pulls Upland's public appchain history into a local SQLite database so the app can chart full price history and, later, score deals. Read-only: it never logs into the game, never uses session tokens, and never sends a transaction.

## Politeness rules (Upland's Terms of Service restrict automated access)
- **Throttled:** one request per second by default (`INDEXER_RPS` or `--rps`), through a single queue for the whole process.
- **Identified:** every request sends `INDEXER_USER_AGENT` (default names this project and repo).
- **Backs off:** 429 and 5xx responses are retried with exponential backoff, honoring `Retry-After`; other errors stop the run.
- **No personal info:** usernames in notarisation memos are redacted before anything is stored. Only public EOS account ids are kept.

## Commands
```bash
npm run indexer -- backfill [--from ISO] [--to ISO] [--feeds n112,t2] [--chunk-hours 24] [--rps 1]
npm run indexer -- tail [--feeds ...]       # follow the chain live (INDEXER_TAIL_INTERVAL_MS, default 15s)
npm run indexer -- designs                  # snapshot the NFT design registry (~330 requests)
npm run indexer -- decode --from ISO --to ISO   # rebuild decoded tables from stored raw rows, no network
npm run indexer -- listings                # snapshot the whole live property listing book (chain table t2, ~450-500 requests)
npm run indexer -- properties [--cities 1,3]   # property catalog from the Developers API (needs DEVSHOPID, KFM_PASSWORD, UPLAND_URI)
npm run indexer -- floors [--cities 1,3] [--top 10]
npm run indexer -- stats
```
The database defaults to `data/indexer.db` (`INDEXER_DB_PATH` or `--db`). `--from` defaults to the appchain launch (2025-04-26).

Backfills work a day at a time (all feeds, then decode that day) and checkpoint after every window, so Ctrl-C and a rerun of the same command resumes where it stopped. Backfill and tail keep separate checkpoints.

## Feeds
| Feed | Source | Becomes |
|---|---|---|
| `n112` | `playuplandme:n112` actions | `nft_sales` (with `sale_transfers`) |
| `sale_transfers` | `uplandnftact:transfernft`, kept only when playuplandme hands an NFT to a buyer | names the item in `nft_sales` |
| `n5` + `n5_payouts` | `playuplandme:n5`, and UPX transfers with memo `n5` | `property_sales` (UPX), with the seller |
| `n52` | `playuplandme:n52` | `property_sales` (USD), priced from the removed `t2` row |
| `t2` | table deltas of the live property listings | `property_listing_events` |
| `t3` | table deltas of the live property offers | `property_offer_events` |

NFT resale `price` is what the seller listed at (`p141 - p142`); the buyer pays that plus the 5% fee (`buyer_paid`). Raw rows are kept, so a better decoder only needs `decode`, never another download.

## Floors (the Floor Board)
- `listings` copies the whole on-chain listing book into `listings_current`. It's big (well over 400,000 rows on 2026-11-01), so it's a one-off or occasional job; the `tail` keeps it current afterwards by replaying the `t2` table changes it already collects (`applyListingDeltas`: writes upserted, removals deleted, removals first within a block).
- `properties` pages each city's catalog (`/v2/properties`, 500 per request) for city, neighborhood and mint price. Listings whose property isn't catalogued yet show up as "unmapped".
- The app serves `GET /api/upland/floors?cities=&top=` and `GET /api/upland/floors/cities` straight from this database (read-only, `INDEXER_DB_PATH`); the Floor Board screen sits on top. Floor = cheapest UPX ask; also the 3rd cheapest (a sturdier floor, since the single cheapest is often bait or a typo), the median ask, the lowest price relative to mint, and the USD floor.

## Cost
Measured 2026-10-17: six hours of history took 18 requests and matched the history server's own counts exactly (586 NFT resales, 106 UPX and 28 USD property sales, 884 listing and 235 offer changes). The busiest feed (`sale_transfers`) needs about 48 requests per day of history, so a full backfill since April 2025 is roughly 30,000 requests: about 8-9 hours at 1 req/s.

## Not yet covered
Mints, burns, merges, staking, token flows, and the EOS-era history before 2025-04-26 (same action formats, served by `eos.hyperion.eosrio.io`). NFT asking prices are not on-chain at all.
