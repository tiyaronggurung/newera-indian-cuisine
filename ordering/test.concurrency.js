// Simulates N customers ordering at the same moment from separate browser profiles.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8765/index.html';
const N = +process.argv[2] || 12;
const picks = ['Garlic Naan', 'Vegetable Samosa', 'Chicken Tikka Masala', 'Butter Chicken', 'Saag Paneer', 'Mango Lassi', 'Lamb Curry', 'Plain Naan', 'Gulaab Jamun', 'Chana Masala'];
(async () => {
  const b = await chromium.launch();
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: N }, async (_, k) => {
    const ctx = await b.newContext({ viewport: { width: k % 2 ? 390 : 1366, height: 900 }, isMobile: !!(k % 2) });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    try {
      await page.goto(URL); await page.waitForSelector('.item');
      const want = [picks[k % picks.length], picks[(k * 3 + 1) % picks.length]];
      for (const w of want) { await page.click(`.item:has-text("${w}")`); await page.waitForSelector('#addBtn'); if (k % 3 === 0) await page.click('[data-q="1"]'); await page.click('#addBtn'); await page.waitForTimeout(100); }
      const vb = page.locator('#viewOrder'); if (await vb.isVisible()) await vb.click();
      await page.waitForSelector('#checkoutBtn'); await page.click('#checkoutBtn'); await page.waitForSelector('#coForm');
      await page.fill('input[name=first]', 'Guest' + k); await page.fill('input[name=last]', 'Test'); await page.fill('input[name=phone]', '21555500' + String(k).padStart(2, '0'));
      await page.click('#placeBtn'); await page.waitForSelector('.ok-card', { timeout: 10000 });
      const o = await page.evaluate(() => JSON.parse(localStorage.getItem('ne.orders'))[0]);
      const expected = o.lines.reduce((a, l) => a + l.unit * l.qty, 0);
      const okMath = Math.abs(o.subtotal - expected) < 0.005 && Math.abs(o.total - (o.subtotal + o.tax + o.fee + o.tip)) < 0.011;
      await ctx.close();
      return { k, id: o.id, lines: o.lines.length, total: o.total, okMath, errs, ms: Date.now() - t0 };
    } catch (e) { await ctx.close(); return { k, fail: e.message.slice(0, 120), errs }; }
  }));
  await b.close();
  const ids = results.map(r => r.id).filter(Boolean);
  console.log(JSON.stringify(results, null, 0));
  console.log('placed', ids.length, '/', N, '| unique ids', new Set(ids).size === ids.length, '| math ok', results.every(r => r.okMath), '| js errors', results.reduce((a, r) => a + r.errs.length, 0), '| wall ms', Date.now() - t0);
})();
