/* cost-adapter.js — Cost Management's side of the hub.
 *
 * Paste into index.html AFTER the supabase client exists:
 *   <script src="https://<akatsuki-host>/js/akatsuki-client.js"></script>
 *   <script src="https://<akatsuki-host>/js/adapters/cost-adapter.js"></script>
 *   <script>const costHub = CostHub(supabase);</script>
 *
 * Requires: akatsuki_schema_R001.sql + akatsuki_card_cost_R002.sql applied.
 * R002 part A adds cost_management_expenses.updated_at — without it there is no
 * clock and publish() has nothing honest to put in src_clock.
 *
 * Two rules from CLAUDE.md this file exists to enforce:
 *   1. Never write what you didn't just read.  consumeRequests() sets a guard
 *      while it inserts, and emit() refuses to fire inside it.
 *   2. Publish on real change only.  emit() is called from the write funnels
 *      listed at the bottom, never from render, form state or a save-all.
 */
(function () {
  const APP = 'cost';

  function CostHub(supabase, opts = {}) {
    const hub = window.Akatsuki(supabase, APP, { log: opts.log || (() => {}) });
    let applying = false;               // rule 1: true while we write hub-sourced rows

    /* ---- emit -------------------------------------------------------------
     * A route may not exist yet (R002 declares Cost's emits but opens only the
     * Sukkiri reply). A missing route is a design state, not a runtime error:
     * swallow it, surface everything else.
     */
    async function emit(kind, addr, payload, clock, to) {
      if (applying) return { status: 'suppressed' };          // we are echoing the hub
      try {
        return await hub.publish({ to, kind, addr, payload, clock });
      } catch (e) {
        if (/no route|does not declare it accepts/.test(e.message)) {
          (opts.log || console.debug)('akatsuki: ' + kind + ' parked — ' + e.message);
          return { status: 'parked' };
        }
        throw e;
      }
    }

    /* payload is the public projection of an expense row.
     * notes is NOT here and must never be added — it is private (free text and
     * the fare-leg breakdown). currency is the row's `region` column. */
    const publicExpense = (row) => ({
      id: row.id,
      date: row.date,
      amount: Number(row.amount),
      currency: row.region || 'JPY',
      category: row.category || '',
      shop: row.shop || '',
      kind: row.expense_type || 'normal',
      tags: row.tags || ''
    });

    const api = {
      hub,

      /* ---- outbound: call these from the write funnels, after the DB says ok --- */

      /** insertExpense / insertExpenses / dueAdd / logStop — on success only. */
      expenseCreated(row, to = 'cal') {
        return emit('expense.created', { id: row.id }, publicExpense(row), row.updated_at, to);
      },

      /** handleUpdate — only when amount/date/category/shop/expense_type/tags moved. */
      expenseUpdated(row, to = 'cal') {
        return emit('expense.updated', { id: row.id }, publicExpense(row), row.updated_at, to);
      },

      /** handleDelete — hard delete. Consumers orphan their link; they do not delete. */
      expenseDeleted(id, to = 'cal') {
        return emit('expense.deleted', { id }, { id }, null, to);
      },

      /** Rename cascades (category 3630 · tag 3650 · shop 3680).
       *  ONE event for the whole cascade — never one per rewritten row. */
      recategorized(field, from, to_value, count, to = 'cal') {
        return emit('expense.recategorized',
          { field, from, to: to_value },
          { field, from, to: to_value, count },
          null, to);
      },

      /** R013 — Cost's purchase list IS the hub rows, not a localStorage copy, so a
       *  request is visible on every device. Open = no reply yet, or reply pending/approved
       *  (approved still awaits logging). Pass { all: true } for history.
       *  R014 — any sender (sukkiri, wf, …). Show row.from_app in the panel.
       *  R016 — reads akatsuki_purchases: each row also carries plan_shop (WF's plan). */
      async purchaseInbox({ all = false } = {}) {
        const { data, error } = await supabase.from('akatsuki_purchases')
          .select('seq,from_app,src_addr,payload,reply,reply_seq,created_at,plan_shop')
          .order('seq', { ascending: false });
        if (error) throw new Error(error.message);
        const open = (r) => !r.reply || ['pending', 'approved'].includes(r.reply.status);
        return all ? data : data.filter(open);
      },

      /** Cost owns purchase_request.status. Call on approve / reject / log.
       *  R013: by address (the row's src_addr, passed through untouched), not by seq —
       *  approved → logged is two replies on one row, each with a new reply_seq. */
      async purchaseResolved(row, status, expenseIds, { shop, category } = {}) {
        const reply = { id: row.payload.id, status, expense_ids: expenseIds || [], at: new Date().toISOString() };
        if (shop) reply.shop = shop;               // R016 — the shop it was LOGGED at
        if (category) reply.category = category;
        return hub.reply(row.from_app || 'sukkiri', 'purchase_request', row.src_addr, reply);
      },

      /** Online orders (purchase.detected / purchase.cancelled from `mail`, contract in
       *  AKATSUKI-REPLY-cost-amazon-orders). Like R013 the list IS the hub rows. Returns
       *  every detected row, each with the matching cancellation (same addr) or null. */
      async orderInbox() {
        const { data, error } = await supabase.from('akatsuki_requests')
          .select('seq,from_app,kind,src_addr,payload,reply,reply_seq,created_at')
          .eq('to_app', APP).in('kind', ['purchase.detected', 'purchase.cancelled'])
          .order('seq', { ascending: false });
        if (error) throw new Error(error.message);
        const key = (a) => (a && a.source) + ':' + (a && a.order_id);
        const cancelled = {};
        data.filter((r) => r.kind === 'purchase.cancelled').forEach((r) => { if (!cancelled[key(r.src_addr)]) cancelled[key(r.src_addr)] = r; });
        return data.filter((r) => r.kind === 'purchase.detected').map((r) => ({ ...r, cancel: cancelled[key(r.src_addr)] || null }));
      },

      /** Resolve one detected order. Acked by seq so the reply and, when logged, the
       *  link to the expense ({id}) land in one call — the link is what lets a later
       *  cancellation find an expense that was already logged. */
      async orderResolved(row, status, { expenseIds, extra } = {}) {
        const reply = { order_id: row.payload.order_id, status, ...(extra || {}), at: new Date().toISOString() };
        if (expenseIds && expenseIds.length) reply.expense_ids = expenseIds;
        const addr = status === 'logged' && expenseIds && expenseIds.length ? { id: expenseIds[0] } : undefined;
        return hub.ack(row.seq, { addr, reply });
      },

      /** R016 — the shop to pre-fill at logging. The user may still change it.
       *  Order: WF plan → item shop → payload preferred_shop → null (then location). */
      suggestedShop(row, item) {
        const p = row.payload || {};
        return row.plan_shop || (item && item.shop) || p.preferred_shop || p.shop || null;
      },

      /* ---- inbound ---------------------------------------------------------
       * One loop, one case per accepted kind. R013: purchase_request is only
       * acked delivered here; the decision comes later via purchaseResolved.
       * onPurchaseRequest(payload, row) is a nudge to re-render from
       * purchaseInbox() — do not copy the row into localStorage.
       */
      listen(handlers) {
        return hub.listen({
          purchase_request: async (r) => {
            applying = true;
            try { await (handlers.onPurchaseRequest || (() => {}))(r.payload, r); return {}; }
            finally { applying = false; }
          },
          // Emails (and backfills) can arrive out of order: if this order's cancellation
          // is already here, settle it now. consume() acks with this reply in one call.
          'purchase.detected': async (r) => {
            const { data } = await supabase.from('akatsuki_requests').select('seq')
              .eq('to_app', APP).eq('kind', 'purchase.cancelled').eq('src_addr', JSON.stringify(r.src_addr)).limit(1);
            await (handlers.onOrder || (() => {}))(r.payload, r);
            if (data && data.length) return { reply: { order_id: r.payload.order_id, status: 'dismissed', reason: 'cancelled', at: new Date().toISOString() } };
            return {};
          },
          // A cancellation settles the detected row it names: never resolved → dismissed;
          // already logged → flagged (the expense stays; the person decides).
          'purchase.cancelled': async (r) => {
            const { data } = await supabase.from('akatsuki_requests').select('seq,payload,reply')
              .eq('to_app', APP).eq('kind', 'purchase.detected').eq('src_addr', JSON.stringify(r.src_addr))
              .order('seq', { ascending: false }).limit(1);
            const d = data && data[0];
            if (d && !d.reply) await hub.ack(d.seq, { reply: { order_id: r.payload.order_id, status: 'dismissed', reason: 'cancelled', at: new Date().toISOString() } });
            else if (d && d.reply && d.reply.status === 'logged') await hub.ack(d.seq, { reply: { ...d.reply, status: 'flagged', reason: 'cancelled', at: new Date().toISOString() } });
            await (handlers.onOrder || (() => {}))(r.payload, r);
            return {};
          }
        }, opts.pollMs || 15000);
      },

      /* ---- vocab: read shared enums, never keep a local copy --------------
       * Replaces EXPENSE_TYPES (index.html:107) and CURRENCIES (161).
       * Falls back to the known values so the app still works offline. */
      async enums() {
        const fallback = {
          expense_type: ['normal', 'fixed', 'outlier'],
          currency: ['JPY', 'INR'],
          stop_status: ['open', 'logged', 'dismissed'],
          pending_status: ['pending', 'logged', 'dismissed'],
          purchase_status: ['pending', 'approved', 'rejected', 'logged']
        };
        try {
          const { data, error } = await supabase
            .from('akatsuki_vocab').select('id,schema').eq('ns', 'enum');
          if (error || !data || !data.length) return fallback;
          const out = {};
          for (const r of data) out[r.id] = (r.schema && r.schema.values) || fallback[r.id];
          return Object.assign({}, fallback, out);
        } catch { return fallback; }
      },

      /** True while hub-sourced rows are being written — check before any
       *  publish you add by hand. */
      get applying() { return applying; }
    };

    return api;
  }

  window.CostHub = CostHub;
})();

