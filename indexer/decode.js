// Pure decoders: raw Upland chain rows in, market rows out. No I/O here, so
// tests feed them recorded payloads directly. What each action means is
// documented in the vault's "Upland Appchain Reference" (verified 2026-10-15).

/** "630.00 UPX" -> { amount: 630, symbol: "UPX" }; null when unparseable. */
function parseAsset(value) {
  if (Array.isArray(value)) value = value[0] === "asset" ? value[1] : null; // variant ["asset", "1.00 UPX"]
  if (typeof value !== "string") return null;
  const [amt, symbol] = value.trim().split(/\s+/);
  const amount = Number.parseFloat(amt);
  return Number.isFinite(amount) ? { amount, symbol: symbol || null } : null;
}

const round2 = n => Math.round(n * 100) / 100;

/** Hyperion timestamps are UTC with no zone ("2026-10-16T01:22:03.000"). */
function chainTimeIso(ts) {
  const zoned = /[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`;
  return new Date(zoned).toISOString();
}

// Notarisation memos name the player ("Upland user X with corresponding EOS
// account ..."). Usernames are never stored: the ToS forbids harvesting other
// users' personal info. Public EOS account ids are kept.
function redactMemo(memo) {
  return typeof memo === "string" ? memo.replace(/(Upland user )\S+/g, "$1[redacted]") : memo;
}

function redactData(data) {
  return data && typeof data.memo === "string" ? { ...data, memo: redactMemo(data.memo) } : data;
}

/** A Hyperion action as stored: one row per action, keyed by global_sequence. */
function toRawAction(feed, a) {
  return {
    global_sequence: String(a.global_sequence),
    feed,
    trx_id: a.trx_id,
    block_num: a.block_num,
    ts: chainTimeIso(a["@timestamp"] || a.timestamp),
    contract: a.act.account,
    name: a.act.name,
    data: redactData(a.act.data || {}),
  };
}

/** A Hyperion table delta as stored. present 1 = row written, 0 = row removed. */
function toRawDelta(feed, d) {
  return {
    id: `${d.block_num}:${d.code}:${d.scope}:${d.table}:${d.primary_key}:${d.present ? 1 : 0}`,
    feed,
    block_num: d.block_num,
    ts: chainTimeIso(d.timestamp),
    code: d.code,
    scope: d.scope,
    table_name: d.table,
    primary_key: String(d.primary_key),
    present: d.present ? 1 : 0,
    data: d.data || {},
  };
}

/** `...is now the owner of the Seeds NFT "Boxwood" mint 19091. NFT ID: 7326650, ...` */
function parseSaleMemo(memo) {
  const m = /is now the owner of the (.+?) NFT "([^"]+)"(?: mint (\d+))?/.exec(memo || "");
  if (!m) return null;
  const id = /NFT ID: (\d+)/.exec(memo);
  return { category: m[1], displayName: m[2], mint: m[3] ? Number(m[3]) : null, nftId: id ? id[1] : null };
}

/** The item half of an NFT resale: playuplandme hands the NFT to the buyer. */
const isSaleTransfer = data =>
  data?.from === "playuplandme" && /is now the owner/.test(data.memo || "");

/**
 * NFT resales. `n112` carries buyer, seller and money; the transfernft in the
 * same transaction names the item. Price is what the seller listed at
 * (p141 - p142): the buyer pays that plus the 5% fee.
 */
function decodeNftSales(n112Rows, transferRows) {
  const itemByTrx = new Map();
  for (const t of transferRows) if (isSaleTransfer(t.data)) itemByTrx.set(t.trx_id, t);

  return n112Rows.map(r => {
    const paid = parseAsset(r.data.p141);
    const fee = parseAsset(r.data.p142) || { amount: 0 };
    const item = itemByTrx.get(r.trx_id);
    const memo = item ? parseSaleMemo(item.data.memo) : null;
    return {
      global_sequence: r.global_sequence,
      trx_id: r.trx_id,
      ts: r.ts,
      block_num: r.block_num,
      buyer: r.data.p14 ?? null,
      seller: r.data.p25 ?? null,
      price: paid ? round2(paid.amount - fee.amount) : null,
      buyer_paid: paid ? paid.amount : null,
      fee: fee.amount,
      currency: paid?.symbol ?? null,
      dgood_id: item ? String(item.data.dgood_ids?.[0] ?? memo?.nftId ?? "") || null : null,
      display_name: memo?.displayName ?? null,
      category: memo?.category ?? null,
      mint: memo?.mint ?? null,
    };
  });
}

/**
 * UPX property resales. `n5` has buyer, property and price; the seller is the
 * payee of the playuplandme transfer with memo "n5" in the same transaction.
 */
function decodePropertySalesUpx(n5Rows, payoutRows) {
  const sellerByTrx = new Map();
  for (const p of payoutRows) {
    if (p.data.from === "playuplandme" && p.data.memo === "n5") sellerByTrx.set(p.trx_id, p.data.to);
  }
  return n5Rows.map(r => {
    const price = parseAsset(r.data.p24);
    const addr = /owns (.+?) on Upland/.exec(r.data.memo || "");
    return {
      global_sequence: r.global_sequence,
      trx_id: r.trx_id,
      ts: r.ts,
      block_num: r.block_num,
      kind: "upx",
      property_id: String(r.data.a45 ?? ""),
      buyer: r.data.p14 ?? null,
      seller: sellerByTrx.get(r.trx_id) ?? null,
      price: price?.amount ?? null,
      currency: price?.symbol ?? null,
      address: addr ? addr[1] : null,
    };
  });
}

/**
 * USD property sales. `n52` records the buyer (p14) taking the property; card
 * payment is off-chain. The price is the FIAT ask on the t2 listing row removed
 * in the same block.
 */
function decodePropertySalesUsd(n52Rows, t2Deltas) {
  const removed = new Map();
  for (const d of t2Deltas) {
    if (d.present === 0) removed.set(`${d.block_num}:${d.data.a34}`, d.data);
  }
  return n52Rows.map(r => {
    const listing = removed.get(`${r.block_num}:${r.data.a45}`);
    const price = parseAsset(listing?.f3);
    return {
      global_sequence: r.global_sequence,
      trx_id: r.trx_id,
      ts: r.ts,
      block_num: r.block_num,
      kind: "usd",
      property_id: String(r.data.a45 ?? ""),
      buyer: r.data.p14 ?? null,
      seller: listing?.a35 ?? null,
      price: price?.amount ?? null,
      currency: price?.symbol ?? null,
      address: null,
    };
  });
}

/** Property listing book changes (table t2): an ask appearing, changing or leaving. */
function decodeListingEvents(t2Deltas) {
  return t2Deltas.map(d => ({
    id: d.id,
    ts: d.ts,
    block_num: d.block_num,
    property_id: String(d.data.a34 ?? d.primary_key),
    seller: d.data.a35 ?? null,
    price_upx: parseAsset(d.data.f4)?.amount ?? null,
    price_fiat: parseAsset(d.data.f3)?.amount ?? null,
    flags: [d.data.f21, d.data.f22, d.data.f23].map(f => (f ? 1 : 0)).join(""),
    present: d.present,
  }));
}

/** Property offer changes (table t3). f25 is a variant: ["asset", "1.00 UPX"] or ["uint64", n]. */
function decodeOfferEvents(t3Deltas) {
  return t3Deltas.map(d => {
    const price = parseAsset(d.data.f25);
    return {
      id: d.id,
      ts: d.ts,
      block_num: d.block_num,
      offer_id: String(d.data.f15 ?? d.primary_key),
      property_id: String(d.data.f14 ?? ""),
      owner: d.data.a35 ?? null,
      offerer: d.data.f31 ?? null,
      price: price?.amount ?? null,
      currency: price?.symbol ?? null,
      present: d.present,
    };
  });
}

module.exports = {
  parseAsset,
  chainTimeIso,
  redactMemo,
  toRawAction,
  toRawDelta,
  parseSaleMemo,
  isSaleTransfer,
  decodeNftSales,
  decodePropertySalesUpx,
  decodePropertySalesUsd,
  decodeListingEvents,
  decodeOfferEvents,
};
