// Phase 7c verification harness — headless chromium + mocked Supabase.
// Exercises the CalendarView day-panel edit + delete flow, now wired to the
// shared useExpenseMutations hook. Confirms: the panel stays open on the same
// day across the re-fetch, the right UPDATE/DELETE fires, siblings are retained,
// and deleting the day's LAST entry falls through to the empty-state.
// Run: node Temp/verify_7c.cjs   (optional: node Temp/verify_7c.cjs --mutate)
//   --mutate flips one assertion to expect the broken (string-amount) payload,
//   so a correct app makes that test go RED — proving the assertion has teeth.
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

// Mock Supabase backend over PostgREST-style routes. Captures updates + deletes
// and applies them to in-memory state so the re-fetch reflects the change.
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
      return json(rows.map((r, i) => ({ id: 9000 + i, ...r })));
    }
    if (method === 'PATCH') { // update
      const idEq = url.searchParams.get('id'); // "eq.3"
      const id = idEq ? Number(idEq.replace('eq.', '')) : null;
      captures.updates.push({ table, id, body });
      if (table === 'cost_management_expenses' && id != null) {
        const row = state.expenses.find((r) => r.id === id);
        if (row) Object.assign(row, body);
      }
      return json([{ id, ...body }]);
    }
    if (method === 'DELETE') {
      const idEq = url.searchParams.get('id');
      const id = idEq ? Number(idEq.replace('eq.', '')) : null;
      captures.deletes.push({ table, id });
      if (table === 'cost_management_expenses' && id != null) {
        const i = state.expenses.findIndex((r) => r.id === id);
        if (i >= 0) state.expenses.splice(i, 1);
      }
      return json([]);
    }
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
  await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent.includes('Cost Management'), { timeout: 30000 });
  await page.waitForTimeout(800);
  return { page, backend, logs };
}

// open the Calendar tab
async function gotoCalendar(page) {
  await page.getByRole('button', { name: '📅 Calendar', exact: true }).click();
  await page.waitForTimeout(300);
}

