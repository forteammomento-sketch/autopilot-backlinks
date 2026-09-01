# Product page template

Michigan Sports Outdoor · Elementor-ready, styled to the home page.

| File | Where it goes |
|---|---|
| `product-page.css` | **Once**, Elementor → Site Settings → Custom CSS |
| `product-page.html` | Elementor HTML widget, per product |

## Why this template exists

The catalogue runs on a wholesale feed, so the manufacturer's photos and copy
are identical on hundreds of dealer sites. That is why so many product URLs
sit in *Crawled – currently not indexed*, and why the ones that do rank get
impressions but few clicks.

Three blocks change that, and everything else here is scaffolding around them:

1. **Star ratings in the Google listing** — the `Product` + `AggregateRating`
   schema at the foot of the file. This is the biggest CTR lever available on
   the 12,000 pages already indexed, and it needs no new content.
2. **A real specs table** — seventeen fields a knife buyer checks. It is
   genuinely useful, and it is where the blade-length and edge-count
   attributes live.
3. **150–250 words of original description** — the only thing on the page that
   is not shared with every competitor on the same feed.

## Install

1. Elementor → Site Settings → **Custom CSS** → paste `product-page.css` → Update
   *(Elementor Pro. On free Elementor use Appearance → Customize → Additional CSS.)*
2. Per product: Container (**Full Width**, padding `0`) → **HTML widget** → paste
   `product-page.html`
3. Page settings → **Hide Title = ON** — this file has its own `<h1>`
4. Paste **both** `<script>` blocks. Elementor passes them through untouched.

## Matching your colours exactly

Ten variables at the top of the CSS. Mine are read from screenshots — close,
not exact:

```css
--pd-accent:#EDA53B;      /* amber CTA */
--pd-header:#20303F;      /* dark slate band */
--pd-heading:#1B2B39;     /* near-black navy */
--pd-price:#5E9F32;       /* green sale price */
```

Right-click the amber **Search** button on your homepage → Inspect → copy the
computed `background-color` → paste into `--pd-accent`. Repeat for the header
band and a green price. Nothing else hardcodes a colour.

**Fonts need no setup** — everything is `font-family: inherit`, so it picks up
your theme font automatically.

## Two rules you cannot bend

**Ratings must be real.** If a product has no reviews yet, delete the on-page
rating row, the whole reviews section, *and* the `aggregateRating` object from
the schema — all three together. Marking up ratings you do not display is a
structured-data violation and risks a manual action. Once the review app is
collecting, put them all back.

**Never mark up Google Business Profile reviews as product reviews.** They are
reviews of the shop, not of the knife.

## Before you publish

- [ ] Every `{{TOKEN}}` replaced — search the file for `{{`
- [ ] Description rewritten in your own words, not the feed's
- [ ] All seventeen spec fields filled from product data, not typed by hand
- [ ] Ratings real, or ratings block and schema both deleted
- [ ] Yoast / Rank Math schema set to **None** for products — otherwise you
      ship two competing `Product` blocks on the same page
- [ ] Rich Results Test passes with zero errors
- [ ] `priceValidUntil` set to a future date

## Rollout

Do not do all 12,000. Take the ~1,000 SKUs that are in stock, carry margin and
have real search volume — the priority list from the game plan. Those get the
full treatment. The rest keep the template but can run on shorter copy.

---

## October layer

Added on top of the base template. Four blocks, all wired to real data.

### 1. Delivery estimate — the one that matters

Sits directly under the stock line in the buy box. It is the highest-
converting element you can put on a product page during a season, because it
answers the only question a buyer has in late September: *will it get here in
time?*

Dates are **computed live**, never hardcoded — business days only, weekends
excluded, packing plus transit. The block then colours itself against the
opener:

| State | Condition | Message |
|---|---|---|
| Green | Latest date clears 1 Oct | "Arrives before the 1 October opener" |
| Amber | Earliest clears, latest does not | "Cutting it fine — may land just after" |
| Red | Neither clears | "Will arrive after the opener. In good time for firearm season, 15 Nov." |

That third state matters. **Telling someone it will miss the opener sells more
than pretending otherwise** — it moves them to the firearm season instead of
producing a refund and a one-star review.

Config sits in one block at the top of the script:

```js
var OPENER   = new Date('2026-10-01T00:00:00-04:00');
var PACK_MIN = 2, PACK_MAX = 3;   // business days to pack
var SHIP_MIN = 2, SHIP_MAX = 6;   // business days in transit
```

Change `OPENER` to `2026-11-15` when archery season starts. If your real
packing time is different, change it here — do not shorten it to look faster.

### 2. Free-gift nudge

Static by default: *"Spend $75, get a field sharpener free."*

To make the bar move with the real basket, feed the cart subtotal into
`data-cart` on `#pdpGift`. In WooCommerce that is
`WC()->cart->get_subtotal()`. It then reads *"$23.20 away from a free field
sharpener"* — which is the version that actually lifts order value.

Left static it still works. **Do not fake the number.**

### 3. Buy It With

A three-item bundle: this knife, a sharpener, a sheath. Raises order value
instead of cutting price, and answers *"what else do I need?"*

The second bullet — "Clears the $75 free-gift threshold" — is deliberate.
Two offers pointing the same direction beat two offers competing.

### 4. Recently viewed

Built from this browser's own `localStorage`. Hidden entirely on a first
visit; it never invents a history. Stored values are written with
`textContent`, never `innerHTML`, so a product name cannot inject markup.

---

### Before publishing the October layer

- [ ] `OPENER` matches the season you are actually selling into
- [ ] `PACK_MIN/MAX` match your real dispatch time — check against last month
- [ ] Bundle products exist, are in stock, and ship together
- [ ] The bundle price is genuinely lower than buying separately
- [ ] The free sharpener is in stock, and the $75 rule works at checkout
- [ ] Season badge removed or reworded once the season ends
