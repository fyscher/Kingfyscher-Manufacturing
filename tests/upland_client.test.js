const { test, describe, after } = require("node:test");
const assert = require("node:assert");

const { uplandFetch, uplandUserFetch } = require("../utils/uplandClient");

describe("Upland API client errors", () => {
  const realFetch = global.fetch;
  after(() => { global.fetch = realFetch; });

  test("an HTML error page (e.g. a gateway timeout) becomes a clean error, not 'Body is unusable'", async () => {
    global.fetch = async () => new Response("<html><body>504 Gateway Time-out</body></html>", { status: 504, headers: { "Content-Type": "text/html" } });
    for (const call of [() => uplandFetch("/cities"), () => uplandUserFetch("/user/assets/nfts", "token")]) {
      await assert.rejects(call, err => {
        assert.strictEqual(err.status, 504);
        assert.match(err.data, /Gateway Time-out/);
        return true;
      });
    }
  });

  test("a JSON error body is kept as data", async () => {
    global.fetch = async () => new Response(JSON.stringify({ message: "categories must be an array" }), { status: 400, headers: { "Content-Type": "application/json" } });
    await assert.rejects(() => uplandUserFetch("/user/assets/nfts?categories=x", "token"), err => {
      assert.deepStrictEqual([err.status, err.data.message], [400, "categories must be an array"]);
      return true;
    });
  });
});
