// Phase 3 verification harness — headless chromium + mocked Supabase.
// Run: node Temp/verify_phase3.cjs
const path = require('path');
const { execSync } = require('child_process');
// playwright lives in the npx cache here; fall back to global root.
function findPlaywright() {
  const candidates = [];
  try {
    const cache = execSync('npm config get cache').toString().trim();
    const npx = path.join(cache, '_npx');
    for (const d of require('fs').readdirSync(npx)) {
      candidates.push(path.join(npx, d, 'node_modules', 'playwright'));
    }
  } catch (e) {}
  try { candidates.push(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e) {}
  for (const c of candidates) { try { return require(c); } catch (e) {} }
  throw new Error('playwright not found in: ' + candidates.join(', '));
}
const { chromium } = findPlaywright();

const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');

// ── date helpers (local, mirror the app) ──
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// ── result tracking: per-test buckets so one failure never hides later tests ──
let PASS = 0, FAIL = 0;
const results = [];
let cur = null;
const ok = (name, cond, extra) => {
  if (cond) { PASS++; if (cur) cur.pass++; console.log('  ✓', name); }
  else { FAIL++; if (cur) cur.fail++; console.log('  ✗', name, extra != null ? '— ' + JSON.stringify(extra) : ''); }
};
async function test(id, title, fn) {
  cur = { id, title, pass: 0, fail: 0, error: null };
  results.push(cur);
  console.log(`\n[${id}] ${title}`);
  try { await fn(); }
  catch (e) {
    cur.error = (e && e.message ? e.message : String(e)).split('\n')[0];
    console.log('  ✗ THREW —', cur.error);
  }
}

// Build a mock Supabase backend over PostgREST-style routes.
// state.recurring / state.expenses are arrays; captures records inserts/updates.
function makeBackend(state) {
  const captures = { inserts: [], updates: [] };
  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/\/rest\/v1\/([a-z_]+)/);
    const table = m ? m[1] : null;
    const method = req.method();
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}

    const json = (data) => route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

    if (method === 'GET') {
      if (table === 'cost_management_expenses') return json(state.expenses);
      if (table === 'cost_management_recurring') return json(state.recurring);
      if (table === 'cost_management_shops') return json(state.shops || []);
      if (table === 'cost_management_categories') return json(state.categories || []);
      if (table === 'cost_management_tags') return json(state.tags || []);
      return json([]);
    }
    if (method === 'POST') { // insert
      const rows = Array.isArray(body) ? body : [body];
      captures.inserts.push({ table, rows });
      if (table === 'cost_management_expenses') { rows.forEach((r) => state.expenses.push({ id: 9000 + state.expenses.length, ...r })); }
      return json(rows.map((r, i) => ({ id: 9000 + i, ...r })));
    }
    if (method === 'PATCH') { // update
      const idEq = url.searchParams.get('id'); // e.g. "eq.3"
      const id = idEq ? Number(idEq.replace('eq.', '')) : null;
      captures.updates.push({ table, id, body });
      if (table === 'cost_management_recurring' && id != null) {
        const row = state.recurring.find((r) => r.id === id);
        if (row) Object.assign(row, body);
      }
      return json([{ id, ...body }]);
    }
    if (method === 'DELETE') return json([]);
    return json([]);
  }
  return { handle, captures };
}

async function newApp(state, opts = {}) {
  const browser = opts.browser;
  // opts.timezoneId → run in a context pinned to that zone (for the Tokyo todayStr test).
  // opts.now = [y, monthIdx, d, h, mi, s] → freeze the wall clock to those LOCAL components,
  //   so the due-check time gate and todayStr are exercised deterministically (no wall-clock).
  const page = opts.timezoneId
    ? await (await browser.newContext({ timezoneId: opts.timezoneId })).newPage()
    : await browser.newPage();
  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));
  page.on('pageerror', (e) => logs.push('PAGEERR: ' + e.message));
  if (opts.now) {
    // Override Date so `new Date()` / Date.now() return the frozen instant, while
    // `new Date(args)` keeps working. Built from local components → getHours()/
    // getFullYear() etc. read back exactly what we injected (in the page's tz).
    await page.addInitScript((c) => {
      const RealDate = Date;
      const fixedT = new RealDate(c[0], c[1], c[2], c[3] || 0, c[4] || 0, c[5] || 0, 0).getTime();
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length === 0) { super(fixedT); } else { super(...a); } }
        static now() { return fixedT; }
      }
      window.Date = FakeDate;
    }, opts.now);
  }
  const backend = makeBackend(state);
  await page.route('**/rest/v1/**', backend.handle);
  await page.goto(INDEX, { waitUntil: 'load', timeout: 30000 });
  // wait for React/babel to render and the load effect to run
  await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent.includes('Cost Management'), { timeout: 30000 });
  await page.waitForTimeout(800);
  return { page, backend, logs };
}

