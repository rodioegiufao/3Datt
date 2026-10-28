"use strict";

const assert = require("node:assert/strict");
const { supabaseRequest, supabaseRequestTodos } = require("../api/_auth");

process.env.SUPABASE_URL = "  https://example.supabase.co/rest/v1/  ";
process.env.SUPABASE_SERVICE_ROLE_KEY = "  service-role-key  ";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof payload === "string" ? payload : JSON.stringify(payload)
  };
}

async function main() {
  const originalFetch = global.fetch;
  try {
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return calls.length < 3 ? response(502, "Bad Gateway") : response(200, [{ id: 1 }]);
    };

    assert.deepEqual(await supabaseRequest("atividades", "?select=id"), [{ id: 1 }]);
    assert.equal(calls.length, 3, "GET deve repetir falhas temporárias do gateway");
    assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/atividades?select=id");
    assert.equal(calls[0].options.headers.apikey, "service-role-key", "a chave deve ser enviada sem espaços acidentais");

    let postCalls = 0;
    global.fetch = async () => { postCalls += 1; return response(502, "Bad Gateway"); };
    await assert.rejects(
      supabaseRequest("atividades", "", { method: "POST", body: "{}" }),
      (error) => error.statusCode === 503 && error.upstreamStatus === 502
    );
    assert.equal(postCalls, 1, "escritas não devem ser repetidas para evitar duplicidade");

    global.fetch = async () => response(502, "Failed to get API key info");
    await assert.rejects(
      supabaseRequest("atividades", "", { method: "POST", body: "{}" }),
      (error) => error.statusCode === 503 && /SUPABASE_SERVICE_ROLE_KEY/.test(error.message)
    );
    const originalWarn = console.warn;
    const originalNodeEnv = process.env.NODE_ENV;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
      process.env.NODE_ENV = "development";
      const pages = [];
      global.fetch = async (url, options) => {
        pages.push({ url, options });
        const start = Number(options.headers.Range.split("-")[0]);
        return response(200, Array.from({ length: Math.min(1000, 2500 - start) }, (_, i) => ({ id: start + i })));
      };
      const all = await supabaseRequestTodos("atividades", "?select=id&obra_id=eq.obra", { headers: { Prefer: "count=exact" } });
      assert.deepEqual(all.map((row) => row.id), Array.from({ length: 2500 }, (_, i) => i));
      assert.deepEqual(pages.map((call) => call.options.headers.Range), ["0-999", "1000-1999", "2000-2999"]);
      assert.ok(pages.every((call) => call.options.headers["Range-Unit"] === "items" && call.options.headers.Prefer === "count=exact"));
      assert.ok(pages.every((call) => new URL(call.url).searchParams.get("order") === "id.asc"));
      assert.ok(pages.every((call) => new URL(call.url).searchParams.get("obra_id") === "eq.obra"));
      assert.equal(warnings.length, 2, "GET com 1000 linhas avisa em desenvolvimento");

      process.env.NODE_ENV = "production";
      let attempt = 0;
      const ranges = [];
      global.fetch = async (url, options) => {
        ranges.push(options.headers.Range);
        assert.equal(new URL(url).searchParams.get("order"), "criado_em.desc,id.asc");
        attempt += 1;
        return attempt === 2 ? response(503, "Service unavailable") : response(200, attempt === 1 ? Array.from({ length: 1000 }, (_, id) => ({ id })) : []);
      };
      assert.equal((await supabaseRequestTodos("atividades", "?order=criado_em.desc,id.asc")).length, 1000);
      assert.deepEqual(ranges, ["0-999", "1000-1999", "1000-1999"], "retry mantém a página e lote vazio encerra múltiplo exato");
      assert.equal(warnings.length, 2, "produção não emite avisos de truncamento");
      global.fetch = async (_url, options) => options.headers.Range === "0-999"
        ? response(200, Array.from({ length: 1000 }, (_, id) => ({ id })))
        : { ...response(416, { message: "Requested range not satisfiable" }), headers: { get: () => "*/1000" } };
      assert.equal((await supabaseRequestTodos("atividades", "", { headers: { Prefer: "count=exact" } })).length, 1000);
      global.fetch = async () => ({ ...response(416, { message: "Invalid range" }), headers: { get: () => "*/1000" } });
      await assert.rejects(supabaseRequestTodos("atividades"), (error) => error.statusCode === 416);
      global.fetch = async () => response(403, { message: "permission denied" });
      await assert.rejects(supabaseRequestTodos("atividades"), (error) => error.statusCode === 403 && /permission denied/.test(error.message));
      await assert.rejects(supabaseRequestTodos("atividades", "", { method: "POST" }), /apenas leituras GET/);
    } finally {
      console.warn = originalWarn;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  } finally {
    global.fetch = originalFetch;
  }

  console.log("supabase resilience: ok");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });