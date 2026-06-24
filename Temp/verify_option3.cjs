// Option-3 verification harness — headless chromium + mocked Supabase.
// Proves the same-day multi-entry feature end to end:
//   A  date-control quantity (tap Jun 12, stepper +1 → count 2) → confirm renders
//      TWO Jun-12 rows under one "2 entries" group header.
//   B  Same-shop mode, two amounts on one day → TWO insert records, both Jun 12.
//   C  DB-only dup detection (option b, NO sibling detection): two IDENTICAL rows
//      (same date+shop+amount) in one batch → neither flags ⚠ (rowDup checks the DB
//      only, which is empty) → "Save all (2)" stays enabled → BOTH insert.
//   D  In-list "＋ another" (addDayRow) → a second Jun-12 row appears AND it is the
//      active/auto-expanded one (setActiveRow(rows.length)).
//
// Run individually:        node Temp/verify_option3.cjs
// Mutation (teeth) check:   node Temp/verify_option3.cjs --mutate
//   --mutate flips A and C to the BROKEN expectation (A: collapse to 1 row; C: a
//   sibling-dedupe drops the 2nd insert), so a CORRECT app makes A and C go RED.
//   B and D carry no flip and stay GREEN under --mutate, which proves the mutation
//   targets only the intended lines. Same idiom as Temp/verify_7e.cjs.
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

const MUTATE = process.argv.includes('--mutate');
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const JUN12 = '2026-06-12';

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

// Mock Supabase backend over PostgREST-style routes. Captures every insert batch
// into captures.inserts (each { table, rows }), and serves GETs from in-memory state.
function makeBackend(state) {
  const captures = { inserts: [], updates: [], deletes: [] };
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
      if (table === 'cost_management_recurring') return json(state.recurring || []);
      if (table === 'cost_management_shops') return json(state.shops || []);
      if (table === 'cost_management_categories') return json(state.categories || []);
      if (table === 'cost_management_tags') return json(state.tags || []);
      return json([]);
    }
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      captures.inserts.push({ table, rows });
      const created = rows.map((r, i) => ({ id: 9000 + i, ...r }));
      if (table === 'cost_management_expenses') state.expenses.push(...created);
      return json(created);
    }
    if (method === 'PATCH') { return json([]); }
    if (method === 'DELETE') { return json([]); }
    return json([]);
  }
  return { handle, captures };
}

async function newApp(state, opts = {}) {
  const browser = opts.browser;
  // Pin timezone + clock so ymdLocal/isoOfDate and the default calendar month are
  // deterministic: frozen 2026-06-15 12:00 JST → today=Jun 15, yest=Jun 14, and
  // Jun 12 is a plain grid cell in the default (June 2026) calendar view.
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-US' });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));
  page.on('pageerror', (e) => logs.push('PAGEERR: ' + e.message));
  const backend = makeBackend(state);
  await page.route('**/rest/v1/**', backend.handle);
  await page.clock.setFixedTime(new Date('2026-06-15T12:00:00+09:00'));
  await page.goto(INDEX, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent.includes('Cost Management'), { timeout: 30000 });
  await page.waitForTimeout(800);
  return { page, backend, logs };
}

const gotoTab = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(300); };

