/* akatsuki-client.js — the whole contract an app implements.
 *
 *   const hub = Akatsuki(supabase, 'travel');
 *   await hub.publish({ to: 'cal', kind: 'trip.segment', addr: { trip_id, segment_id }, payload, clock: updated_at });
 *   await hub.consume({ 'trip.segment': async (r) => { const id = upsertEvent(r.payload); return { addr: { event_id: id } }; } });
 *
 * Two functions. Everything hard lives in the hub.
 * localStorage-first: publishes queue in an outbox when offline and flush on
 * reconnect, so the app never requires the cloud (ecosystem rule).
 * Load as a classic script; exposes window.Akatsuki.
 */
(function () {
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const stable = (o) => JSON.stringify(o, o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort() : undefined);

  function Akatsuki(supabase, app, opts = {}) {
    if (!supabase || !app) throw new Error('Akatsuki(supabase, appId) — both required');
    const OUTBOX = 'akatsuki_outbox_' + app;
    const readBox = () => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch { return []; } };
    const writeBox = (rows) => localStorage.setItem(OUTBOX, JSON.stringify(rows));
    const log = opts.log || (() => {});

    async function rpc(fn, args) {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error(error.message), { code: error.code, fn });
      return data;
    }

    const hub = {
      app,

      /** Publish one change. Idempotent: same addr + same payload = same key = one row. */
      async publish({ to, kind, addr, payload, clock, key }) {
        const p = { from_app: app, to_app: to, kind, src_addr: addr, src_clock: clock == null ? null : String(clock), payload,
                    idempotency_key: key || `${app}:${hash(stable(addr))}:${hash(stable(payload))}` };
        if (!navigator.onLine) { writeBox([...readBox(), p]); log('queued', p.idempotency_key); return { status: 'queued' }; }
        try {
          const rows = await rpc('akatsuki_publish', { p });
          const r = Array.isArray(rows) ? rows[0] : rows;
          log(r.status, r.seq); return r;
        } catch (e) {
          if (/unknown kind|does not declare|no route|missing required/.test(e.message)) throw e;   // contract errors: never queue
          writeBox([...readBox(), p]); log('queued after error', e.message); return { status: 'queued', error: e.message };
        }
      },

      /** Flush the offline outbox. Called automatically on 'online'. */
      async flush() {
        const box = readBox(); if (!box.length) return 0;
        const left = [];
        for (const p of box) { try { await rpc('akatsuki_publish', { p }); } catch (e) { if (!/unknown kind|does not declare|no route|missing required/.test(e.message)) left.push(p); } }
        writeBox(left); return box.length - left.length;
      },

      /** Read everything addressed to me past my cursor and hand each row to a handler by kind.
       *  Handler may return { addr } (the id it created, to record the pair) and/or { reply }. */
      async consume(handlers, limit = 100) {
        const rows = await rpc('akatsuki_consume', { p_app: app, p_limit: limit });
        let n = 0;
        for (const r of rows || []) {
          const h = handlers[r.kind];
          if (!h) { await hub.ack(r.seq, { status: 'skipped' }); continue; }
          try { const res = (await h(r)) || {}; await hub.ack(r.seq, { addr: res.addr, reply: res.reply }); n++; }
          catch (e) { await hub.ack(r.seq, { status: 'rejected' }); log('rejected', r.seq, e.message); }
        }
        return n;
      },

      async ack(seq, { addr, reply, status = 'delivered' } = {}) {
        return rpc('akatsuki_ack', { p_app: app, p_seq: seq, p_b_addr: addr ?? null, p_reply: reply ?? null, p_status: status });
      },

      /** Reply later by the origin's address (R010) — e.g. WF tick: hub.reply('cost','request.created',{id},{status:'done',at}). */
      async reply(fromApp, kind, addr, reply) {
        return rpc('akatsuki_reply', { p_app: app, p_from_app: fromApp, p_kind: kind, p_src_addr: addr, p_reply: reply });
      },

      /** The origin's thing is gone or parked. Keep the link, mark it. */
      async orphan(addr) { return rpc('akatsuki_orphan', { p_a_app: app, p_a_addr: addr }); },

      /** Request / reply — read replies to things I published.
       *  Pages on reply_seq (R010), not seq: a late reply or an un-tick moves reply_seq only.
       *  Keep the max reply_seq you've seen and pass it back as sinceSeq. */
      async replies(kind, sinceSeq = 0) {
        let q = supabase.from('akatsuki_requests').select('seq,reply_seq,kind,src_addr,payload,reply,delivered_at').eq('from_app', app).not('reply', 'is', null).gt('reply_seq', sinceSeq).order('reply_seq');
        if (kind) q = q.eq('kind', kind);
        const { data, error } = await q; if (error) throw new Error(error.message); return data;
      },

      /** Document pattern — write only paths this app owns. The trigger rejects anything else. */
      async put(doc, path, itemKey, value) {
        const row = { doc, path, item_key: itemKey ?? '', owner_app: app, updated_by: app, value, deleted_at: null };
        const { error } = await supabase.from('akatsuki_state').upsert(row, { onConflict: 'user_id,doc,path,item_key' });
        if (error) throw new Error(error.message);
      },
      async remove(doc, path, itemKey) {
        const { error } = await supabase.from('akatsuki_state').update({ deleted_at: new Date().toISOString(), updated_by: app }).match({ doc, path, item_key: itemKey ?? '' });
        if (error) throw new Error(error.message);
      },
      /** Read a whole doc re-grouped by path: { cycles: [...], away: [...], show: true } */
      async doc(doc) {
        const { data, error } = await supabase.from('akatsuki_docs').select('path,owner_app,items,scalar,seq').eq('doc', doc);
        if (error) throw new Error(error.message);
        const out = {}, owners = {};
        for (const r of data) { out[r.path] = r.items ?? r.scalar; owners[r.path] = r.owner_app; }
        return { value: out, owners };
      },

      /** Cached source data (one fetch, many consumers). */
      async cached(source, key) {
        const { data } = await supabase.from('akatsuki_cache').select('payload,fetched_at,expires_at').match({ source, key }).maybeSingle();
        return data && (!data.expires_at || new Date(data.expires_at) > new Date()) ? data.payload : null;
      },

      /** Poll helper: consume on an interval, on focus, and on reconnect. Returns stop(). */
      listen(handlers, ms = 15000) {
        let t = null; const run = () => hub.consume(handlers).catch(e => log('consume failed', e.message));
        const onl = () => { hub.flush().then(run); };
        const vis = () => { if (document.visibilityState === 'visible') run(); };
        window.addEventListener('online', onl); document.addEventListener('visibilitychange', vis);
        t = setInterval(run, ms); run();
        return () => { clearInterval(t); window.removeEventListener('online', onl); document.removeEventListener('visibilitychange', vis); };
      }
    };

    window.addEventListener('online', () => hub.flush().catch(() => {}));
    return hub;
  }

  window.Akatsuki = Akatsuki;
})();
