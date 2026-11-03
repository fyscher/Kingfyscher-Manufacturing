const { upsert, nowIso } = require("./db");

/** Every row of a chain table, following next_key until `more` is false. */
async function pageTable(client, body, { onPage = () => {} } = {}) {
  const rows = [];
  let lowerBound;
  for (;;) {
    const res = await client.getTableRows({ ...body, limit: 1000, lower_bound: lowerBound });
    rows.push(...(res.rows || []));
    onPage(rows.length);
    if (!res.more || !res.next_key) return rows;
    lowerBound = res.next_key;
  }
}

const units = supply => (typeof supply === "string" ? Number.parseInt(supply, 10) : null);

/**
 * Snapshot the NFT design registry: every design's supply (dgoodstats, scoped
 * per category) and its display name (nft.metadata). This is how sales get
 * stable design ids instead of trusting memo text. ~330 requests in total.
 */
async function syncDesigns({ db, client, log = () => {} }) {
  const updatedAt = nowIso();
  const categories = (
    await pageTable(client, { code: "uplandnftact", scope: "uplandnftact", table: "categoryinfo" })
  ).map(r => r.category);
  log(`designs: ${categories.length} categories`);

  let designCount = 0;
  for (const category of categories) {
    const rows = await pageTable(client, { code: "uplandnftact", scope: category, table: "dgoodstats" });
    designCount += upsert(
      db,
      "designs",
      rows.map(r => ({
        category,
        token_name: r.token_name,
        category_name_id: String(r.category_name_id),
        max_supply: units(r.max_supply),
        issued_supply: units(r.issued_supply),
        current_supply: units(r.current_supply),
        updated_at: updatedAt,
      })),
    );
  }

  const names = await pageTable(client, { code: "uplandnftact", scope: "uplandnftact", table: "nft.metadata" });
  const nameCount = upsert(
    db,
    "design_names",
    names.map(r => ({
      category_name_id: String(r.category_name_id),
      display_name: r.display_name ?? null,
      series_id: r.series_id == null ? null : String(r.series_id),
      updated_at: updatedAt,
    })),
  );
  log(`designs: ${designCount} designs, ${nameCount} names, ${client.requestCount} requests`);
  return { categories: categories.length, designs: designCount, names: nameCount };
}

module.exports = { pageTable, syncDesigns };
