// Throttled, retrying client for Upland's Hyperion history API and chain RPC.
// Every request goes through one queue, so the whole process never exceeds
// `requestsPerSecond`, however many feeds call it at once.

const MAX_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 60_000; // a hung connection becomes a retry, not a stall

function createClient({
  historyUrl,
  rpcUrl,
  requestsPerSecond = 1,
  userAgent,
  fetchImpl = fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = () => Date.now(),
} = {}) {
  if (!userAgent) throw new Error("userAgent is required (Upland blocks anonymous clients)");
  const minGapMs = 1000 / requestsPerSecond;
  let nextSlot = 0;
  let queue = Promise.resolve();
  let requestCount = 0;

  // Reserve the next free slot; resolves when this request may start.
  const takeSlot = () => {
    const turn = queue.then(async () => {
      const wait = nextSlot - now();
      if (wait > 0) await sleep(wait);
      nextSlot = Math.max(now(), nextSlot) + minGapMs;
    });
    queue = turn.catch(() => {});
    return turn;
  };

  async function request(url, init = {}) {
    for (let attempt = 1; ; attempt++) {
      await takeSlot();
      requestCount++;
      let res;
      try {
        res = await fetchImpl(url, {
          ...init,
          headers: { "User-Agent": userAgent, ...(init.headers || {}) },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS) throw err;
        await sleep(backoffMs(attempt));
        continue;
      }
      if (res.ok) return res.json();

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        const body = (await res.text().catch(() => "")).slice(0, 200);
        const err = new Error(`Upland chain API ${res.status}: ${body}`);
        err.status = res.status;
        throw err;
      }
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
    }
  }

  const qs = params =>
    new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    ).toString();

  return {
    get requestCount() {
      return requestCount;
    },
    getActions: params => request(`${historyUrl}/history/get_actions?${qs(params)}`),
    getDeltas: params => request(`${historyUrl}/history/get_deltas?${qs(params)}`),
    getTableRows: body =>
      request(`${rpcUrl}/v1/chain/get_table_rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: true, ...body }),
      }),
    // Any other GET (e.g. the Developers API) through the same throttle.
    getJson: (url, headers = {}) => request(url, { headers }),
  };
}

function backoffMs(attempt) {
  return Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (attempt - 1));
}

module.exports = { createClient, backoffMs };
