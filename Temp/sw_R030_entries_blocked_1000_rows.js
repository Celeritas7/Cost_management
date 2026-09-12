const SHELL='cm-shell-v3', DATA='cm-data-v1';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-192.png','./icons/icon-maskable-512.png','./icons/icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==SHELL&&k!==DATA).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET') return;
  const url=new URL(req.url);
  // Supabase REST reads: network first, fall back to last cached response when offline
  if(url.hostname.endsWith('supabase.co')&&url.pathname.startsWith('/rest/')){
    e.respondWith(fetch(req).then(r=>{const cp=r.clone();caches.open(DATA).then(c=>c.put(req,cp));return r;}).catch(()=>caches.match(req)));return;}
  // CDN scripts/fonts + app shell: cache first, then network
  e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok&&(url.origin===location.origin||/jsdelivr|unpkg|gstatic|googleapis/.test(url.hostname))){const cp=r.clone();caches.open(SHELL).then(c=>c.put(req,cp));}return r;})));
});