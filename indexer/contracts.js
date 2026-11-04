// Construction contracts: an owner posts a build as a contract (BUILD memo
// status "suspended", with their opening stake), a builder takes it (action
// n151, p113 = the structure NFT) and is paid up front in the same
// transaction: playuplandme sends the builder 95% and communityupx 5%.
// Verified 2026-11-03 against the in-game Construction Hub's History tab: the
// three newest n151 matched its top three rows exactly (Live Theater, Kansas
// City: 3,572 + 188 = 3,760 UPX). Builders do supply the
// Sparklet: of 40 contracts taken 30-40 days earlier, 28 were finished, 10 were
// still building with 400-6,200 staked, 2 were gone. So a contract's price is
// what owners pay to have a building built: the UPX price of Sparklet-hours.
//
// n151 itself carries no money, and the fee transfers can't be told apart from
// other fees without the transaction (~6,300 a day vs ~55 contracts), so each
// contract's transaction is read once (one request per contract).
const { nowIso } = require("./db");

const ESCROW = "playuplandme";
const FEE_ACCOUNT = "communityupx";
const amount = d => Number(d?.amount ?? String(d?.quantity || "").split(" ")[0]) || 0;

/** The builder, what they got, and the fee, from a contract's transaction actions. */
function contractPayout(actions) {
  let builder = null;
  let paid = 0;
  let fee = 0;
  for (const a of actions || []) {
    const act = a.act || a;
    if (act.account !== "upxtokenacct" || act.name !== "transfer" || act.data?.from !== ESCROW) continue;
    if (act.data.to === FEE_ACCOUNT) fee += amount(act.data);
    else {
      builder = act.data.to;
      paid += amount(act.data);
    }
  }
  return { builder, paid, fee, price: paid + fee || null };
}

/**
 * Read the transaction of every stored contract (feed `contracts`) that has no
 * price yet, newest first, and store builder, price and fee. A contract whose
 * transaction shows no payout is stored with no price, so it isn't read again.
 * Returns contracts read.
 */
async function fetchContractPayouts({ db, client, limit = Infinity, log = () => {}, shouldStop = () => false }) {
  const todo = db.prepare(`SELECT r.global_sequence, r.trx_id, r.ts, r.data FROM raw_actions r
    WHERE r.feed = 'contracts' AND NOT EXISTS (SELECT 1 FROM construction_contracts c WHERE c.global_sequence = r.global_sequence)
    ORDER BY r.ts DESC LIMIT ?`).all(Number.isFinite(limit) ? limit : -1);
  const insert = db.prepare(`INSERT OR REPLACE INTO construction_contracts (global_sequence, trx_id, ts, nft_id, builder, price, fee, fetched_at)
    VALUES (@global_sequence, @trx_id, @ts, @nft_id, @builder, @price, @fee, @fetched_at)`);
  let n = 0;
  for (const r of todo) {
    if (shouldStop()) break;
    const tx = await client.getTransaction(r.trx_id);
    const p = contractPayout(tx.actions);
    const nft = Number(JSON.parse(r.data).p113);
    insert.run({
      global_sequence: r.global_sequence, trx_id: r.trx_id, ts: r.ts, nft_id: Number.isFinite(nft) ? nft : null,
      builder: p.builder, price: p.price, fee: p.fee || null, fetched_at: nowIso(),
    });
    if (++n % 500 === 0) log(`contracts: ${n} of ${todo.length} read (${client.requestCount} requests)`);
  }
  if (n) log(`contracts: ${n} contract prices read`);
  return n;
}

module.exports = { contractPayout, fetchContractPayouts };
