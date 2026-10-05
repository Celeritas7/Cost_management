/* akatsuki-location.js — the hub's visit detector.  R018 part B · Oct 6.
 *
 * Shipped by Akatsuki, NEVER forked.  Apps pass callbacks only.  Load after the supabase client.
 *   const loc = AkatsukiLocation.start(supabase, 'cost', { onVisitOpen, onVisitClose, onError });
 *   loc.stop();  loc.state();  loc.device
 *
 * What it sends: a visit's eased centre (4 dp ≈ 10 m), start, last-seen, end, accuracy.  Raw fixes never leave the device.
 * Rules (Cost STEP0 A4 fixes + user decisions D1/D2, Oct 5):
 *   · times are the fix's own timestamp, not receipt time
 *   · a fix counts once, however many ticks read it
 *   · "outside" only when distance − accuracy > radius; a fix in the fuzzy band moves nothing
 *   · leaving ends the visit at the LAST FIX INSIDE, never at now (D1)
 *   · ticks frozen longer than readopt_s (hidden tab, sleep) = a gap: open visit closed at last-seen, coverage split (D1)
 *   · on start, an open visit seen ≤ readopt_s ago within radius + accuracy is continued; older ones are closed at last-seen
 *   · no blocks: home and office are recorded like anywhere else; the app filters what it shows (D2)
 * Nothing is recorded while no connected app is open.
 */
