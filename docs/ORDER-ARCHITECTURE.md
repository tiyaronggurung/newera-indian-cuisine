# Order handling architecture — New Era Indian Cuisine

How an order travels from the customer's phone to the kitchen screen and back, modelled on how fast-casual restaurants run it (Toast, Square, Lightspeed Kitchen, Grubhub tablets). This is the spec to build against in Lovable.

**The one rule everything hangs on: the kitchen only ever sees an order after the card processor has confirmed payment.** No "pending" tickets, no cooking unpaid food, no refunds for lost orders.

---

## 1. The order lifecycle

```
pending_payment ──(webhook: paid)──▶ new ──(kitchen tap)──▶ preparing ──(tap)──▶ ready ──(tap / pickup)──▶ completed
      │                                                        │                      │
      └─(timeout 15 min / card declined)──▶ abandoned          └──────────────────────┴──(staff)──▶ cancelled → refunded
```

| State | Who sets it | Visible to kitchen? | Customer sees |
|---|---|---|---|
| `pending_payment` | `POST /orders` | **No** | "Confirming your payment…" |
| `abandoned` | Expiry job (15 min) or card decline | No | "Payment didn't go through" + retry |
| `new` | Payment webhook | **Yes — white ticket, sound plays** | "Order received · ready in ~30 min" + SMS |
| `preparing` | Kitchen taps ticket | Yes — orange | "Being prepared" |
| `ready` | Kitchen taps again | Yes — green | "Ready for pickup" + SMS |
| `completed` | Kitchen taps / auto after 60 min | Archived tab | "Thanks" + receipt |
| `cancelled` → `refunded` | Staff only, with reason | Archived | SMS + refund via processor |
| `scheduled` | `POST /orders` when a future time was chosen | Appears at *promised time − prep time* | "Scheduled for Thu 6:00 PM" |

Every transition is written to `order_events` (who, when, from → to) so disputes can be answered.

---

## 2. Sequence: placing an order

```
Customer phone              Edge function / API              Database             Card processor           Kitchen screen
     │  POST /orders {cart, customer, mode, when, order_id}      │                       │                       │
     │ ───────────────────────────▶ │                            │                       │                       │
     │                              │ re-price every line from menu table                │                       │
     │                              │ validate: hours, delivery radius, min, available   │                       │
     │                              │ INSERT orders (id = order_id, status=pending_payment) ▶│                   │
     │                              │ create PaymentIntent(amount, idempotency_key=order_id) ─────────────────▶ │
     │ ◀── {order_id, client_secret, totals} ──│                 │                       │                       │
     │  confirm card on phone (processor SDK, never our server) ─────────────────────────────────────────────▶ │
     │                              │ ◀──────────── webhook payment_intent.succeeded (signature verified) ─────│
     │                              │ UPDATE orders SET status='new', paid_at=now() WHERE id=order_id AND status='pending_payment'
     │                              │ INSERT order_events; enqueue sms_customer, notify_kitchen                  │
     │                              │                            │ realtime: orders changed ───────────────────────▶ ticket appears, sound
     │ ◀── realtime / poll: status=new ── "Order received" ──────│                       │                       │
```

Why it is shaped this way:
- **Server re-prices.** The phone sends item ids, sizes, options, quantities — never prices. A tampered or stale cart cannot change what is charged.
- **`order_id` is created on the phone and used as the payment idempotency key.** A double-tap, a retry after bad signal, or a webhook delivered twice all collapse to one order and one charge (`UPDATE … WHERE status='pending_payment'` is a no-op the second time).
- **Card details never touch our server.** The processor's SDK on the phone talks to the processor directly; we only receive a token / webhook. This keeps PCI scope at the minimum.
- **Webhook, not the phone's "success" callback, flips the order to `new`.** The phone can lose connection after paying; the webhook always arrives.

---

## 3. Kitchen display (KDS) — what the attached Lightspeed screen does, mapped to New Era

| Element in the screenshot | Behaviour to build |
|---|---|
| Tabs: All active · New · Preparing · Done · Archived | Filters on `status`; "All active" = new + preparing + ready |
| Ticket header: `#4 · Preparing · 8m 00s` | Daily ticket number (resets at open), status, **timer since `paid_at`** |
| Header colour: white (new) → orange (preparing) → green (done) | Driven by status; add **red** when timer > `est_minutes` (late) |
| `TO GO` / `PICK UP` label | `mode`: PICKUP / DELIVERY, plus scheduled time if any |
| Customer name, order #, item count | From `orders.customer_name`, `orders.id`, sum of qty |
| Line items with red modifier text ("Extra hot", "Fries.") | Size, **spice level**, extras and the kitchen note, in accent colour under the item |
| Tap ticket → advance status | `PATCH /orders/:id/status` with staff auth; one tap = next state |
| Icons: flag, search, print | Flag = problem/call customer; search by name or #; print to a USB/ethernet receipt printer |
| Sound on new ticket | Loop until first tap (standard on Grubhub/DoorDash tablets) |
| Two locations | KDS is scoped to one `location_id`; staff login decides which |