/* ── Where to place the calls (from Cost Management's own write-path list) ────
 *
 *   insertExpense        3962   → costHub.expenseCreated(row)      after insert returns
 *   insertExpenses       2614   → one call per inserted row, or batch upstream
 *   dueAdd                782   → costHub.expenseCreated(row)
 *   logStop              1036   → costHub.expenseCreated(row)      NOT on offline enqueue
 *   trigger-fire add      894   → costHub.expenseCreated(row)
 *   pending→expense      6578   → costHub.expenseCreated(row)
 *   fare journey save    4533   → costHub.expenseCreated(row)
 *   handleUpdate         3971   → costHub.expenseUpdated(row)      only if a mapped field moved
 *   handleDelete         3979   → costHub.expenseDeleted(id)
 *   category rename      3630   → costHub.recategorized('category', old, new, n)   ONCE
 *   tag rename           3650   → costHub.recategorized('tag', old, new, n)        ONCE
 *   shop rename          3680   → costHub.recategorized('shop', old, new, n)       ONCE
 *   purchase list render        → rows = await costHub.purchaseInbox()   (R013 — replaces
 *                                 the cost_management_purchase_requests read)
 *   purchase approve     6277   → costHub.purchaseResolved(row, 'approved', [])
 *   purchase reject             → costHub.purchaseResolved(row, 'rejected')
 *   expense logged from request → costHub.purchaseResolved(row, 'logged', ids, { shop, category })
 *                                 after insert; shop = what was actually logged (R016)
 *   log form pre-fill           → costHub.suggestedShop(row, item)   then location fallback
 *   costHub.listen({ onPurchaseRequest: () => renderPurchases() })   once, after sign-in
 *   mergePurchaseRequests 335   → DELETE once listen() is live; the localStorage
 *                                 keys cost_management_purchase_requests and
 *                                 sukkiri_cost_requests are the defect R002 re-homes
 *
 * Do NOT add a call in: handleToggleFavorite (3689), stop dismiss, recurring
 * is_active, or the offline outbox drain — none of those change a shared field.
 * ─────────────────────────────────────────────────────────────────────────── */
