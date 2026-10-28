const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8765/index.html';
const sizes = { mobile: [390, 844], tablet: [820, 1180], desktop: [1366, 900] };

async function flow(page, name, opts = {}) {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.stack.split('\n').slice(0,3).join(' | ')));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await page.goto(URL); await page.waitForSelector('.item');
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL); await page.waitForSelector('.item');
  if (opts.shots) await page.screenshot({ path: `./shots/${name}-menu.png` });
  // add a spice item with size
  await page.click('.item:has-text("Butter Chicken")'); await page.waitForSelector('#addBtn');
  if (opts.shots) await page.screenshot({ path: `./shots/${name}-item.png` });
  const hot = page.locator('input[name=spice][value="Hot"]'); if (await hot.count()) await hot.check();
  await page.click('[data-q="1"]'); await page.click('#addBtn');
  await page.click('.item:has-text("Garlic Naan")'); await page.waitForSelector('#addBtn'); await page.click('#addBtn');
  await page.click('.item:has-text("Mango Lassi")'); await page.waitForSelector('#addBtn'); await page.click('#addBtn');
  // open cart (mobile/tablet) and check totals
  const vb = page.locator('#viewOrder'); if (await vb.isVisible()) await vb.click();
  await page.waitForSelector('#checkoutBtn');
  if (opts.shots) await page.screenshot({ path: `./shots/${name}-cart.png` });
  const t = await page.evaluate(() => window.__NE.totals());
  await page.click('#checkoutBtn'); await page.waitForSelector('#coForm');
  if (opts.shots) await page.screenshot({ path: `./shots/${name}-checkout.png` });
  // validation: submit empty
  await page.click('#placeBtn'); const err = await page.textContent('#coErr');
  await page.fill('input[name=first]', opts.first || 'Test'); await page.fill('input[name=last]', 'User'); await page.fill('input[name=phone]', '2155551212'); await page.fill('input[name=email]', 'test@example.com');
  // if closed, pick a time
  const sel = page.locator('#whenSel'); // outside modal; state already picked by renderWhen
  await page.click('#placeBtn'); await page.waitForSelector('.ok-card', { timeout: 8000 });
  if (opts.shots) await page.screenshot({ path: `./shots/${name}-done.png` });
  const id = await page.textContent('.ok-card .num b');
  const orders = await page.evaluate(() => JSON.parse(localStorage.getItem('ne.orders')));
  return { name, errs, totals: t, validationMsg: err, id, saved: orders.length, total: orders[0].total, status: orders[0].status };
}

(async () => {
  const b = await chromium.launch();
  const fs = require('fs'); fs.mkdirSync('./shots', { recursive: true });
  for (const [name, [w, h]] of Object.entries(sizes)) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 800, hasTouch: w < 800 });
    const page = await ctx.newPage();
    try { console.log(JSON.stringify(await flow(page, name, { shots: true }))); } catch (e) { console.log(name, 'FAILED', e.message); await page.screenshot({ path: `./shots/${name}-fail.png` }); }
    await ctx.close();
  }
  // board view
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage();
  await page.goto(URL + '#orders'); await page.waitForTimeout(800); await page.screenshot({ path: './shots/board.png' }); await ctx.close();
  await b.close();
})();