// ── feature-driving helpers ──────────────────────────────────────────────────
// enter "Same shop" multi mode (isSame): shop/cat shared, amounts per row.
async function enterSameShopMode(page) {
  await gotoTab(page, '➕ Add');
  await page.getByRole('button', { name: /Same shop/ }).click();
  await page.waitForTimeout(300);
}
// open the 📅 date control (multi mode, rows empty → label "Select days").
async function openDateControl(page) {
  await page.getByRole('button', { name: /Select days/ }).click();
  await page.waitForTimeout(300);
}
// tap a day cell in the open AddCalSheet grid (accessible name is the day number).
async function tapDay(page, n) {
  await page.getByRole('button', { name: String(n), exact: true }).click();
  await page.waitForTimeout(250);
}
// Q2: scope the +/- stepper to the date-row labelled fmtDay(s) (e.g. "Jun 12"),
// never a bare getByText — with 2+ dates there are multiple steppers. The row div
// is the DEEPEST div that holds BOTH the exact label and a ＋ button.
async function stepperBump(page, label, sign) {
  const row = page.locator('div')
    .filter({ has: page.getByText(label, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: sign }) })
    .last();
  await row.getByRole('button', { name: sign }).click();
  await page.waitForTimeout(250);
}
const confirmDays = async (page) => { await page.getByRole('button', { name: /Use these days/ }).click(); await page.waitForTimeout(350); };
// set the shared category+shop (Same-shop mode top control): Category → Convenience → KonbiniShop.
async function setSharedShop(page) {
  await page.getByRole('button', { name: 'Category' }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Convenience' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'KonbiniShop' }).click();
  await page.waitForTimeout(250);
}
// expand the next still-empty row (its amount shows "¥–") and key in an amount.
async function fillNextRowAmount(page, digits) {
  await page.getByText('¥–', { exact: true }).first().click();
  await page.waitForTimeout(250);
  for (const k of digits) { await page.getByRole('button', { name: k, exact: true }).click(); await page.waitForTimeout(60); }
  await page.waitForTimeout(150);
}
const rowCount = (page) => page.getByRole('button', { name: '×' }).count();      // one × per review row
// the group header badge (Q2 disambiguator). EXACT match so it can't also catch the
// date-control label ("1 day · 2 entries"), which merely contains "2 entries".
const entriesBadge = (page) => page.getByText('2 entries', { exact: true }).count();
const expenseRecs = (backend) => backend.captures.inserts.filter(i => i.table === 'cost_management_expenses').flatMap(i => i.rows);

(async () => {
  const browser = await chromium.launch();

  const baseMeta = {
    recurring: [],
    shops: [{ id: 1, name: 'KonbiniShop', category: 'Convenience', is_favorite: true }],
    categories: [
      { id: 1, name: 'Convenience', icon: '🏪', color: '#f59e0b', sort_order: 1 },
      { id: 2, name: 'Housing', icon: '🏠', color: '#2563eb', sort_order: 2 },
    ],
    tags: [{ id: 1, name: 'Food', icon: '🍱', color: '#ef4444' }],
  };

  // ── A: date-control quantity (tap + stepper) → two Jun-12 rows + "2 entries" ──
  await test('A', 'Quantity 2 for Jun 12 (tap + stepper) → two rows under a "2 entries" group header', async () => {
    const state = { ...baseMeta, expenses: [] };
    const { page } = await newApp(state, { browser });
    await enterSameShopMode(page);
    await openDateControl(page);
    await tapDay(page, 12);                 // counts[Jun 12] = 1 (stepper row appears)
    await stepperBump(page, 'Jun 12', '＋'); // counts[Jun 12] = 2 (exercises the stepper, scoped)
    ok('confirm button reflects 2 entries', await page.getByRole('button', { name: /Use these days · 2 entries/ }).count() === 1);
    await confirmDays(page);

    const rows = await rowCount(page);
    const badge = await entriesBadge(page);
    // mutation-verified: with the new-Set/prev.find collapse restored, applyDates
    // would merge the two Jun-12 entries into ONE row and the badge would vanish.
    // --mutate asserts that BROKEN outcome, so a correct app (2 rows + badge) goes RED.
    if (MUTATE) {
      ok('[MUTATED] collapse → 1 Jun-12 row (expected RED on correct app)', rows === 1, { rows });
      ok('[MUTATED] no "2 entries" header (expected RED on correct app)', badge === 0, { badge });
    } else {
      ok('review list renders 2 rows for Jun 12', rows === 2, { rows });
      ok('group header shows the "2 entries" badge', badge === 1, { badge });
    }
    await page.close();
  });

  // ── B: same-shop, two amounts on one day → 2 insert records, both Jun 12 ──
  await test('B', 'Same shop + two amounts on Jun 12 → 2 INSERT records, both dated Jun 12', async () => {
    const state = { ...baseMeta, expenses: [] };
    const { page, backend } = await newApp(state, { browser });
    await enterSameShopMode(page);
    await setSharedShop(page);
    await openDateControl(page);
    await tapDay(page, 12); await tapDay(page, 12);  // counts[Jun 12] = 2
    await confirmDays(page);
    await fillNextRowAmount(page, ['3', '0', '0']);   // first Jun-12 row → 300
    await fillNextRowAmount(page, ['7', '0', '0']);   // second Jun-12 row → 700

    const saveBtn = page.getByRole('button', { name: /Save all \(2\)/ });
    ok('Save all (2) is present & enabled', await saveBtn.count() === 1 && !(await saveBtn.isDisabled()));
    await saveBtn.click();
    await page.waitForTimeout(800);

    const recs = expenseRecs(backend);
    ok('exactly 2 insert records', recs.length === 2, recs);
    ok('both records dated Jun 12', recs.length === 2 && recs.every(r => r.date === JUN12), recs.map(r => r.date));
    ok('amounts are the two entered values (300 & 700)', recs.map(r => Number(r.amount)).sort((a, b) => a - b).join(',') === '300,700', recs.map(r => r.amount));
    await page.close();
  });

  // ── C: two IDENTICAL rows in one batch — DB-only dup (no sibling detection) ──
  await test('C', 'Two identical rows (same date+shop+amount), DB empty → neither flags ⚠, both insert', async () => {
    const state = { ...baseMeta, expenses: [] };  // DB has NEITHER row
    const { page, backend } = await newApp(state, { browser });
    await enterSameShopMode(page);
    await setSharedShop(page);
    await openDateControl(page);
    await tapDay(page, 12); await tapDay(page, 12);  // counts[Jun 12] = 2
    await confirmDays(page);
    await fillNextRowAmount(page, ['5', '0', '0']);   // identical
    await fillNextRowAmount(page, ['5', '0', '0']);   // identical

    // rowDup() consults allExpenses ONLY (empty here) — siblings are NOT compared,
    // so neither identical row is flagged and the save stays unblocked.
    const bodyText = await page.locator('body').innerText();
    ok('neither row flags ⚠ (rowDup is DB-only, DB is empty)', !/⚠/.test(bodyText), bodyText.match(/⚠[^\n]*/g));
    const saveBtn = page.getByRole('button', { name: /Save all \(2\)/ });
    ok('Save all (2) stays enabled (no ⚠ batch block)', await saveBtn.count() === 1 && !(await saveBtn.isDisabled()));
    await saveBtn.click();
    await page.waitForTimeout(800);

    const recs = expenseRecs(backend);
    // mutation-verified: a dedupe/collapse of same-day-same-amount siblings would
    // drop the 2nd insert. --mutate asserts that BROKEN outcome (1 record), so a
    // correct app (which inserts BOTH) goes RED here.
    if (MUTATE) {
      ok('[MUTATED] sibling dedupe drops one insert (expected RED on correct app)', recs.length === 1, recs);
    } else {
      ok('both identical rows insert — 2 records', recs.length === 2, recs);
    }
    ok('inserted records are the identical pair (Jun 12, ¥500)', recs.every(r => r.date === JUN12 && Number(r.amount) === 500), recs.map(r => `${r.date}/${r.amount}`));
    await page.close();
  });

  // ── D: in-list "＋ another" (addDayRow) → 2nd Jun-12 row, auto-expanded ──
  await test('D', '"＋ another" adds a second Jun-12 row and auto-expands it (setActiveRow(rows.length))', async () => {
    const state = { ...baseMeta, expenses: [] };
    const { page } = await newApp(state, { browser });
    await enterSameShopMode(page);
    await openDateControl(page);
    await tapDay(page, 12);          // counts[Jun 12] = 1
    await confirmDays(page);
    ok('one Jun-12 row before "＋ another"', await rowCount(page) === 1, { rows: await rowCount(page) });
    ok('no row expanded yet (no date editor open)', await page.locator('input[type="date"]').count() === 0);

    await page.getByRole('button', { name: /another/ }).click();  // addDayRow(Jun 12)
    await page.waitForTimeout(350);

    const rows = await rowCount(page);
    const dateEditors = await page.locator('input[type="date"]').count();
    ok('a second Jun-12 row appears (2 rows)', rows === 2, { rows });
    ok('group now shows the "2 entries" badge', await entriesBadge(page) === 1);
    ok('the new row is auto-expanded (exactly one date editor open)', dateEditors === 1, { dateEditors });
    await page.close();
  });

  await browser.close();

  // ── summary grid ──
  console.log('\n──────── SUMMARY ────────');
  for (const r of results) {
    const status = r.error ? 'ERROR' : r.fail ? 'FAIL ' : 'PASS ';
    const counts = `${r.pass}✓ ${r.fail}✗`.padEnd(8);
    console.log(`  [${r.id}] ${status} ${counts} ${r.title}${r.error ? '  — ' + r.error : ''}`);
  }
  console.log(`\n──────── ${PASS} passed, ${FAIL} failed ${MUTATE ? '(--mutate: expect A & C RED)' : ''}────────`);
  process.exit(FAIL || results.some(r => r.error) ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILURE', e); process.exit(2); });
