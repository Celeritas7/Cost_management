// Run with Node and Playwright. Exercise the actual handler, cache, and app ranking without external calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const babel = require(require.resolve("playwright").replace(/index.js$/, "lib/transform/babelBundle.js"));
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const app = read("js/app.jsx");
const client = vm.createContext({});
vm.runInContext(app.slice(app.indexOf("function expenseShopLabel"), app.indexOf("function enrichRow")), client);
const catalogue = client.captureCatalogue([{ shop: "Daiso" }], [{ name: "Yaoko" }, {name: "My retailer", place_id: "old-id"}]);

const calls = [], cache = new Map();
let handler, budget = 0, capped = false, authorized = true, places = [];
const sb = {
  auth: {getUser: async () => ({data:{user: authorized ? {id:"user"} : null}})},
  rpc: async name => {
    if (name === "akatsuki_places_cache_get") return {data:null};
    assert.equal(name, "akatsuki_places_budget_take");
    return capped ? {error:{code:"AK210", message:"Cap"}} : {data:++budget};
  },
  from: () => {
    const filters = {};
    const builder = {
      select: () => builder, eq: (key, value) => {filters[key] = value; return builder;}, gt: () => builder,
      maybeSingle: async () => ({data:cache.get(filters.source + filters.key)}),
      upsert: async row => {cache.set(row.source + row.key, row);}
    };
    return builder;
  }
};
const backend = vm.createContext({
  createClient:()=>sb, Deno:{env:{get:key=>key === "SUPABASE_PUBLISHABLE_KEYS" ? "{}" : "example"},serve:fn=>handler=fn},
  Request, Response, fetch:async (url, init) => {
    calls.push({url, body: JSON.parse(init.body)});
    return Response.json({places});
  }
});
const edge = read("supabase/functions/akatsuki-places-nearby/index.ts").replace(/^import .*?;$/m, "");
vm.runInContext(babel.babelTransform(edge, "index.ts", false, [], []).code, backend);
const lookup = async (body = {}, headers = {}) => {
  const res = await handler(new Request("https://example.test/", {method:"POST", headers, body:JSON.stringify({lat:35, lng:139, mode:"cost_shops", ...body})}));
  return res.json();
};
const place = (id, name, type, m) => ({id, displayName:{text:name}, types:[type], primaryType:type,
  formattedAddress:"Bessho 7-6-8", location:{latitude:35 + m / 111195, longitude:139}});
const ranked = (result, q) => Array.from(client.rankCaptureShops(result.candidates, catalogue, q), row=>row.place_id);
(async () => {
  const taxi = place("taxi", "East exit taxi stand", "taxi_stand", 5);
  const daiso = place("daiso", "ダイソー ライブタワー武蔵浦和店", "discount_store", 70);
  const yaoko = place("yaoko", "ヤオコーロッテスクエア武蔵浦和店", "supermarket", 100);
  const book = place("book","Suharaya", "book_store", 12);
  places = [taxi, place("office", "Office", "corporate_office", 7), place("school","Tutoring", "school", 9),
    place("lib", "Library", "library", 10), book, ...Array.from({length:6},(_,i)=>place("c"+i,"Cafe "+i,"cafe",20+i)),
    daiso, yaoko, place("far","Daiso distant", "store", 1300)];
  let found = await lookup();
  assert(calls[0].body.includedTypes.includes("store"));
  assert(calls[0].body.excludedPrimaryTypes.includes("taxi_stand"));
  assert.equal(calls[0].body.maxResultCount, 20);
  assert.deepEqual(ranked(found), ["daiso","yaoko","book","c0","c1"]);
  assert.equal((await lookup()).cached, true);
  assert.equal(budget,1);
  const oldCost = { "x-akatsuki-app": "cost" };
  const remembered = await lookup({mode:undefined}, oldCost);
  assert.equal(remembered.cached, true);
  assert.equal(remembered.candidates.length, 5);
  assert(!remembered.candidates.some(c => c.place_id === "taxi"));
  assert.equal(budget, 1, "an old Cost screen can use the new merchant cache");
  const oldFirst = await lookup({mode:undefined, lng:139.0001}, oldCost);
  assert.equal(oldFirst.cached, false);
  assert.equal(oldFirst.candidates.length, 5);
  const sameCorner = await lookup({lng:139.0001});
  assert.equal(sameCorner.cached, true);
  assert.deepEqual(ranked(sameCorner).slice(0,2), ["daiso","yaoko"], "legacy response limit preserves the larger pool for current clients");
  const byName = await lookup({query:"Daiso"});
  assert(calls.at(-1).url.endsWith(":searchText"));
  assert.equal(calls.at(-1).body.textQuery,"Daiso");
  assert.deepEqual(ranked(byName,"Daiso"),["daiso"]);
  assert.deepEqual(ranked(byName,"ダイソー"),["daiso"]);
  const branch = client.capturePlace(byName.candidates.find(c=>c.place_id==="daiso"), [], catalogue);
  assert.equal(branch.shop,"Daiso"); assert.equal(branch.place_name,"ライブタワー武蔵浦和店"); assert.equal(branch.place_id,"daiso");
  assert.deepEqual(ranked(await lookup({query:"Yaoko"}),"Yaoko"),["yaoko"]);
  assert.deepEqual(ranked(await lookup({query:"Daiso",wider:true}),"Daiso"),["daiso","far"]);
  assert.deepEqual(ranked(byName,"Unrelated"),[]);
  assert(!client.captureQueryMatches("Daisonia", "Daiso"));
  assert.equal(client.captureIdentity({name:"A renamed branch",place_id:"old-id"},catalogue).saved,"My retailer");
  places = [taxi,book,book]; assert.deepEqual(ranked(await lookup({force:true})),["book"]);
  places = [taxi]; assert.equal((await lookup({force:true})).status,"empty");
  const before = calls.length; capped = true;
  assert.equal((await lookup({query:"new request"})).status,"capped"); assert.equal(calls.length,before);
  assert.equal((await lookup({query:"daiso"})).cached,true);
  authorized = false; assert.equal((await lookup()).status,"error"); assert.equal(calls.length,before);
  authorized = true; capped = false;
  const legacy = await lookup({mode:undefined,force:true}); assert.equal(legacy.candidates[0].place_id,"taxi");
  assert.equal(calls.at(-1).body.maxResultCount,10);
  await lookup({mode:"explore",force:true}); assert.equal(calls.at(-1).body.rankPreference,"POPULARITY");
  console.log("PASS: merchant requests, saved shops first, named branches, aliases, distance, deduplication, no filler, isolated caches, cap, auth and legacy modes");
})().catch(e=>{console.error(e);process.exitCode=1;});