(function () {
  const DEF = { enabled: true, radius_m: 70, dwell_s: 240, accuracy_max_m: 150, stale_s: 120, heartbeat_s: 120, readopt_s: 600, tick_s: 20 };
  const BUILD = 'akatsuki-location-2026-10-06';
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  const iso = (t) => new Date(t).toISOString();
  const dist = (a, b) => {
    const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  const deviceId = () => {
    let id = localStorage.getItem('akatsuki_device');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      localStorage.setItem('akatsuki_device', id);
    }
    return id;
  };

  function start(sb, app, cb = {}) {
    if (!sb || !app) throw new Error('AkatsukiLocation.start(supabase, app, callbacks)');
    const log = (...a) => console.log('[akatsuki-location]', BUILD, ...a);
    const device = deviceId();
    let cfg = { ...DEF }, watchId = null, iv = null, stopped = false, busy = false;
    let fix = null;                                   // latest fix {lat,lng,acc,t}
    let st = { anchor: null, since: 0, lastIn: 0, open: false, misses: 0, usedT: 0, lastBeat: 0, resumeTried: false };
    let cov = { since: 0, lastTick: 0, lastSent: 0 };

    const rpc = async (fn, args) => {
      const { data, error } = await sb.rpc(fn, args);
      if (error) { log(fn, error.code, error.message); cb.onError && cb.onError(fn, error); return undefined; }
      return data;
    };
    const anchorAt = (f) => { st = { ...st, anchor: { lat: f.lat, lng: f.lng }, since: f.t, lastIn: f.t, open: false, misses: 0, lastBeat: 0 }; };
    const closeOpen = async (reason) => {
      if (!st.open) return;
      st.open = false;
      await rpc('akatsuki_visit_close', { p_device: device, p_since: iso(st.since), p_until: iso(st.lastIn), p_reason: reason });
      cb.onVisitClose && cb.onVisitClose({ device, since: iso(st.since), until: iso(st.lastIn), reason });
    };
    const markCoverage = (until) => cov.since &&
      rpc('akatsuki_coverage_mark', { p_device: device, p_app: app, p_since: iso(cov.since), p_until: iso(until) });

    async function tick() {
      if (stopped || busy || !cfg.enabled) return;
      busy = true;
      try {
        const now = Date.now();
        // Gap: ticks were frozen (hidden tab, sleep, killed timers).  Short gaps carry on; long ones close and split coverage.
        if (cov.lastTick && now - cov.lastTick > cfg.readopt_s * 1000) {
          await closeOpen('gap');
          await markCoverage(cov.lastTick);
          cov = { since: 0, lastTick: 0, lastSent: 0 };
          st.anchor = null;
        }
        if (!cov.since) { cov.since = now; cov.lastSent = now; await markCoverage(now); }
        cov.lastTick = now;
        if (now - cov.lastSent > 60000) { cov.lastSent = now; markCoverage(now); }

        const f = fix;
        if (!f || now - f.t > cfg.stale_s * 1000 || f.acc > cfg.accuracy_max_m || f.t === st.usedT) return;
        st.usedT = f.t;
        const R = cfg.radius_m;

        if (!st.anchor) {
          if (!st.resumeTried) {
            st.resumeTried = true;
            const r = await rpc('akatsuki_visit_resume', { p_device: device, p_lat: f.lat, p_lng: f.lng, p_acc_m: Math.round(f.acc) });
            if (r && r.since) {
              st = { ...st, anchor: { lat: r.lat, lng: r.lng }, since: Date.parse(r.since), lastIn: f.t, open: true, misses: 0, lastBeat: 0 };
              log('continued visit', r.since);
              return;
            }
          }
          anchorAt(f);
          return;
        }

        const d = dist(f, st.anchor);
        if (d - f.acc > R) {                          // clearly outside
          st.misses += 1;
          if (st.misses < 2) return;                  // two distinct fixes outside = left
          await closeOpen('left');
          anchorAt(f);
          return;
        }
        if (d > R) return;                            // fuzzy band: neither in nor out

        st.misses = 0;
        st.lastIn = f.t;
        st.anchor = { lat: st.anchor.lat * 0.8 + f.lat * 0.2, lng: st.anchor.lng * 0.8 + f.lng * 0.2 };

        if (!st.open && (f.t - st.since) / 1000 >= cfg.dwell_s) {
          const r = await rpc('akatsuki_visit_open', {
            p_device: device, p_since: iso(st.since), p_last_seen: iso(st.lastIn),
            p_lat: r4(st.anchor.lat), p_lng: r4(st.anchor.lng), p_radius_m: R, p_acc_m: Math.round(f.acc), p_app: app,
          });
          if (r) {
            st.open = true; st.lastBeat = now;
            cb.onVisitOpen && cb.onVisitOpen({ device, since: iso(st.since), anchor_id: r.anchor_id, place_id: r.place_id, status: r.status });
          }
        } else if (st.open && now - st.lastBeat >= cfg.heartbeat_s * 1000) {
          st.lastBeat = now;
          await rpc('akatsuki_visit_seen', { p_device: device, p_since: iso(st.since), p_last_seen: iso(st.lastIn), p_acc_m: Math.round(f.acc) });
        }
      } finally { busy = false; }
    }

    const onVis = () => { if (document.visibilityState === 'visible') tick(); else if (cov.since) markCoverage(Date.now()); };
    const onHide = () => { if (cov.since) markCoverage(Date.now()); };

    (async () => {
      const { data } = await sb.from('akatsuki_stop_settings').select('*').maybeSingle();
      if (data) cfg = { ...DEF, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v != null)) };
      if (!cfg.enabled) { log('disabled in akatsuki_stop_settings'); return; }
      await rpc('akatsuki_device_register', { p_id: device, p_app: app, p_label: null });
      if (!('geolocation' in navigator)) { log('no geolocation'); return; }
      watchId = navigator.geolocation.watchPosition(
        (p) => { fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: p.timestamp || Date.now() }; },
        (e) => { log('watch error', e.code, e.message); cb.onError && cb.onError('watchPosition', e); },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('pagehide', onHide);
      iv = setInterval(tick, cfg.tick_s * 1000);
      log('started', { app, device, radius_m: cfg.radius_m, dwell_s: cfg.dwell_s });
    })();

    return {
      device, build: BUILD,
      state: () => ({ open: st.open, since: st.since ? iso(st.since) : null, lastIn: st.lastIn ? iso(st.lastIn) : null, misses: st.misses, cfg }),
      stop() {
        stopped = true;
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        clearInterval(iv);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pagehide', onHide);
        if (cov.since) markCoverage(Date.now());
      },
    };
  }

  window.AkatsukiLocation = { start, BUILD };
})();
