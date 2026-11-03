/* app-loader.js — runs js/app.jsx without compiling it on every open.
 *
 * Before v72 the page loaded Babel (2.8 MB) and compiled the whole app with the `env` and
 * `react` presets on every open: about 6–7 s of CPU on a server, more on a phone. Now:
 *   1. fetch js/app.jsx (the service worker serves it from its cache);
 *   2. look up the compiled code for exactly this source (FNV-1a hash) in Cache Storage;
 *   3. only on a miss — the first open after an update — load Babel and compile with the
 *      `react` preset plus block scoping (JSX → React.createElement, const/let → var as
 *      before; the rest of env is not needed by any browser this app runs on), then keep it;
 *   4. run it as a classic script, the same global scope text/babel gave it.
 * Edit app.jsx exactly as before: a changed file is a new hash, so it is recompiled once.
 */
(function () {
  const BABEL = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.23.9/babel.min.js';
  const CACHE = 'cm-compiled';           // sw.js keeps this cache across shell versions
  const SRC = 'js/app.jsx';
  // Bump when the compile options change: it is part of the cache key, so every phone drops a
  // copy built the old way. v2: block scoping (v72's copies kept `const` and could not start).
  const COMPILER = 'v2';

  const fnv = (s) => {                   // 32-bit FNV-1a over UTF-16 units: fast, no secure context needed
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + '-' + s.length;
  };
  const loadScript = (src) => new Promise((ok, fail) => {
    const el = document.createElement('script');
    el.src = src; el.onload = ok; el.onerror = () => fail(new Error('could not load ' + src));
    document.head.appendChild(el);
  });
  // An inline script runs synchronously on append, and a SyntaxError or a throw at the top level
  // stops it before its last line. The flag on that last line tells the loader it really ran.
  const run = (code) => {
    window.__cmAppRan = false;
    const el = document.createElement('script');
    el.textContent = code + '\n;window.__cmAppRan=true;\n//# sourceURL=app.jsx.compiled.js';
    document.body.appendChild(el);
    return window.__cmAppRan === true;
  };
  const fail = (e) => {
    console.error('[app-loader]', e);
    const root = document.getElementById('root');
    if (root && !root.childNodes.length) root.innerHTML = '<div style="padding:24px;font-family:sans-serif;color:#f87171">Cost Management could not start: ' +
      String(e && e.message || e).replace(/[<&]/g, (c) => ({ '<': '&lt;', '&': '&amp;' }[c])) + '<br><br>Check the connection and reload.</div>';
  };

  async function start() {
    const t0 = performance.now();
    const res = await fetch(SRC);
    if (!res.ok) throw new Error(SRC + ' ' + res.status);
    const src = await res.text();
    const key = new URL('compiled/' + COMPILER + '-' + fnv(src) + '.js', location.href).href;
    let cache = null;
    try { cache = 'caches' in window ? await caches.open(CACHE) : null; } catch (e) { cache = null; }
    let code = null;
    try { const hit = cache && await cache.match(key); if (hit) code = await hit.text(); } catch (e) { code = null; }
    const fromCache = code != null;
    if (!fromCache) {
      if (!window.Babel) await loadScript(BABEL);
      // transform-block-scoping turns const/let into var, as the old env preset did. The app's
      // top-level names must stay `var`: the Supabase UMD build declares `var supabase`, and a
      // top-level `const supabase` after it is a SyntaxError that stops the whole app.
      code = window.Babel.transform(src, { presets: ['react'], plugins: ['transform-block-scoping'], filename: 'app.jsx', compact: true, comments: false }).code;
      if (cache) {
        try {
          // Keep only this build: older compiled copies are dead weight.
          for (const req of await cache.keys()) if (req.url !== key) await cache.delete(req);
          await cache.put(key, new Response(code, { headers: { 'Content-Type': 'text/javascript' } }));
        } catch (e) { console.warn('[app-loader] compiled copy not kept:', e && e.message); }
      }
    }
    if (!run(code)) {
      // Never keep a copy that cannot start: drop it so the next open compiles afresh.
      try { if (cache) await cache.delete(key); } catch (e) {}
      throw new Error('the app failed to start (see the console)');
    }
    window.cmBoot = { fromCache, ms: Math.round(performance.now() - t0) };
    console.log('[app-loader]', fromCache ? 'compiled copy reused' : 'compiled now', window.cmBoot.ms + ' ms');
  }
  start().catch(fail);
})();
