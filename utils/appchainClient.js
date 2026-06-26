const HISTORY_URL = "https://chain-history.upland.me/v2";
const RPC_URL = "https://chain-api.upland.me";

const getActions = async ({
  filter,
  account,
  limit = 20,
  sort = "desc",
  after,
  before,
} = {}) => {
  const params = new URLSearchParams({ limit, sort });
  if (filter) params.set("filter", filter);
  if (account) params.set("account", account);
  if (after) params.set("after", after);
  if (before) params.set("before", before);

  const response = await fetch(
    `${HISTORY_URL}/history/get_actions?${params}`,
  );
  if (!response.ok) throw new Error(`Hyperion error: ${response.status}`);
  return response.json();
};

// n5 = property ownership notarization: fired when a property changes hands.
// Fields: p14=new owner EOS, a45=property ID uint64, p24=price UPX asset,
// memo="...owns {ADDRESS} on Upland. Initial minting transaction: {txHash}"
const getPropertyPurchases = (options = {}) =>
  getActions({ ...options, filter: "playuplandme:n5" });

const getTableRows = async ({ code, scope, table, limit = 10 }) => {
  const response = await fetch(`${RPC_URL}/v1/chain/get_table_rows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, scope, table, limit, json: true }),
  });
  if (!response.ok) throw new Error(`RPC error: ${response.status}`);
  return response.json();
};

const parsePurchaseAction = (action) => {
  const data = action.act?.data || {};
  const priceUpx = parseFloat((data.p24 || "0 UPX").split(" ")[0]);

  // Extract address from the notarization memo
  const memo = data.memo || "";
  const addrMatch = memo.match(/owns (.+?) on Upland/);

  return {
    trxId: action.trx_id,
    blockNum: action.block_num,
    buyerEos: data.p14,
    propertyId: String(data.a45 || ""),
    priceUpx,
    purchasedAt: action["@timestamp"] || action.timestamp,
    address: addrMatch ? addrMatch[1] : null,
  };
};

module.exports = {
  getActions,
  getPropertyPurchases,
  getTableRows,
  parsePurchaseAction,
};
