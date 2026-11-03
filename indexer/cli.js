#!/usr/bin/env node
// Upland market indexer (Stage 1). Read-only and throttled; see indexer/README.md.
//
//   node indexer/cli.js backfill [--from ISO] [--to ISO] [--feeds n112,t2] [--chunk-hours 24]
//   node indexer/cli.js tail [--feeds ...]
//   node indexer/cli.js designs
//   node indexer/cli.js decode --from ISO --to ISO
//   node indexer/cli.js listings                      # snapshot the live property listing book
//   node indexer/cli.js properties [--cities 1,3]     # property catalog (needs DEVSHOPID, KFM_PASSWORD, UPLAND_URI)
//   node indexer/cli.js properties --unmapped [N]     # look up listed properties the city paging missed
//   node indexer/cli.js floors [--cities 1,3] [--top 10]
//   node indexer/cli.js nfts [--categories outdoordecor,structornmt]   # snapshot NFTs + escrow (~9,800 requests, resumable)
//   node indexer/cli.js market                        # rebuild the map asset browser's summary
//   node indexer/cli.js stats

const config = require("./config");
const { createClient } = require("./hyperion");
const { openDb, stats } = require("./db");
const { FEEDS, backfill, tail, decodeRange } = require("./sync");
const { syncDesigns } = require("./designs");
const { snapshotListings, applyListingDeltas, syncProperties, lookupUnmapped, computeFloors } = require("./floors");
const { DEFAULT_CATEGORIES, snapshotNfts, enrichSales, refreshMarket } = require("./nfts");

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith("--")) throw new Error(`unexpected argument ${rest[i]}`);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) opts[rest[i].slice(2)] = true; // bare flag
    else opts[rest[i].slice(2)] = rest[++i];
  }
  return { command, opts };
}

const log = msg => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  const db = openDb(opts.db || config.DB_PATH);
  const client = createClient({
    historyUrl: config.HISTORY_URL,
    rpcUrl: config.RPC_URL,
    requestsPerSecond: Number(opts.rps) || config.REQUESTS_PER_SECOND,
    userAgent: config.USER_AGENT,
  });
  const feeds = opts.feeds ? opts.feeds.split(",") : Object.keys(FEEDS);
  for (const f of feeds) if (!FEEDS[f]) throw new Error(`unknown feed ${f}; known: ${Object.keys(FEEDS).join(", ")}`);

  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    log("stopping after the current request (Ctrl-C again to force)");
  });

  switch (command) {
    case "backfill":
      log(`backfill at ${opts.rps || config.REQUESTS_PER_SECOND} req/s, feeds: ${feeds.join(", ")}`);
      await backfill({
        db,
        client,
        feeds,
        from: opts.from || config.APPCHAIN_START,
        to: opts.to || new Date().toISOString(),
        chunkHours: Number(opts["chunk-hours"]) || 24,
        log,
        shouldStop: () => stopping,
      });
      break;
    case "tail":
      log(`tailing every ${config.TAIL_INTERVAL_MS / 1000}s, feeds: ${feeds.join(", ")}`);
      await tail({ db, client, feeds, intervalMs: config.TAIL_INTERVAL_MS, lagMs: config.TAIL_LAG_MS, log, shouldStop: () => stopping });
      break;
    case "designs":
      await syncDesigns({ db, client, log });
      break;
    case "decode":
      if (!opts.from || !opts.to) throw new Error("decode needs --from and --to");
      log(JSON.stringify(decodeRange(db, opts.from, opts.to)));
      break;
    case "listings":
      await snapshotListings({ db, client, log });
      break;
    case "properties": {
      const { DEVSHOPID, KFM_PASSWORD, UPLAND_URI } = process.env;
      if (!DEVSHOPID || !KFM_PASSWORD || !UPLAND_URI) throw new Error("properties needs DEVSHOPID, KFM_PASSWORD and UPLAND_URI (source the app's .env)");
      const common = {
        db,
        client,
        apiUrl: UPLAND_URI,
        basicAuth: Buffer.from(`${DEVSHOPID}:${KFM_PASSWORD}`).toString("base64"),
        log,
        shouldStop: () => stopping,
      };
      if (opts.unmapped !== undefined) await lookupUnmapped({ ...common, limit: opts.unmapped === true ? Infinity : Number(opts.unmapped) || Infinity });
      else await syncProperties({ ...common, cityIds: opts.cities ? opts.cities.split(",").map(Number) : [] });
      break;
    }
    case "floors": {
      applyListingDeltas(db);
      const r = computeFloors(db, { cityIds: opts.cities ? opts.cities.split(",").map(Number) : [], top: Number(opts.top) || 10 });
      console.log(JSON.stringify({ ...r, cities: r.cities.slice(0, 20) }, null, 2));
      break;
    }
    case "nfts":
      await snapshotNfts({
        db,
        client,
        categories: opts.categories ? opts.categories.split(",") : DEFAULT_CATEGORIES,
        log,
        shouldStop: () => stopping,
      });
      break;
    case "market":
      // Escrow moves are applied by the tail only, which knows they've all been fetched.
      log(`sales tagged: ${enrichSales(db)}, designs: ${refreshMarket(db)}`);
      break;
    case "stats":
      console.log(JSON.stringify(stats(db), null, 2));
      break;
    default:
      console.log("usage: node indexer/cli.js <backfill|tail|designs|decode|listings|properties|floors|nfts|market|stats> [--options]");
      process.exitCode = 1;
  }
  log(`done, ${client.requestCount} requests`);
  db.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