Device: an iPad or Android tablet by the pass, browser in kiosk/full-screen mode, always on. The current `ordering/#orders` board is the starting point; this spec turns it into the real thing.

**Unacknowledged-order alarm:** if a `new` ticket is not tapped within 3 minutes, send an SMS to the manager's phone and keep the sound going. This is the single most common failure in small-restaurant online ordering (tablet asleep, nobody looked) and the easiest to prevent.

---

## 4. Customer-facing status page

`/order/<order_id>` (link in the confirmation screen and the SMS):

received → preparing → ready, with the restaurant phone and "running late? call us". Polls every 15 s or subscribes via realtime. Same page shows the receipt after `completed`.

---

## 5. Notifications (never on the checkout path)

| Event | Customer | Restaurant |
|---|---|---|
| `new` (paid) | SMS: "Order #123 received, ready ~6:40 PM" | KDS ticket + sound; printer if configured |
| `new` not tapped in 3 min | — | SMS to manager |
| `ready` | SMS: "Your order is ready" | — |
| `cancelled` | SMS with reason + refund notice | — |
| Daily close | — | Email summary: orders, revenue, average prep time |

All sends go through a queue (Supabase cron / pg_net, or Cloud Tasks) so a slow SMS provider can never slow down or fail a checkout.

---

## 6. Data model (Postgres / Supabase)

```sql
create table locations (
  id text primary key, name text, phone text, address text, tax_rate numeric,
  delivery_enabled bool, delivery_radius_miles numeric, delivery_min numeric,
  hours jsonb, ordering_paused bool default false, paused_message text, est_prep_min int default 30);

create table menu_items (
  id text primary key, location_ids text[], category_id text, name text, description text,
  prices jsonb,            -- [{name:'Regular size 16 oz', price:16.99}, …]
  extras jsonb,            -- [{name:'make it vegan', price:0}]
  spice_level bool, available bool default true, sort int, image_url text);

create type order_status as enum ('pending_payment','abandoned','scheduled','new','preparing','ready','completed','cancelled','refunded');

create table orders (
  id text primary key,                     -- generated on the phone: NE-<time36>-<rand>; also the payment idempotency key
  ticket_no int,                           -- daily number shown on KDS, assigned when status becomes new
  location_id text references locations,
  status order_status not null default 'pending_payment',
  mode text check (mode in ('pickup','delivery')),
  scheduled_for timestamptz,               -- null = ASAP
  customer_name text, customer_phone text, customer_email text,
  delivery jsonb,                          -- {address, apt, zip} or null
  notes text,
  subtotal numeric, tax numeric, fee numeric, tip numeric, total numeric,
  payment_provider text, payment_ref text, paid_at timestamptz,
  est_minutes int,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table order_items (
  id bigserial primary key, order_id text references orders on delete cascade,
  menu_item_id text, name text, size text, qty int, unit_price numeric,
  spice text, extras jsonb, note text);

create table order_events (
  id bigserial primary key, order_id text references orders, at timestamptz default now(),
  actor text,            -- 'customer' | 'webhook' | staff user id | 'system'
  from_status order_status, to_status order_status, detail jsonb);

create index on orders (location_id, status, created_at desc);
create index on orders (scheduled_for) where status = 'scheduled';
```

Row-level security: customers can `select` only their own order by id (the id is unguessable); staff can `select`/`update` orders for their location; nobody but the API role can `insert` or change `total`/`paid_at`.

---

## 7. API (Supabase Edge Functions or any serverless)

