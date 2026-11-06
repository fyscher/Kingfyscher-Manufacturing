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
npm run indexer -- nfts [--categories outdoordecor,structornmt]   # snapshot map-asset NFTs and escrow (~9,800 requests, ~3h, resumable)
npm run indexer -- market                  # rebuild the map asset browser's summary and the building dropdown (the tail does both)
npm run indexer -- buildings               # copy which building stands on which property (~650 requests)
npm run indexer -- nfts --add structure    # add a category to an existing NFT snapshot (~9,800 requests, resumable)
npm run indexer -- neighborhoods [--cities 1,3]   # neighborhood boundaries + which border each other (Developers API, ~66 requests)
npm run indexer -- appraisal [--bundles]   # rebuild the appraiser's tables (the tail does it hourly); --bundles first fills sale bundles from stored history
npm run indexer -- stats
```
The database defaults to `data/indexer.db` (`INDEXER_DB_PATH` or `--db`). `--from` defaults to the appchain launch (2025-04-26).

Backfills work a day at a time (all feeds, then decode that day) and checkpoint after every window, so Ctrl-C and a rerun of the same command resumes where it stopped. Backfill and tail keep separate checkpoints.

## Feeds
| Feed | Source | Becomes |
|---|---|---|
| `n112` | `playuplandme:n112` actions | `nft_sales` (with `sale_transfers`) |
| `nft_transfers` | `uplandnftact:transfernft`, kept when an NFT moves into or out of escrow (listing, delist, resale, store handout) | names the item in `nft_sales`; `nft_escrow_events` |
| `n5` + `n5_payouts` | `playuplandme:n5`, and UPX transfers with memo `n5` | `property_sales` (UPX), with the seller |
| `n52` | `playuplandme:n52` | `property_sales` (USD), priced from the removed `t2` row |
| `t2` | table deltas of the live property listings | `property_listing_events` |
| `t3` | table deltas of the live property offers | `property_offer_events` |

NFT resale `price` is what the seller listed at (`p141 - p142`); the buyer pays that plus the 5% fee (`buyer_paid`). Raw rows are kept, so a better decoder only needs `decode`, never another download. About 3.5% of NFT resales are at exactly 1 UPX: creators' giveaways, gifts and moves between a player's own accounts, not market prices (of ~120k map-asset resales only 79 fell between 1 and 5 UPX; 83% of the 1-UPX ones came from a seller handing out that design 3+ times). The browser's "cheapest sold" (`market_designs.floor_30d`) leaves them out, and anything under a quarter of the design's median real sale.

## Floors (the Floor Board)
- `listings` copies the whole on-chain listing book into `listings_current`. It's big (well over 400,000 rows on 2026-11-01), so it's a one-off or occasional job; the `tail` keeps it current afterwards by replaying the `t2` table changes it already collects (`applyListingDeltas`: writes upserted, removals deleted, removals first within a block).
- `properties` pages each city's catalog (`/v2/properties`, 500 per request) for city, neighborhood and mint price. Listings whose property isn't catalogued yet show up as "unmapped".
- The app serves `GET /api/upland/floors?cities=&top=` and `GET /api/upland/floors/cities` straight from this database (read-only, `INDEXER_DB_PATH`); the Floor Board screen sits on top. Floor = cheapest UPX ask; also the 3rd cheapest (a sturdier floor, since the single cheapest is often bait or a typo), the median ask, the lowest price relative to mint, and the USD floor.

## Map assets (the browser at /market.html)
NFT asking prices are not on-chain (the contract's `asks` table is empty), but a listed NFT sits in escrow, owned by `playuplandme`. Verified on 1,000 transfers (2026-11-03): listing = owner -> playuplandme with an empty memo; delist = back to the owner, empty memo; resale = playuplandme -> buyer, "is now the owner" memo. Upland also hands out store stock from escrow ("is the initial owner", "owns the NFT"; over half of the moves out), so every move out of escrow counts.
- `nfts` reads the whole `dgood` table (~9.8M NFTs) and keeps the tracked categories (decorations, structure ornaments, seeds, land vehicles, Uppies: ~3.5M) in `nft_items`, with `in_escrow`. Its cursor is checkpointed every page, so a rerun resumes. When it finishes, the escrow moves stored since it began are replayed (`nfts:applied`), so changes made during the 3-hour read aren't lost.
- The chain API can't page more than 1,000 rows sharing one owner (its continuation key is the owner name), so "everything in escrow" can't be read directly; that's why it's a full table read.
- After that, `tail` keeps escrow current from `nft_transfers` (starting from the earlier of its checkpoint and `nfts:applied`), reads newly minted NFTs when an escrow move names one past the last id read (`topUpNfts`), tags sales with their design (`enrichSales`, only once a snapshot has finished), and rebuilds `market_designs` every 5 minutes.
- "For sale" = NFTs in escrow whose latest escrow move was a listing. Other escrow (placed on a property that's for sale, or in escrow since before the stored history) is shown separately.
- Listing a property escrows what's placed on it with the same empty memo as an NFT listing. `tagBundles` (after every decode) turns an escrow move into kind `bundle`, with the `property_id`, when the same account listed a property in the same block (2026-11-03: 230,212 such moves in 90 days; the 36,682 NFTs still in escrow that way all sit on properties listed right now).
- Storage: escrow moves run ~16-18k a day, so 90 days of `nft_transfers` is ~2M raw rows (~0.7 GB).

## Buildings (the Building Browser)
Upland's own `POST /buildings` search is broken server-side (500 "ST_Intersects: Operation on mixed SRID geometries", even for its documented example, 2026-11-03), and property records don't mention buildings. The chain does:
- `buildings` copies table `a21` (playuplandme): one row per placed building, `f45` = the structure NFT, `a34` = the property, `f54` = the property's city id (matches the catalog on 655,066 of 655,499 rows). ~650 requests. The `a21` feed in the tail keeps it current (`buildings:applied`, same replay rule as the listing book).
- **A property can hold many buildings**: big parcels get developed with many structures (24,138 properties hold 2+, up to 157 on one, 2026-11-03). Each row carries `on_property` (how many share its property); the Building Browser keeps parcels out of prices by default, since a parcel's price is for all its buildings.
- A construction starts with a SPARKLT transfer to playuplandme, memo `BUILD,<nft>,<property>,<city>,...`. The `builds` feed keeps those (`building_builds`), so each building gets `built_at`; a building with none predates the stored history. Sales from before a building went up don't count as its sales.
- Which building each NFT is comes from `nft_items` (category `structure`, added to an existing database with `nfts --add structure`, a full `dgood` read of ~9,800 requests).
- `building_types` is the dropdown (per city and building: built, for sale, cheapest UPX ask), rebuilt by the tail every 15 minutes (~10 s). Names come from `buildingName`: the chain's building "names" are mostly descriptions, and the four original designs are literally named "test".

## Property appraiser (and the build calculator)
- `neighborhoods` stores each city's neighborhood polygons (`GET /neighborhoods?cityId=`) and which pairs border each other (within 30 m) in `neighborhood_adjacency`. A weekly timer refreshes it on the container.
- Every property sale's transaction also hands the buyer what was placed on the property (decor, ornaments, vehicles, building NFTs): `decodeSaleBundles` stores those in `property_sale_nfts`, from the decode step and, for older stored history, `appraisal --bundles`.
- `refreshAppraisal` (hourly in the tail, ~2 minutes) rebuilds `appraisal_sales` (each sale with what stood on the property and how many NFTs came with it), `building_values` (per type: price minus the land estimate over single-building UPX sales in 180 days, its 95% median band, same-property before/after pairs, and the rules from the latest BUILD memo: Sparklet-hours, min and max stake, builds and contracts in 90 days) and `appraisal_stats` (back-test, the property market's UPX-per-dollar rate, what bundled decor does to a price).
- Land = mint x the weighted median price/mint of bare-land UPX sales (no finished building, no NFTs handed over) in the neighborhood (counted double) and the bordering ones over 90 days; two rings, then 180 days, then the city when there are fewer than 15.
- The app's `/api/upland/appraiser/*` routes call `appraiseProperty` read-only.

## Cost
Measured 2026-10-17: six hours of history took 18 requests and matched the history server's own counts exactly (586 NFT resales, 106 UPX and 28 USD property sales, 884 listing and 235 offer changes). The busiest feed (`sale_transfers`) needs about 48 requests per day of history, so a full backfill since April 2025 is roughly 30,000 requests: about 8-9 hours at 1 req/s.

## Not yet covered
Mints, burns, merges, staking, token flows, and the EOS-era history before 2025-04-26 (same action formats, served by `eos.hyperion.eosrio.io`). NFT asking prices are not on-chain at all; the map asset browser shows sale prices and which serials are listed.
