// Run with Node. Model a warm HTTP cache and an offline relaunch of the real app worker and loader.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const scope = 'https://example.test/Cost_management/';
const absolute = req => new URL(req.url || req, scope).href;
const stores = new Map(), httpCache = new Map(), handlers = {};
let online = true, skipped = false, claimed = false;
const fetch = async req => {
  if (!online) throw Error('offline');
  const url = absolute(req);
  if (req.cache !== 'reload' && httpCache.has(url)) return new Response(httpCache.get(url));
  const rel = new URL(url).pathname.slice('/Cost_management/'.length) || 'index.html';
  const body = rel === 'js/app.jsx' ? 'current app' : fs.readFileSync(path.join(root, rel));
  httpCache.set(url, body);
  return new Response(body);
};
const caches = {
  keys: async () => [...stores.keys()],
  delete: async name => stores.delete(name),
  open: async name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    const cache = {
      put: async (req, res) => data.set(absolute(req), res.clone()),
      keys: async () => [...data.keys()].map(url => new Request(url)),
      match: async req => data.get(absolute(req))?.clone(),
      addAll: async requests => {
        const responses = await Promise.all(requests.map(fetch));
        await Promise.all(requests.map((req, i) => cache.put(req, responses[i])));
      }
    };
    return cache;
  }
};
const self = { registration:{scope}, location:new URL(scope), skipWaiting:async () => { skipped = true; },
  clients:{claim:async () => { claimed = true; }}, addEventListener:(type, fn) => { handlers[type] = fn; } };
vm.runInNewContext(read('sw.js'), {self, caches, fetch, URL, Request});
const dispatch = type => new Promise((resolve,reject) => handlers[type]({waitUntil:p=>p.then(resolve,reject)}));
const request = (url, mode = 'cors') => new Promise((resolve,reject) => handlers.fetch({
  request:{url:absolute(url),method:'GET',mode}, respondWith:p=>p.then(resolve,reject)
}));
(async () => {
  const html = read('index.html'), version = html.match(/js\/app-loader\.js\?v=(\d+)/)[1];
  assert(html.includes('js/sw-register.js?v=' + version));
  httpCache.set(absolute('js/app.jsx'), 'stale HTTP response');
  const old = await caches.open('cm-shell-v86'), data = await caches.open('cm-data-v1');
  const cdn = 'https://cdn.jsdelivr.net/npm/example@1.0.0/library.js';
  await old.put('js/app.jsx',new Response('old installed app'));
  await old.put(cdn,new Response('previously downloaded dependency'));
  await data.put('offline-data',new Response('retained'));
  await caches.open('other-app-cache');
  await caches.open('cm-shell-v' + (Number(version) + 1));
  await dispatch('install'); assert(skipped);
  assert(stores.has('cm-shell-v' + version));
  await dispatch('activate'); assert(claimed);
  assert(!stores.has('cm-shell-v86'));
  assert(stores.has('other-app-cache'));
  assert(stores.has('cm-shell-v' + (Number(version) + 1)));
  assert.equal(await (await data.match('offline-data')).text(),'retained');
  online = false;
  assert.equal(await (await request(cdn)).text(),'previously downloaded dependency');
  assert.equal(await (await request('?update=' + version, 'navigate')).text(),html);
  assert.equal(await (await request('js/app.jsx?v=' + version)).text(),'current app');
  assert.equal(await (await request('js/app.jsx')).text(),'current app');

  // Simulate the boot entry from the recovery link while an older cache-first worker is still active.
  const loaded = [], scripts = [];
  const entry = absolute('js/app-loader.js?v=' + version);
  await new Promise((resolve, reject) => {
    const window = {Babel:{transform(src){ assert.equal(src, 'current app'); return {code:'current compiled'}; }}};
    const document = {currentScript:{src:entry}, getElementById:()=>null, createElement:()=>({}), body:{appendChild(el){scripts.push(el.textContent);window.__cmAppRan=true;} }};
    vm.runInNewContext(read('js/app-loader.js'), {window,document,location:new URL(scope),URL,performance,console:{log:resolve,error:(label,err)=>reject(err)},fetch:async url=>{
      loaded.push(url); return new Response(url === 'js/app.jsx' ? 'old installed app' : 'current app');
    }});
  });
  assert.deepEqual(loaded,['js/app.jsx?v=' + version]);
  assert(scripts[0].includes('current compiled'));

  // An update offers one reload button and does not interrupt an open draft.
  const workerEvents = {}, pageEvents = {}, docEvents = {}, buttons = [];
  let reloads = 0, checks = 0;
  const workers = {controller:{},addEventListener:(key,fn)=>workerEvents[key]=fn,
    register:async (url,opts)=>{assert.equal(opts.updateViaCache,'none');return {active:{},update:async()=>checks++};}};
  vm.runInNewContext(read('js/sw-register.js'), {navigator:{serviceWorker:workers,onLine:true},
    document:{visibilityState:'visible',addEventListener:(key,fn)=>docEvents[key]=fn,
      getElementById:()=>buttons[0],createElement:()=>({style:{},addEventListener(key,fn){this[key]=fn;}}),body:{appendChild:el=>buttons.push(el)}},
    window:{addEventListener:(key,fn)=>pageEvents[key]=fn},location:{reload:()=>reloads++},console});
  await pageEvents.load(); assert.equal(checks,1);
  workerEvents.controllerchange(); workerEvents.controllerchange();
  assert.equal(buttons.length,1); assert.equal(reloads,0); buttons[0].click(); assert.equal(reloads,1);
  console.log('PASS: stale installed shell and HTTP cache, update link, offline reopen, retained caches, user-controlled reload');
})().catch(err=>{console.error(err);process.exitCode=1;});
