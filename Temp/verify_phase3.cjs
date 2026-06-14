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
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));
  page.on('pageerror', (e) => logs.push('PAGEERR: ' + e.message));
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
    const { page, backend } = await newApp(state, { browser });
    // snooze the first (Gym): first Snooze button in DOM order
    await page.getByRole('button', { name: 'Snooze', exact: true }).first().click();
    await page.waitForTimeout(900);
    ok('no inserts', backend.captures.inserts.length === 0, backend.captures.inserts);
    ok('no updates', backend.captures.updates.length === 0, backend.captures.updates);
    const bodyText = await page.locator('body').innerText();
    ok('Gym row removed', !/Gym/.test(bodyText), bodyText.slice(0, 200));
    ok('Konbini still present', /Konbini/.test(bodyText));
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
