# New Era Indian Cuisine — website + online ordering

Two static, dependency-free front-ends for New Era Indian Cuisine (Chestnut Hill, Philadelphia & Plymouth Meeting, PA).
Plain HTML/CSS/JS — open `index.html` in a browser or drop the folder on any static host (Firebase Hosting, Netlify, Vercel, GitHub Pages). Nothing to build.

| Folder | What it is | Design reference |
|---|---|---|
| `website/` | Marketing site: hero turntable, menu, kitchen story, catering, locations, FAQ | Reverse-engineered from the Tondo Framer template (dark, Jost, pill buttons) with New Era's content and photos |
| `ordering/` | Online ordering app: menu with photos, size/spice/extras modifiers, cart, pickup/delivery, scheduling, checkout, confirmation, staff orders board (`#orders`) | Reverse-engineered from Heartland "Online Ordering by Genius" (Aladdin's Natural Eatery) with New Era's real Taqeout menu |

## website/
- `index.html` — whole page (CSS + JS inline). Design tokens are CSS variables at the top (`--bg`, `--ink`, `--accent` …).
- `menu-data.js` — the printed menu (from neweraindiancuisine.com) as a JS array; edit prices/descriptions here.
- `img/` — photos from the current site, plus round "plate" crops used in the hero turntable.

## ordering/
- `index.html` — the app. Single file; CSS tokens at the top, JS at the bottom.
- `menu.json` — the live menu exported from the Taqeout store (`clients/NewEra-PROD-oToE40` in Firestore): categories, 235 items with sizes/prices, spice-level flag, extras, both locations with hours, tax (8% / 6%), delivery minimum & radius, popular items.
- `img/` — 147 dish/category photos (480 px, from Cloudinary) named by item id.
- `data/taqeout-firestore-export.json` — raw export, in case you need fields not in `menu.json`.
- `test.responsive.js`, `test.concurrency.js` — Playwright tests. Serve the folder (`python3 -m http.server 8765`) then `node test.responsive.js` (phone/tablet/desktop full order flow with screenshots) and `node test.concurrency.js 40` (40 simultaneous customers).

### Where a backend plugs in
Everything the app needs from a server goes through one object in `index.html`:

```js
const Store = {
  async init(){},                 // connect
  async save(order){},            // POST a new order  (order = see shape below)
  async update(id, patch){},      // change status from the staff board
  subscribe(cb){}                 // live list of orders for the staff board
};
```
Today it uses `localStorage` (and the claude.ai shared db when the page is hosted there). Replace the four methods with Firebase/Supabase/your POS API and nothing else changes.

Order shape:
```json
{ "id":"NE-…", "createdAt":"ISO", "status":"new|preparing|ready|done",
  "locationId":"…", "location":"Chestnut Hill", "mode":"pickup|delivery", "when":"asap|ISO",
  "customer":{"name":"","phone":"","email":""}, "delivery":{"address":"","apt":"","zip":""},
  "notes":"", "payment":"pay_at_pickup",
  "lines":[{"name":"","size":"","qty":1,"unit":16.99,"spice":"Medium","extras":[],"note":""}],
  "subtotal":0,"tax":0,"fee":0,"tip":0,"total":0,"estMinutes":30 }
```

### Payments
"Pay now by card" is intentionally disabled in the checkout. Wire a processor (Finix is already used by the Plymouth Meeting Taqeout store; Square/Stripe also fine) in the `placeBtn` handler before calling `Store.save`.

## Lovable / next steps
Both apps are framework-free so they can be imported as-is. If you want them as React/Vite projects, the sensible split is: `menu.json` → data layer, `Store` → API hooks, the modal/cart/checkout blocks → components.
