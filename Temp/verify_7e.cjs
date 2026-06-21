// Phase 7e verification harness — headless chromium + mocked Supabase.
// Exercises the day-panel "+ Add entry" jump: tapping it opens the existing Add
// flow pre-dated to the panel's day (for same-day stacking), reusing
// AddEntryView's quick insert path unchanged. Also proves the preset is consumed
// once and leaves no stale date on a later normal visit to the Add tab.
// Run: node Temp/verify_7e.cjs   (optional: node Temp/verify_7e.cjs --mutate)
//   --mutate flips one assertion to expect the broken (string-amount) INSERT,
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
// The frozen "today" (clock is pinned to 2026-06-15 JST in newApp) — the value
// the AddEntryView dates initializer would fall back to if it ignored presetDate.
const TODAY_ISO = '2026-06-15';

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

// Mock Supabase backend over PostgREST-style routes. Captures inserts/updates/
// deletes and applies them to in-memory state so the re-fetch reflects changes.
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
    if (method === 'PATCH') {
      const idEq = url.searchParams.get('id');
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
  // Pin timezone + clock so ymdLocal/isoOfDate and the default calendar month are
  // deterministic regardless of host date/TZ (CI in UTC vs a JST dev box).
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-US' });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));
  page.on('pageerror', (e) => logs.push('PAGEERR: ' + e.message));
  const backend = makeBackend(state);
  await page.route('**/rest/v1/**', backend.handle);
  // Freeze "now" to 2026-06-15 12:00 JST BEFORE load, so CalendarView's mount-time
  // new Date() sees it. setFixedTime (not clock.install) pins Date/now but leaves
  // setTimeout running, so the app's toast/fade/vibrate timers still fire.
  await page.clock.setFixedTime(new Date('2026-06-15T12:00:00+09:00'));
  await page.goto(INDEX, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent.includes('Cost Management'), { timeout: 30000 });
  await page.waitForTimeout(800);
  return { page, backend, logs };
}

const gotoTab = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(300); };
// open a day cell's panel — the calendar defaults to the current month (June 2026
// in this suite); accessible name starts with the day number + type indicators.
async function openDay(page, day) {
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
    ],
    tags: [{ id: 1, name: 'Food', icon: '🍱', color: '#ef4444' }],
  };
  // The existing day entry deliberately uses a DIFFERENT category/shop than the
  // one the insert picks (Convenience/KonbiniShop), so the picker buttons stay
  // unambiguous — the recent-entries block echoes this entry's category/shop.
  const mkExpense = (over) => ({ id: 1, date: '2026-06-10', amount: 500, category: 'Housing', shop: 'RentCo', notes: '', expense_type: 'normal', tags: '', ...over });

  // drive a quick-mode insert: amount 250 + Convenience + KonbiniShop, then Save.
  async function fillQuickInsert(page) {
    // category → shop (pickCat opens the shop sheet automatically). The chip's
    // accessible name carries its icon ("📂 Category"), so match by substring.
    await page.getByRole('button', { name: 'Category' }).first().click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Convenience' }).click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'KonbiniShop' }).click();
    await page.waitForTimeout(250);
    // amount via the keypad (tap the ¥0 hero to open it)
    await page.getByText('¥0', { exact: true }).click();
    await page.waitForTimeout(200);
    for (const k of ['2', '5', '0']) { await page.getByRole('button', { name: k, exact: true }).click(); }
    await page.waitForTimeout(200);
  }

  // ── Test 1: panel "+ Add entry" → Add view pre-dated → quick insert on that day ──
  await test('1', '+ Add entry jumps to Add pre-dated; quick insert fires INSERT with that date', async () => {
    const state = { ...baseMeta, expenses: [mkExpense({ id: 1, amount: 500 })] };
    const { page, backend } = await newApp(state, { browser });
    await gotoTab(page, '📅 Calendar');
    await openDay(page, 10);
    ok('day panel open on 2026-06-10', /2026-06-10/.test(await page.locator('body').innerText()));

    await page.getByRole('button', { name: '+ Add entry' }).click();
    await page.waitForTimeout(400);
    const body1 = await page.locator('body').innerText();
    ok('Add view shown (mode switcher visible)', /Quick/.test(body1) && /Same shop/.test(body1));
    // date control pre-filled to the panel day (Jun 10), NOT today (Jun 21).
    // mutation-verified: models the bug where the dates initializer ignores
    // presetDate and seeds today — the chip would then read "Today". With
    // --mutate we assert that BROKEN outcome, so a correct app goes RED here.
    if (MUTATE) {
      ok('[MUTATED] date chip ignores preset, shows Today (expected RED on correct app)', /📅 Today/.test(body1) && !/📅 Jun 10/.test(body1), body1.slice(0, 220));
    } else {
      ok('date chip pre-filled to Jun 10 (the panel day)', /📅 Jun 10/.test(body1), body1.slice(0, 220));
      ok('date chip is NOT "Today"', !/📅 Today/.test(body1));
    }

    await fillQuickInsert(page);
    const cta = page.getByRole('button', { name: /^Add ¥250/ });
    ok('CTA enabled with amount + date (Add ¥250 · Jun 10)', await cta.count() > 0);
    await cta.first().click();
    await page.waitForTimeout(800);

    const ins = backend.captures.inserts.filter(i => i.table === 'cost_management_expenses');
    ok('one expense INSERT fired', ins.length === 1, ins);
    const rows = (ins[0] && ins[0].rows) || [];
    ok('INSERT carries exactly one row', rows.length === 1, rows);
    const r = rows[0] || {};
    // mutation-verified: same preset-ignored bug — the INSERT date would fall
    // back to today instead of the panel day. With --mutate we assert that
    // BROKEN expectation, so a correct app (date === panel day) goes RED.
    if (MUTATE) {
      ok('[MUTATED] INSERT date falls back to today (expected RED on correct app)', r.date === TODAY_ISO, r);
    } else {
      ok('INSERT date === the panel day (2026-06-10)', r.date === '2026-06-10', r);
    }
    ok('INSERT shop === KonbiniShop', r.shop === 'KonbiniShop', r);
    ok('INSERT category === Convenience', r.category === 'Convenience', r);
    // mutation-verified: amount must be Number-coerced (not the keypad string).
    if (MUTATE) {
      ok('[MUTATED] amount stays a STRING "250" (expected RED on correct app)', r.amount === '250', r);
    } else {
      ok('amount Number-coerced to 250', r.amount === 250 && typeof r.amount === 'number', r);
    }
    await page.close();
  });

  // ── Test 2: preset is consumed once — a later normal Add visit is back to today ──
  await test('2', 'No stale preset: after the jump, opening Add normally is back to Today', async () => {
    const state = { ...baseMeta, expenses: [mkExpense({ id: 1, amount: 500 })] };
    const { page } = await newApp(state, { browser });
    await gotoTab(page, '📅 Calendar');
    await openDay(page, 10);
    await page.getByRole('button', { name: '+ Add entry' }).click();
    await page.waitForTimeout(400);
    ok('jumped Add view is pre-dated to Jun 10', /📅 Jun 10/.test(await page.locator('body').innerText()));

    // leave Add, then come back via the nav tab → fresh mount, preset already cleared
    await gotoTab(page, '📅 Calendar');
    await gotoTab(page, '➕ Add');
    const body = await page.locator('body').innerText();
    ok('normal Add visit is back to Today', /📅 Today/.test(body), body.slice(0, 220));
    ok('no stale Jun 10 preset', !/📅 Jun 10/.test(body));
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