| Endpoint | Auth | Does |
|---|---|---|
| `POST /orders` | none (public) | Validate → re-price → insert `pending_payment` → create PaymentIntent with `idempotency_key = order_id` → return `client_secret` + totals. Rate-limited 5/min per IP and per phone. |
| `POST /webhooks/payment` | processor signature | On `succeeded`: `pending_payment → new` (or `scheduled`), assign ticket number, enqueue notifications. On `failed`: → `abandoned`. Always idempotent. |
| `GET /orders/:id` | none, id is the secret | Status page |
| `PATCH /orders/:id/status` | staff JWT, same location | Kitchen taps; validates allowed transitions; writes `order_events` |
| `POST /orders/:id/cancel` | staff JWT | → `cancelled`, triggers refund via processor, SMS |
| cron every minute | system | `pending_payment` older than 15 min → `abandoned`; `scheduled` whose `scheduled_for − est_prep` ≤ now → `new`; `new` older than 3 min un-tapped → manager SMS |
| `GET /menu` | none, cached 60 s | Menu JSON generated from `menu_items`; the CDN serves it |

---

## 8. Edge cases this design already handles

| Situation | What happens |
|---|---|
| Customer double-taps Pay | Same `order_id` → same PaymentIntent → one charge |
| Phone dies right after paying | Webhook still arrives → order goes to kitchen → SMS tells customer |
| Webhook delivered twice | Second `UPDATE … WHERE status='pending_payment'` changes nothing |
| Customer closes the page before paying | Expires to `abandoned` after 15 min; kitchen never saw it |
| Price changed while cart was open | Server re-prices; if total differs from what the phone showed, API returns 409 and the app shows the new total before charging |
| Dish sold out mid-order | API rejects with the item name; app removes it and asks to review |
| Restaurant pauses ordering | `ordering_paused` → `POST /orders` returns 503 with the message; app shows banner |
| Order placed 2 minutes before close | Accepted if `now < close`; kitchen decides. Optional: stop accepting 15 min before close (`last_call_min`) |
| Scheduled order for Thursday 6 PM | Held as `scheduled`; fires to KDS at 5:30 PM |
| Tablet asleep, nobody saw the ticket | 3-minute manager SMS + continuous sound |
| Refund | Staff cancels → processor refund → `refunded` → SMS |

---

## 9. Build plan for Lovable

Lovable's native stack is **Supabase (Postgres + Auth + Realtime + Edge Functions) + Stripe**, so that's the fastest route. (Plymouth Meeting already has a Finix merchant account from TaQeOut; Finix is fine too but Lovable has no built-in integration, so Stripe is less work. The order flow is identical either way.)

Build in this order — each step is testable on its own:

1. **Schema + RLS** (section 6) and seed `menu_items` from `ordering/menu.json`.
2. **`GET /menu`** → point the existing ordering app at it instead of the static file (one line in `loadMenu`).
3. **`POST /orders` + Stripe PaymentIntent (test mode)** → wire the existing `Store.save` to call it and mount Stripe Elements in the checkout "Pay now by card" option.
4. **Webhook** → `pending_payment → new`. Verify: order appears in the DB only after a test card succeeds.
5. **KDS** → upgrade `ordering/#orders`: realtime subscription, tabs, timers, colours, sound, tap-to-advance, staff login, location scope.
6. **Status page + SMS** (Twilio) via a queue.
7. **Cron jobs** (abandon, scheduled, unacknowledged alarm).
8. **Tests from the repo** re-run against staging: `test.scenarios.js`, `test.reliability.js`, plus a k6 script for 1,000 `POST /orders`/min and the 100-identical-idempotency-key test described in `docs/ENGINEERING-AUDIT.md`.

### Prompt to start the Lovable project

> Import this repository. Keep `website/` and `ordering/` exactly as they are — same design, same menu, same checkout UI. Add a Supabase backend following `docs/ORDER-ARCHITECTURE.md`: create the tables in section 6 with row-level security, seed `menu_items` from `ordering/menu.json`, and implement the endpoints in section 7 as Edge Functions. Use Stripe in test mode; the payment idempotency key is the order id. The kitchen must only see orders after the payment webhook sets status to `new`. Replace the `Store` object in `ordering/index.html` so `save` calls `POST /orders` and confirms the PaymentIntent with Stripe Elements, and `subscribe` uses Supabase Realtime. Turn `ordering/#orders` into the kitchen display described in section 3 with staff login scoped to one location. Do not change prices, menu data, or the customer-facing design.

---

## 10. What the owner needs to provide

- A Stripe account (or the existing Finix credentials) — test keys first, live keys at launch
- A phone number for manager alerts, per location
- The tablet for the kitchen (any iPad/Android, on Wi-Fi, plugged in)
- Decision: keep "pay at pickup" as an option? Recommendation: **no** for online orders — card only, which is what Grubhub/DoorDash do and what makes the "kitchen sees only paid orders" rule hold.