(async () => {
  const browser = await chromium.launch();

  const TODAY = new Date();
  const Y = TODAY.getFullYear(), M = TODAY.getMonth(), D = TODAY.getDate(), DOW = TODAY.getDay();
  const daysInMonth = new Date(Y, M + 1, 0).getDate();

  const baseMeta = {
    shops: [{ id: 1, name: 'KonbiniShop', category: 'Convenience', is_favorite: true }],
    categories: [
      { id: 1, name: 'Convenience', icon: '🏪', color: '#f59e0b', sort_order: 1 },
      { id: 2, name: 'Housing', icon: '🏠', color: '#2563eb', sort_order: 2 },
      { id: 3, name: 'Health', icon: '💊', color: '#10b981', sort_order: 3 },
    ],
    tags: [],
  };

  // ── Test 1: due-set computation per frequency + ordering + inactive excluded ──
  await test('1', 'Due-set computation, ordering, inactive exclusion', async () => {
    // monthly due: day_value yesterday-ish so today >= clampedDay, last added previous period
    const monthlyDay = Math.min(D, daysInMonth); // due today guaranteed
    const rec = [
      // daily, last added yesterday -> due
      { id: 1, name: 'Konbini', category: 'Convenience', shop: 'KonbiniShop', amount: 500, expense_type: 'normal', tags: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: ymd(addDays(TODAY, -1)), sort_order: 0 },
      // monthly, due today, last added last month -> due
      { id: 2, name: 'Rent', category: 'Housing', shop: 'Landlord', amount: 80000, expense_type: 'fixed', tags: '', frequency: 'monthly', day_value: monthlyDay, is_active: true, last_added_date: ymd(new Date(Y, M - 1, monthlyDay)), sort_order: 0 },
      // weekly on today's weekday, last added a week ago -> due
      { id: 3, name: 'Gym', category: 'Health', shop: 'Gym', amount: 2000, expense_type: 'normal', tags: '', frequency: 'weekly', day_value: DOW, is_active: true, last_added_date: ymd(addDays(TODAY, -7)), sort_order: 0 },
      // inactive -> never
      { id: 4, name: 'Inactive', category: 'Convenience', shop: 'X', amount: 100, expense_type: 'normal', tags: '', frequency: 'daily', day_value: null, is_active: false, last_added_date: null, sort_order: 0 },
      // monthly already added this period -> not due
      { id: 5, name: 'AlreadyPaid', category: 'Housing', shop: 'Y', amount: 999, expense_type: 'normal', tags: '', frequency: 'monthly', day_value: monthlyDay, is_active: true, last_added_date: ymd(new Date(Y, M, monthlyDay)), sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page, logs } = await newApp(state, { browser });
    const titles = await page.locator('div:has-text("🔁 Recurring payments due")').first().count();
    ok('modal opened', titles > 0);
    // names shown, in frequency order: daily(Konbini) -> weekly(Gym) -> monthly(Rent)
    const bodyText = await page.locator('body').innerText();
    ok('Konbini (daily) shown', /Konbini/.test(bodyText));
    ok('Rent (monthly) shown', /Rent/.test(bodyText));
    ok('Gym (weekly) shown', /Gym/.test(bodyText));
    ok('Inactive NOT shown', !/Inactive/.test(bodyText));
    ok('AlreadyPaid NOT shown', !/AlreadyPaid/.test(bodyText));
    ok('subtitle counts 3', /3 entries waiting/.test(bodyText), bodyText.slice(0, 200));
    // ordering: Konbini before Gym before Rent in DOM order
    const idxKonbini = bodyText.indexOf('Konbini'), idxGym = bodyText.indexOf('Gym'), idxRent = bodyText.indexOf('Rent');
    ok('order daily<weekly<monthly', idxKonbini < idxGym && idxGym < idxRent, { idxKonbini, idxGym, idxRent });
    await page.close();
  });

  // ── Test 2: modal does NOT open when due set empty ──
  await test('2', 'No modal when nothing due', async () => {
    const rec = [
      { id: 1, name: 'PaidToday', category: 'Housing', shop: 'Y', amount: 100, expense_type: 'normal', tags: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: ymd(TODAY), sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page } = await newApp(state, { browser });
    const bodyText = await page.locator('body').innerText();
    ok('modal not shown', !/Recurring payments due/.test(bodyText));
    await page.close();
  });

  // ── Test 3: Add inserts payload + updates last_added_date ──
  await test('3', 'Add: insert payload + last_added_date update', async () => {
    const due = ymd(addDays(TODAY, -1));
    const rec = [
      { id: 7, name: 'Konbini', category: 'Convenience', shop: 'KonbiniShop', amount: 500, expense_type: 'normal', tags: 'Food', notes: 'lunch', frequency: 'daily', day_value: null, is_active: true, last_added_date: due, sort_order: 0 },
    ];
    const today = ymd(TODAY);
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page, backend } = await newApp(state, { browser });
    // exact match — the bottom-nav "➕ Add" tab also contains "Add"; only the
    // modal button is exactly "Add". (The nav tab sits under the sheet scrim.)
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForTimeout(900);
    const ins = backend.captures.inserts.filter(i => i.table === 'cost_management_expenses');
    ok('one expense insert', ins.length === 1, ins);
    const row = ins[0] && (Array.isArray(ins[0].rows) ? ins[0].rows[0] : ins[0].rows);
    ok('insert date = computed due (today for daily)', row && row.date === today, row);
    ok('insert amount 500', row && row.amount === 500, row);
    ok('insert category', row && row.category === 'Convenience', row);
    ok('insert shop', row && row.shop === 'KonbiniShop', row);
    ok('insert expense_type', row && row.expense_type === 'normal', row);
    ok('insert tags', row && row.tags === 'Food', row);
    ok('insert notes', row && row.notes === 'lunch', row);
    const upd = backend.captures.updates.filter(u => u.table === 'cost_management_recurring');
    ok('recurring update last_added_date = today', upd.length === 1 && upd[0].body.last_added_date === today, upd);
    // modal auto-closed (only entry)
    const bodyText = await page.locator('body').innerText();
    ok('modal auto-closed after last add', !/Recurring payments due/.test(bodyText));
    await page.close();
  });

  // ── Test 4: Skip updates last_added_date, NO insert ──
  await test('4', 'Skip: last_added_date update, no insert', async () => {
    const monthlyDay = Math.min(D, daysInMonth);
    const computedDue = ymd(new Date(Y, M, monthlyDay));
    const rec = [
      { id: 8, name: 'Rent', category: 'Housing', shop: 'Landlord', amount: 80000, expense_type: 'fixed', tags: '', notes: '', frequency: 'monthly', day_value: monthlyDay, is_active: true, last_added_date: ymd(new Date(Y, M - 1, monthlyDay)), sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page, backend } = await newApp(state, { browser });
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.waitForTimeout(900);
    const ins = backend.captures.inserts.filter(i => i.table === 'cost_management_expenses');
    ok('NO expense insert', ins.length === 0, ins);
    const upd = backend.captures.updates.filter(u => u.table === 'cost_management_recurring');
    ok('recurring update last_added_date = computed due (this month)', upd.length === 1 && upd[0].body.last_added_date === computedDue, upd);
    await page.close();
  });

  // ── Test 5: Snooze touches nothing, removes row, reappears next session ──
  await test('5', 'Snooze: no DB writes, no insert', async () => {
    const rec = [
      { id: 9, name: 'Gym', category: 'Health', shop: 'Gym', amount: 2000, expense_type: 'normal', tags: '', notes: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: ymd(addDays(TODAY, -1)), sort_order: 0 },
      { id: 10, name: 'Konbini', category: 'Convenience', shop: 'KonbiniShop', amount: 500, expense_type: 'normal', tags: '', notes: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: ymd(addDays(TODAY, -1)), sort_order: 1 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page, backend, logs } = await newApp(state, { browser });
    const dueLog = () => logs.filter((l) => /\[recurring\] due/.test(l));
    const baseLogs = dueLog().length; // due-set effect ran once on load
    // snooze the first (Gym): first Snooze button in DOM order
    await page.getByRole('button', { name: 'Snooze', exact: true }).first().click();
    await page.waitForTimeout(900);
    ok('no inserts', backend.captures.inserts.length === 0, backend.captures.inserts);
    ok('no updates', backend.captures.updates.length === 0, backend.captures.updates);
    let bodyText = await page.locator('body').innerText();
    // (1) snoozed id absent from the rendered modal
    ok('Gym row removed from modal', !/Gym/.test(bodyText), bodyText.slice(0, 200));
    ok('Konbini still present', /Konbini/.test(bodyText));
    // (2) the due-set effect re-ran (sessionSnoozed changed) and must NOT reintroduce
    //     the snoozed id — a no-op snooze leaves sessionSnoozed unchanged, so the
    //     effect never re-runs and Gym would still be in the recomputed set.
    const afterSnooze = dueLog();
    ok('due-set effect re-ran after snooze', afterSnooze.length > baseLogs, { baseLogs, now: afterSnooze.length });
    const lastDue = afterSnooze[afterSnooze.length - 1] || '';
    ok('snoozed Gym excluded from recomputed due-set', !/Gym/.test(lastDue), lastDue);
    ok('Konbini retained in recomputed due-set', /Konbini/.test(lastDue), lastDue);
    // (3) snooze the remaining row → list empties → modal closes; dueShownRef must
    //     keep it from reopening even though the effect re-runs again.
    await page.getByRole('button', { name: 'Snooze', exact: true }).first().click();
    await page.waitForTimeout(900);
    bodyText = await page.locator('body').innerText();
    ok('modal closed once all snoozed', !/Recurring payments due/.test(bodyText));
    ok('effect re-ran again after 2nd snooze', dueLog().length > afterSnooze.length, dueLog().length);
    ok('modal did not reopen (dueShownRef guard)', !/Recurring payments due/.test(bodyText));
    ok('still no DB writes across snoozes', backend.captures.inserts.length === 0 && backend.captures.updates.length === 0);
    await page.close();
  });

  // ── Test 6: Close leaves entries; not re-shown until reload ──
  await test('6', 'Close / Later dismisses; not re-opened this session', async () => {
    const rec = [
      { id: 11, name: 'Konbini', category: 'Convenience', shop: 'KonbiniShop', amount: 500, expense_type: 'normal', tags: '', notes: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: ymd(addDays(TODAY, -1)), sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page, backend } = await newApp(state, { browser });
    await page.locator('button:has-text("Close / Later")').click();
    await page.waitForTimeout(400);
    let bodyText = await page.locator('body').innerText();
    ok('modal closed after Close', !/Recurring payments due/.test(bodyText));
    ok('no DB writes on close', backend.captures.inserts.length === 0 && backend.captures.updates.length === 0);
    // navigate tabs — should not reopen
    await page.locator('button:has-text("📊 Overview")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("➕ Add")').click();
    await page.waitForTimeout(300);
    bodyText = await page.locator('body').innerText();
    ok('still closed after tab nav (once-per-session)', !/Recurring payments due/.test(bodyText));
    await page.close();
  });

  // ── Test 7: 23rd-of-month monthly not due before its day ──
  await test('7', 'Monthly not due before its day', async () => {
    // pick a day_value strictly greater than today's date (so not due). Skip if today is month-end.
    if (D < daysInMonth) {
      const futureDay = D + 1;
      const rec = [
        { id: 12, name: 'FutureRent', category: 'Housing', shop: 'L', amount: 50000, expense_type: 'fixed', tags: '', notes: '', frequency: 'monthly', day_value: futureDay, is_active: true, last_added_date: null, sort_order: 0 },
      ];
      const state = { recurring: rec, expenses: [], ...baseMeta };
      const { page } = await newApp(state, { browser });
      const bodyText = await page.locator('body').innerText();
      ok(`monthly day ${futureDay} (> today ${D}) NOT shown`, !/FutureRent/.test(bodyText));
      await page.close();
    } else {
      console.log('  (skipped — today is month end)');
    }
  });

  // ── Test 8: weekdays entry not due on weekend ──
  await test('8', 'Weekdays not due on weekend', async () => {
    const isWeekend = (DOW === 0 || DOW === 6);
    const rec = [
      { id: 13, name: 'WeekdayLunch', category: 'Convenience', shop: 'KonbiniShop', amount: 800, expense_type: 'normal', tags: '', notes: '', frequency: 'weekdays', day_value: null, is_active: true, last_added_date: null, sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page } = await newApp(state, { browser });
    const bodyText = await page.locator('body').innerText();
    if (isWeekend) ok('weekdays NOT shown on weekend', !/WeekdayLunch/.test(bodyText));
    else ok('weekdays shown on weekday', /WeekdayLunch/.test(bodyText));
    await page.close();
  });

  // ── Phase 3.5 — variable-amount recurring ──

  // [9] Form saves a blank amount → captured recurring insert has amount === null.
  await test('9', 'Form: blank amount saves as null', async () => {
    const state = { recurring: [], expenses: [], ...baseMeta };
    const { page, backend } = await newApp(state, { browser });
    // nothing due → no modal; open the Recurring tab and its add form
    await page.getByRole('button', { name: '🔁 Recurring', exact: true }).click();
    await page.waitForTimeout(300);
    await page.getByTitle('Add recurring entry').click();
    await page.waitForTimeout(300);
    await page.getByPlaceholder('e.g. Rent, Konbini').fill('VariableBill');
    // leave AMOUNT blank
    await page.locator('select').filter({ hasText: 'Select…' }).selectOption({ value: 'Convenience' });
    await page.getByPlaceholder('Or type a shop name').fill('KonbiniShop');
    // monthly is the default frequency with day_value=1 → Save should now be enabled
    const saveBtn = page.getByRole('button', { name: 'Save', exact: true });
    ok('Save enabled with blank amount', !(await saveBtn.isDisabled()));
    await saveBtn.click();
    await page.waitForTimeout(700);
    const ins = backend.captures.inserts.filter(i => i.table === 'cost_management_recurring');
    ok('one recurring insert', ins.length === 1, ins);
    const row = ins[0] && (Array.isArray(ins[0].rows) ? ins[0].rows[0] : ins[0].rows);
    ok('insert amount is null', row && row.amount === null, row);
    ok('insert name', row && row.name === 'VariableBill', row);
    ok('insert category', row && row.category === 'Convenience', row);
    ok('insert shop', row && row.shop === 'KonbiniShop', row);
    await page.close();
  });

  // [10] Due modal: null-amount rule shows inline input, blocks confirm until valid,
  //      then inserts the typed amount AND patches last_added_date.
  await test('10', 'Due modal: null rule prompts + inserts typed amount', async () => {
    const due = ymd(addDays(TODAY, -1));
    const today = ymd(TODAY);
    const rec = [
      { id: 20, name: 'VariableBill', category: 'Convenience', shop: 'KonbiniShop', amount: null, expense_type: 'normal', tags: '', notes: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: due, sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page, backend } = await newApp(state, { browser });
    const input = page.getByPlaceholder('¥ Enter amount');
    ok('inline amount input shown for null rule', (await input.count()) === 1);
    ok('amount placeholder "—" (no stored amount)', /—/.test(await page.locator('body').innerText()));
    const addBtn = page.getByRole('button', { name: 'Add', exact: true });
    ok('Add blocked while empty', await addBtn.isDisabled());
    await input.fill('0');
    ok('Add blocked on 0', await addBtn.isDisabled());
    await input.fill('1500');
    ok('Add enabled on valid amount', !(await addBtn.isDisabled()));
    await addBtn.click();
    await page.waitForTimeout(900);
    const ins = backend.captures.inserts.filter(i => i.table === 'cost_management_expenses');
    ok('one expense insert', ins.length === 1, ins);
    const erow = ins[0] && (Array.isArray(ins[0].rows) ? ins[0].rows[0] : ins[0].rows);
    ok('insert amount = typed 1500', erow && erow.amount === 1500, erow);
    ok('insert date = computed due (today)', erow && erow.date === today, erow);
    ok('insert category', erow && erow.category === 'Convenience', erow);
    const upd = backend.captures.updates.filter(u => u.table === 'cost_management_recurring');
    ok('recurring patch last_added_date = today', upd.length === 1 && upd[0].body.last_added_date === today, upd);
    await page.close();
  });

  // [11] Due modal: fixed-amount rule still one-taps with rec.amount, no input shown.
  await test('11', 'Due modal: fixed rule one-taps, no input', async () => {
    const due = ymd(addDays(TODAY, -1));
    const today = ymd(TODAY);
    const rec = [
      { id: 21, name: 'FixedBill', category: 'Convenience', shop: 'KonbiniShop', amount: 777, expense_type: 'normal', tags: '', notes: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: due, sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page, backend } = await newApp(state, { browser });
    ok('no inline input for fixed rule', (await page.getByPlaceholder('¥ Enter amount').count()) === 0);
    const addBtn = page.getByRole('button', { name: 'Add', exact: true });
    ok('Add immediately enabled', !(await addBtn.isDisabled()));
    await addBtn.click();
    await page.waitForTimeout(900);
    const ins = backend.captures.inserts.filter(i => i.table === 'cost_management_expenses');
    ok('one expense insert', ins.length === 1, ins);
    const erow = ins[0] && (Array.isArray(ins[0].rows) ? ins[0].rows[0] : ins[0].rows);
    ok('insert amount = stored 777', erow && erow.amount === 777, erow);
    ok('insert date = computed due (today)', erow && erow.date === today, erow);
    const upd = backend.captures.updates.filter(u => u.table === 'cost_management_recurring');
    ok('recurring patch last_added_date = today', upd.length === 1 && upd[0].body.last_added_date === today, upd);
    await page.close();
  });

  // [12] Recurring list renders a null-amount rule without crashing (fmt null-safe).
  await test('12', 'Recurring list: null-amount rule renders, no crash', async () => {
    // not due (last_added_date = today) → no modal; lands straight on the list
    const rec = [
      { id: 30, name: 'VarRule', category: 'Convenience', shop: 'KonbiniShop', amount: null, expense_type: 'normal', tags: '', notes: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: ymd(TODAY), sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page, logs } = await newApp(state, { browser });
    await page.getByRole('button', { name: '🔁 Recurring', exact: true }).click();
    await page.waitForTimeout(400);
    const bodyText = await page.locator('body').innerText();
    ok('null-amount row rendered (name shown)', /VarRule/.test(bodyText), bodyText.slice(0, 200));
    ok('shows "—" not "¥null"', /—/.test(bodyText) && !/¥null/.test(bodyText));
    ok('no page error from fmt(null)', !logs.some((l) => /PAGEERR/.test(l)), logs.filter((l) => /PAGEERR/.test(l)));
    await page.close();
  });

  // ── Phase 3.6 — time-gated recurring prompts ──
  // Frozen-clock helpers: drive "now" deterministically rather than wall-clock.
  // June 20 2026 is the reference day; daily rules with last_added=null are due
  // by DATE, so the show_after_time gate alone decides whether they surface.
  const FZ = (h, mi, s) => [2026, 5, 20, h, mi, s || 0]; // [y, monthIdx(June=5), d, h, mi, s]
  const FROZEN_YMD = '2026-06-20';

  // [13] Time gate: show_after_time in the FUTURE (local) → rule hidden from due set.
  await test('13', 'Time gate: future show_after_time → hidden', async () => {
    const rec = [
      { id: 40, name: 'EveningBill', category: 'Convenience', shop: 'KonbiniShop', amount: 500, expense_type: 'normal', tags: '', notes: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: null, show_after_time: '09:00:00', sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page, logs } = await newApp(state, { browser, now: FZ(8, 0, 0) }); // 08:00 < 09:00 gate
    const bodyText = await page.locator('body').innerText();
    ok('modal NOT shown (gated)', !/Recurring payments due/.test(bodyText), bodyText.slice(0, 160));
    ok('EveningBill NOT in due set', !/EveningBill/.test(bodyText));
    const lastDue = logs.filter((l) => /\[recurring\] due/.test(l)).pop() || '';
    ok('due-set log shows 0 / excludes rule', /due: 0/.test(lastDue) && !/EveningBill/.test(lastDue), lastDue);
    await page.close();
  });

  // [14] Time gate: same rule, current time now PAST the gate → rule surfaces.
  await test('14', 'Time gate: past show_after_time → shown', async () => {
    const rec = [
      { id: 41, name: 'EveningBill', category: 'Convenience', shop: 'KonbiniShop', amount: 500, expense_type: 'normal', tags: '', notes: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: null, show_after_time: '09:00:00', sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page } = await newApp(state, { browser, now: FZ(10, 0, 0) }); // 10:00 ≥ 09:00 gate
    const bodyText = await page.locator('body').innerText();
    ok('modal shown', /Recurring payments due/.test(bodyText));
    ok('EveningBill in due set', /EveningBill/.test(bodyText));
    await page.close();
  });

  // [15] Null show_after_time → always shown (no regression to default behavior),
  //      even at an early local time that would gate a time-set rule.
  await test('15', 'Time gate: null show_after_time → always shown', async () => {
    const rec = [
      { id: 42, name: 'AnytimeBill', category: 'Convenience', shop: 'KonbiniShop', amount: 500, expense_type: 'normal', tags: '', notes: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: null, show_after_time: null, sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page } = await newApp(state, { browser, now: FZ(8, 0, 0) }); // early, but no gate
    const bodyText = await page.locator('body').innerText();
    ok('modal shown for null-gate rule', /Recurring payments due/.test(bodyText));
    ok('AnytimeBill in due set', /AnytimeBill/.test(bodyText));
    await page.close();
  });

  // [16] Recurring LIST renders a time-set rule (coverage beyond form + due modal).
  //      last_added = today → not due → lands straight on the list, no modal.
  await test('16', 'Recurring list: time-set rule renders, no crash', async () => {
    const rec = [
      { id: 43, name: 'GatedRule', category: 'Convenience', shop: 'KonbiniShop', amount: 1200, expense_type: 'normal', tags: '', notes: '', frequency: 'daily', day_value: null, is_active: true, last_added_date: FROZEN_YMD, show_after_time: '09:00:00', sort_order: 0 },
    ];
    const state = { recurring: rec, expenses: [], ...baseMeta };
    const { page, logs } = await newApp(state, { browser, now: FZ(12, 0, 0) });
    ok('no modal (not due)', !/Recurring payments due/.test(await page.locator('body').innerText()));
    await page.getByRole('button', { name: '🔁 Recurring', exact: true }).click();
    await page.waitForTimeout(400);
    const bodyText = await page.locator('body').innerText();
    ok('GatedRule row rendered', /GatedRule/.test(bodyText), bodyText.slice(0, 200));
    ok('amount shown (¥1,200)', /1,200/.test(bodyText));
    ok('no page error rendering time-set rule', !logs.some((l) => /PAGEERR/.test(l)), logs.filter((l) => /PAGEERR/.test(l)));
    // open the edit form (tap the row name) → the SHOW AFTER time field is
    // populated from the stored value (openEdit null-guard round-trip).
    await page.getByText('GatedRule', { exact: true }).click();
    await page.waitForTimeout(400);
    const timeVal = await page.locator('input[type="time"]').first().inputValue().catch(() => '');
    ok('edit form time field populated 09:00(:00)', /^09:00(:00)?$/.test(timeVal), timeVal);
    await page.close();
  });

  // [17] todayStr local-day fix: frozen clock in the Tokyo midnight→09:00 window.
  //      The UTC path (old toISOString bug) would resolve to June 19; the local
  //      fix must resolve to June 20. Observed via the Add view's default date.
  await test('17', 'todayStr: Tokyo midnight window → correct local day', async () => {
    const state = { recurring: [], expenses: [], ...baseMeta }; // nothing due → Add view
    const { page } = await newApp(state, { browser, timezoneId: 'Asia/Tokyo', now: FZ(0, 30, 0) }); // 00:30 JST
    // open the date picker on the Add screen. Scope to the date-control button —
    // its name carries the date label (e.g. "📅 Today"); a negative lookahead
    // excludes the "📅 Calendar" nav tab added in 7a so we don't grab the tab.
    await page.getByRole('button', { name: /📅 (?!Calendar)/ }).click();
    await page.waitForTimeout(300);
    // month header should read the LOCAL month/year
    const bodyText = await page.locator('body').innerText();
    ok('calendar month is June 2026', /June 2026/.test(bodyText), bodyText.slice(0, 200));
    // the selected day in the grid (bold / primary bg) must be the 20th, not the 19th
    const selDay = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => /^\d{1,2}$/.test(b.textContent.trim()));
      const sel = btns.find((b) => {
        const cs = getComputedStyle(b);
        return Number(cs.fontWeight) >= 700 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      });
      return sel ? sel.textContent.trim() : null;
    });
    ok('default selected day = 20 (local), not 19 (UTC)', selDay === '20', { selDay });
    await page.close();
  });

  // ── Phase 8 — duplicate-detection coverage ──
  // findDuplicate matches on date(local key) + shop + amount(numeric both sides),
  // advisory only (Add anyway proceeds). These tests lock that behavior in and
  // exercise BOTH the Quick dialog and the multi (same-shop) per-row ⚠ path.
  const TODAY_YMD = ymd(TODAY);
  const expenseInserts = (backend) => backend.captures.inserts.filter((i) => i.table === 'cost_management_expenses');
  const firstRow = (cap) => cap && (Array.isArray(cap.rows) ? cap.rows[0] : cap.rows);

  // Drive Quick mode: open keypad, type amount, pick category → shop.
  async function quickFill(page, { amount, category, shop }) {
    await page.getByText('¥0', { exact: true }).first().click(); // amount hero → keypad
    await page.waitForTimeout(150);
    for (const ch of String(amount)) await page.getByRole('button', { name: ch, exact: true }).click();
    await page.getByRole('button', { name: /Category/ }).click(); // cat chip → sheet
    await page.waitForTimeout(150);
    // scope picks to the open bottom-sheet so the "Recent · tap to repeat" buttons
    // (which also contain the category/shop names) don't collide with the chip.
    await page.locator('.cm-sheet-in').getByRole('button', { name: new RegExp(category) }).click(); // pick cat → shop sheet
    await page.waitForTimeout(150);
    await page.locator('.cm-sheet-in').getByRole('button', { name: new RegExp(shop) }).click(); // pick shop
    await page.waitForTimeout(150);
  }

  // [18] Quick: exact date+shop+amount dup → flagged, and Save still inserts on
  //      "Add anyway" (dismissible proven, not just detected).
  await test('18', 'Quick: exact dup flagged + Add-anyway inserts', async () => {
    const existing = [{ id: 1, amount: 500, date: TODAY_YMD, category: 'Convenience', shop: 'KonbiniShop', expense_type: 'normal', tags: '', notes: '' }];
    const state = { recurring: [], expenses: existing, ...baseMeta };
    const { page, backend } = await newApp(state, { browser });
    await quickFill(page, { amount: 500, category: 'Convenience', shop: 'KonbiniShop' });
    const hintText = await page.locator('body').innerText();
    ok('live duplicate hint shown', /possible duplicate/i.test(hintText), hintText.slice(0, 160));
    await page.getByRole('button', { name: /Add ¥500/ }).click(); // Save CTA
    await page.waitForTimeout(300);
    ok('dup confirm dialog opened', /Possible duplicate/.test(await page.locator('body').innerText()));
    ok('no insert yet (still advisory)', expenseInserts(backend).length === 0, expenseInserts(backend));
    await page.getByRole('button', { name: 'Add anyway', exact: true }).click();
    await page.waitForTimeout(500);
    const ins = expenseInserts(backend);
    ok('insert happened after Add anyway', ins.length === 1, ins);
    const row = firstRow(ins[0]);
    ok('inserted amount 500', row && row.amount === 500, row);
    ok('inserted date = today (local)', row && row.date === TODAY_YMD, row);
    ok('inserted shop', row && row.shop === 'KonbiniShop', row);
    await page.close();
  });

  // [19] Multi (Same-shop): a row matching an existing entry → per-row ⚠, and the
  //      dialog's Add-anyway still inserts. Exercises the second surface.
  await test('19', 'Multi: per-row ⚠ flagged + Add-anyway inserts', async () => {
    const existing = [{ id: 1, amount: 500, date: TODAY_YMD, category: 'Convenience', shop: 'KonbiniShop', expense_type: 'normal', tags: '', notes: '' }];
    const state = { recurring: [], expenses: existing, ...baseMeta };
    const { page, backend } = await newApp(state, { browser });
    await page.getByRole('button', { name: /Same shop/ }).click(); // multi mode
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /Category/ }).click();
    await page.waitForTimeout(150);
    await page.locator('.cm-sheet-in').getByRole('button', { name: /Convenience/ }).click();
    await page.waitForTimeout(150);
    await page.locator('.cm-sheet-in').getByRole('button', { name: /KonbiniShop/ }).click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /📅 (?!Calendar)/ }).click(); // date picker (exclude 📅 Calendar nav tab)
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /Use these days/ }).click();
    await page.waitForTimeout(250);
    await page.getByText('Today', { exact: true }).first().click(); // expand the row
    await page.waitForTimeout(200);
    for (const ch of '500') await page.getByRole('button', { name: ch, exact: true }).click();
    await page.waitForTimeout(200);
    ok('per-row ⚠ duplicate shown', /already logged/.test(await page.locator('body').innerText()));
    await page.getByRole('button', { name: /Save all/ }).click();
    await page.waitForTimeout(300);
    ok('dup confirm dialog opened (multi)', /Possible duplicate/.test(await page.locator('body').innerText()));
    ok('no insert yet (advisory)', expenseInserts(backend).length === 0, expenseInserts(backend));
    await page.getByRole('button', { name: 'Add anyway', exact: true }).click();
    await page.waitForTimeout(500);
    const ins = expenseInserts(backend);
    ok('insert happened after Add anyway', ins.length === 1, ins);
    const row = firstRow(ins[0]);
    ok('inserted amount 500', row && row.amount === 500, row);
    ok('inserted date = today (local)', row && row.date === TODAY_YMD, row);
    ok('inserted shop', row && row.shop === 'KonbiniShop', row);
    await page.close();
  });

  // [20] Same date+shop but DIFFERENT amount → not flagged; Save inserts directly
  //      (no dialog), proving the amount field is part of the predicate.
  await test('20', 'Different amount → not flagged, direct insert', async () => {
    const existing = [{ id: 1, amount: 500, date: TODAY_YMD, category: 'Convenience', shop: 'KonbiniShop', expense_type: 'normal', tags: '', notes: '' }];
    const state = { recurring: [], expenses: existing, ...baseMeta };
    const { page, backend } = await newApp(state, { browser });
    await quickFill(page, { amount: 700, category: 'Convenience', shop: 'KonbiniShop' });
    ok('no live duplicate hint (amount differs)', !/possible duplicate/i.test(await page.locator('body').innerText()));
    await page.getByRole('button', { name: /Add ¥700/ }).click(); // Save CTA
    await page.waitForTimeout(500);
    ok('no dup dialog appeared', !/Possible duplicate/.test(await page.locator('body').innerText()));
    const ins = expenseInserts(backend);
    ok('inserted directly (1 expense)', ins.length === 1, ins);
    ok('inserted amount 700', firstRow(ins[0]) && firstRow(ins[0]).amount === 700, ins);
    await page.close();
  });

  // [21] Amount type coercion: existing amount stored as a STRING "500" vs entered
  //      numeric 500 → still flagged (Number() coercion on both sides).
  await test('21', 'Amount string vs number → treated equal', async () => {
    const existing = [{ id: 1, amount: '500', date: TODAY_YMD, category: 'Convenience', shop: 'KonbiniShop', expense_type: 'normal', tags: '', notes: '' }];
    const state = { recurring: [], expenses: existing, ...baseMeta };
    const { page, backend } = await newApp(state, { browser });
    await quickFill(page, { amount: 500, category: 'Convenience', shop: 'KonbiniShop' });
    ok('string "500" vs number 500 flagged', /possible duplicate/i.test(await page.locator('body').innerText()));
    await page.getByRole('button', { name: /Add ¥500/ }).click();
    await page.waitForTimeout(300);
    ok('dup dialog opened on coerced match', /Possible duplicate/.test(await page.locator('body').innerText()));
    await page.getByRole('button', { name: 'Add anyway', exact: true }).click();
    await page.waitForTimeout(500);
    ok('insert after Add anyway', expenseInserts(backend).length === 1, expenseInserts(backend));
    await page.close();
  });

  await browser.close();

  // ── summary grid: every test shows regardless of earlier failures ──
  console.log('\n──────── SUMMARY ────────');
  for (const r of results) {
    const status = r.error ? 'ERROR' : r.fail ? 'FAIL ' : 'PASS ';
    const counts = `${r.pass}✓ ${r.fail}✗`.padEnd(8);
    console.log(`  [${r.id}] ${status} ${counts} ${r.title}${r.error ? '  — ' + r.error : ''}`);
  }
  console.log(`\n──────── ${PASS} passed, ${FAIL} failed ────────`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILURE', e); process.exit(2); });
