const { chromium } = require('playwright');
const URL='http://127.0.0.1:8765/index.html';
const picks=['Garlic Naan','Vegetable Samosa','Chicken Tikka Masala','Butter Chicken','Saag Paneer','Mango Lassi','Lamb Curry','Plain Naan','Gulaab Jamun','Chana Masala'];
async function customer(b,k){const t0=Date.now();const ctx=await b.newContext({viewport:{width:k%2?390:1366,height:900},isMobile:!!(k%2)});const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 try{await page.goto(URL,{timeout:60000});await page.waitForSelector('.item',{timeout:60000});const tLoad=Date.now()-t0;
  // browse: open a category, then go back to all
  await page.click('.tab:has-text("Breads")');await page.waitForSelector('#sec-brWxNGIMOyLcpKofleuT',{timeout:10000});await page.click('.tab:has-text("All")');await page.waitForSelector('#sec-popular',{timeout:10000});
  for(const w of [picks[k%10],picks[(k*3+1)%10]]){await page.click(`.item:has-text("${w}")`);await page.waitForSelector('#addBtn');const sp=page.locator('input[name=spice][value="Hot"]');if(await sp.count())await sp.check();if(k%3===0)await page.click('[data-q="1"]');await page.click('#addBtn');}
  const vb=page.locator('#viewOrder');if(await vb.isVisible())await vb.click();await page.waitForSelector('#checkoutBtn');await page.click('#checkoutBtn');await page.waitForSelector('#coForm');
  await page.fill('input[name=first]','L'+k);await page.fill('input[name=last]','Load');await page.fill('input[name=phone]','2155'+String(100000+k).slice(-6));
  const tc=Date.now();await page.click('#placeBtn');await page.waitForSelector('.ok-card',{timeout:30000});const tCheckout=Date.now()-tc;
  const o=await page.evaluate(()=>JSON.parse(localStorage.getItem('ne.orders'))[0]);const exp=o.lines.reduce((a,l)=>a+l.unit*l.qty,0);const ok=Math.abs(o.subtotal-exp)<0.005&&Math.abs(o.total-(o.subtotal+o.tax+o.fee+o.tip))<0.011;
  await ctx.close();return{ok,id:o.id,tLoad,tCheckout,total:Date.now()-t0,errs};}
 catch(e){await ctx.close().catch(()=>{});return{ok:false,fail:e.message.slice(0,80),errs};}}
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*s.length))]};
(async()=>{const N=+process.argv[2];const batch=+process.argv[3]||N;const b=await chromium.launch();const t0=Date.now();let res=[];
 for(let i=0;i<N;i+=batch){res=res.concat(await Promise.all(Array.from({length:Math.min(batch,N-i)},(_,j)=>customer(b,i+j))));}
 await b.close();const ok=res.filter(r=>r.ok);const ids=ok.map(r=>r.id);
 console.log(JSON.stringify({customers:N,concurrent:Math.min(batch,N),completed:ok.length,failed:res.filter(r=>!r.ok).map(r=>r.fail).slice(0,3),uniqueIds:new Set(ids).size===ids.length,mathOk:ok.every(r=>r.ok),jsErrors:res.reduce((a,r)=>a+r.errs.length,0),p50_load_ms:pct(ok.map(r=>r.tLoad),.5),p95_load_ms:pct(ok.map(r=>r.tLoad),.95),p95_checkout_ms:pct(ok.map(r=>r.tCheckout),.95),p95_journey_ms:pct(ok.map(r=>r.total),.95),wall_s:Math.round((Date.now()-t0)/1000),orders_per_min:Math.round(ok.length/((Date.now()-t0)/60000))}));})();