// open a given day cell's panel. `day` is the day-of-month number (the calendar
// defaults to the current month; tests use dates in 2026-06 == today's month).
async function openDay(page, day) {
  // Day cells are buttons whose accessible name starts with the day number
  // (followed by expense-type indicators). Anchor with \b to avoid 1 ⊂ 10 etc.
  await page.getByRole('button', { name: new RegExp('^' + day + '\\b') }).first().click();
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch();

  const baseMeta = {
    recurring: [],
    shops: [{ id: 1, name: 'KonbiniShop', category: 'Convenience', is_favorite: true }],
    categories: [
      { id: 1, name: 'Convenience', icon: '🏪', color: '#f59e0b', sort_order: 1 },
      { id: 2, name: 'Housing', icon: '🏠', color: '#2563eb', sort_order: 2 },
      { id: 3, name: 'Health', icon: '💊', color: '#10b981', sort_order: 3 },
    ],
    tags: [
      { id: 1, name: 'Food', icon: '🍱', color: '#ef4444' },
      { id: 2, name: 'Work', icon: '💼', color: '#2563eb' },
    ],
  };
  // dates land in 2026-06 so they show on the calendar's default (current) month.
  const mkExpense = (over) => ({ id: 1, date: '2026-06-10', amount: 500, category: 'Convenience', shop: 'KonbiniShop', notes: 'lunch', expense_type: 'normal', tags: 'Food', ...over });

  // ── Test 1: edit a panel row → correct UPDATE, panel stays open same day ──
  await test('1', 'Panel edit via hook: UPDATE payload, modal closes, panel stays on same day, list reflects change', async () => {
    const state = { ...baseMeta, expenses: [mkExpense({ id: 42, amount: 500 })] };
    const { page, backend } = await newApp(state, { browser });
    await gotoCalendar(page);
    await openDay(page, 10);
    ok('day panel open on 2026-06-10', /2026-06-10/.test(await page.locator('body').innerText()));

    // open this row's edit (panel row buttons carry title="Edit")
    await page.locator('button[title="Edit"]').first().click();
    await page.waitForTimeout(300);
    ok('edit modal open (layers over panel sheet)', /Edit Entry/.test(await page.locator('body').innerText()));
    // change amount 500 -> 750
    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill('750');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(700);

    const upd = backend.captures.updates.filter(u => u.table === 'cost_management_expenses');
    ok('one expense UPDATE fired', upd.length === 1, upd);
    const u = upd[0] || {};
    ok('UPDATE targets the right id (42)', u.id === 42, u);
    // mutation-verified assertion: amount must be Number-coerced (not a string).
    // With --mutate we assert the BROKEN expectation (string) → a correct app fails here.
    if (MUTATE) {
      ok('[MUTATED] amount stays a STRING (expected RED on correct app)', u.body && u.body.amount === '750', u.body);
    } else {
      ok('amount Number-coerced to 750', u.body && u.body.amount === 750 && typeof u.body.amount === 'number', u.body);
    }

    const body = await page.locator('body').innerText();
    ok('edit modal closed after save', !/Edit Entry/.test(body));
    ok('panel still open on same day (2026-06-10)', /2026-06-10/.test(body), body.slice(0, 200));
    ok('panel list reflects new amount ¥750', /¥750/.test(body) && !/¥500/.test(body), body.slice(0, 250));
    await page.close();
  });

  // ── Test 2: delete one of two panel rows → DELETE right id, sibling retained, panel open ──
  await test('2', 'Panel delete via hook: DELETE on right id, row gone, sibling kept, panel stays open', async () => {
    // Two entries on the SAME day → same panel. panelExpenses preserves the
    // fetch order [id 7, id 8], so nth(1) deterministically targets id 8.
    const state = { ...baseMeta, expenses: [
      mkExpense({ id: 7, shop: 'KonbiniShop', amount: 300, date: '2026-06-10' }),
      mkExpense({ id: 8, shop: 'SuperMart', amount: 1200, date: '2026-06-10' }),
    ] };
    const { page, backend } = await newApp(state, { browser });
    await gotoCalendar(page);
    await openDay(page, 10);
    ok('both rows present pre-delete', /SuperMart/.test(await page.locator('body').innerText()) && /KonbiniShop/.test(await page.locator('body').innerText()));

    // delete the SuperMart row (2nd panel delete button)
    await page.locator('button[title="Delete"]').nth(1).click();
    await page.waitForTimeout(300);
    ok('confirm modal open (layers over panel sheet)', /Delete\?/.test(await page.locator('body').innerText()));
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForTimeout(700);

    const del = backend.captures.deletes.filter(d => d.table === 'cost_management_expenses');
    ok('one expense DELETE fired', del.length === 1, del);
    ok('DELETE targets the right id (8)', del[0] && del[0].id === 8, del);
    const body = await page.locator('body').innerText();
    ok('confirm modal closed', !/Delete\?/.test(body));
    ok('panel still open on same day (2026-06-10)', /2026-06-10/.test(body), body.slice(0, 200));
    ok('SuperMart row gone', !/SuperMart/.test(body), body.slice(0, 250));
    ok('sibling row retained (KonbiniShop)', /KonbiniShop/.test(body));
    await page.close();
  });

  // ── Test 3: delete the day's LAST entry → empty-state, panel still open ──
  await test('3', "Delete last entry: panel falls through to 'No entries for this day' empty-state", async () => {
    const state = { ...baseMeta, expenses: [mkExpense({ id: 55, shop: 'SoloShop', amount: 900, date: '2026-06-10' })] };
    const { page, backend } = await newApp(state, { browser });
    await gotoCalendar(page);
    await openDay(page, 10);
    ok('single row present pre-delete', /SoloShop/.test(await page.locator('body').innerText()));

    await page.locator('button[title="Delete"]').first().click();
    await page.waitForTimeout(300);
    ok('confirm modal open', /Delete\?/.test(await page.locator('body').innerText()));
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForTimeout(700);

    const del = backend.captures.deletes.filter(d => d.table === 'cost_management_expenses');
    ok('one expense DELETE fired', del.length === 1, del);
    ok('DELETE targets the right id (55)', del[0] && del[0].id === 55, del);
    const body = await page.locator('body').innerText();
    ok('confirm modal closed', !/Delete\?/.test(body));
    ok('panel still open on same day (2026-06-10)', /2026-06-10/.test(body), body.slice(0, 200));
    ok('empty-state shown (No entries for this day)', /No entries for this day/.test(body), body.slice(0, 250));
    ok('deleted row gone (SoloShop)', !/SoloShop/.test(body));
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
  console.log(`\n──────── ${PASS} passed, ${FAIL} failed ${MUTATE ? '(--mutate: expect a RED)' : ''}────────`);
  process.exit(FAIL || results.some(r => r.error) ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILURE', e); process.exit(2); });
