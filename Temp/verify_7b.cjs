// Phase 7b verification harness — headless chromium + mocked Supabase.
// Standing guard for the shared useExpenseMutations hook (regression on the
// EXISTING TransactionsView edit + delete flow). Kept committed through 7c–7e.
// Run: node Temp/verify_7b.cjs   (optional: node Temp/verify_7b.cjs --mutate)
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

// open the History (transactions) tab
async function gotoHistory(page) {
  await page.getByRole('button', { name: '📋 History', exact: true }).click();
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
  const mkExpense = (over) => ({ id: 1, date: '2026-06-10', amount: 500, category: 'Convenience', shop: 'KonbiniShop', notes: 'lunch', expense_type: 'normal', tags: 'Food', ...over });

  // ── Test 1: edit a row through the shared hook → correct UPDATE payload ──
  await test('1', 'Edit via hook: UPDATE payload, modal closes, list reflects change', async () => {
    const state = { ...baseMeta, expenses: [mkExpense({ id: 42, amount: 500 })] };
    const { page, backend } = await newApp(state, { browser });
    await gotoHistory(page);
    // open this row's edit (row buttons render an emoji; target by title attr)
    await page.locator('button[title="Edit"]').first().click();
    await page.waitForTimeout(300);
    ok('edit modal open', /Edit Entry/.test(await page.locator('body').innerText()));
    // change the amount 500 -> 750
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
    ok('tags joined from tagsArray', u.body && u.body.tags === 'Food', u.body);
    ok('date preserved', u.body && u.body.date === '2026-06-10', u.body);
    ok('category preserved', u.body && u.body.category === 'Convenience', u.body);
    ok('shop preserved', u.body && u.body.shop === 'KonbiniShop', u.body);
    ok('expense_type preserved', u.body && u.body.expense_type === 'normal', u.body);
    ok('notes preserved', u.body && u.body.notes === 'lunch', u.body);

    const body = await page.locator('body').innerText();
    ok('edit modal closed after save', !/Edit Entry/.test(body));
    ok('toast shown (Updated)', /Updated/.test(body), body.slice(0, 120));
    ok('list reflects new amount 750', /750/.test(body) && !/\b500\b/.test(body), body.slice(0, 200));
    await page.close();
  });

  // ── Test 2: delete a row through the shared hook → correct DELETE, row gone ──
  await test('2', 'Delete via hook: DELETE on right id, row gone, toast shown', async () => {
    // sortedTx orders by date desc, then id desc. KonbiniShop (newer date) renders
    // first; SuperMart (older) renders second → nth(1) deterministically = id 8.
    const state = { ...baseMeta, expenses: [
      mkExpense({ id: 7, shop: 'KonbiniShop', amount: 300, date: '2026-06-11' }),
      mkExpense({ id: 8, shop: 'SuperMart', amount: 1200, date: '2026-06-10' }),
    ] };
    const { page, backend } = await newApp(state, { browser });
    await gotoHistory(page);
    ok('both rows present pre-delete', /SuperMart/.test(await page.locator('body').innerText()));
    // delete the SuperMart row (2nd row delete button; target by title attr)
    await page.locator('button[title="Delete"]').nth(1).click();
    await page.waitForTimeout(300);
    ok('confirm modal open', /Delete\?/.test(await page.locator('body').innerText()));
    // confirm (modal button text is exactly "Delete")
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForTimeout(700);

    const del = backend.captures.deletes.filter(d => d.table === 'cost_management_expenses');
    ok('one expense DELETE fired', del.length === 1, del);
    ok('DELETE targets the right id (8)', del[0] && del[0].id === 8, del);
    const body = await page.locator('body').innerText();
    ok('confirm modal closed', !/Delete\?/.test(body));
    ok('toast shown (Deleted)', /Deleted/.test(body), body.slice(0, 120));
    ok('SuperMart row gone', !/SuperMart/.test(body), body.slice(0, 200));
    ok('other row retained (KonbiniShop)', /KonbiniShop/.test(body));
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
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILURE', e); process.exit(2); });
