# State pages

Michigan Sports Outdoor · commerce-first state landing pages, Elementor-ready.

| File | Where it goes |
|---|---|
| `state-pages.css` | **Once**, Elementor → Site Settings → Custom CSS |
| `california.html` `new-york.html` `ohio.html` `texas.html` | HTML widget, one per page |
| `build_states.py` | Regenerates all four. Add a state to `STATES` and rerun. |

URLs: `/knives/california/`, `/knives/new-york/`, `/knives/ohio/`, `/knives/texas/`
Hub: `/knives/` — build this first, it is what the four link up to.

## What these are

Shop pages with a short legal strip, not legal pages with products bolted on.
The commerce blocks run the page; the rules are four facts in a bordered box,
sourced and dated, and that is all.

Section order matches the home page: hero → trust bar → products with an
in-grid promo tile → the four rules → categories → brands → seasonal promo →
reviews → featured tabs → capture → sibling states.

## The compliance angle

This is the part worth keeping. Each page carries a **ships-to chip** on every
product card and, where a whole class of knife is illegal in that state, a
notice saying so plainly:

| State | Automatics | Why |
|---|---|---|
| California | **Filtered out** | Blades 2″+ prohibited, Penal Code 21510 |
| New York | **Filtered out** | Switchblades still listed in Penal Law 265.01(1) |
| Ohio | Included | Legal since SB 140, 12 April 2021 |
| Texas | Included | Legal since HB 1862, 1 September 2013 |

Telling a California buyer up front that you will not sell them a switchblade
is worth more than the sale you lose. It prevents a return, it prevents a
complaint, and it is the kind of thing a competitor running the same wholesale
feed will not bother to do.

The six products on every page are single-edge folders between 2.8″ and 3.5″,
which are legal in all four states. If you swap products in, re-check them
against that state before applying the chip.

## Install

1. Elementor → Site Settings → **Custom CSS** → paste `state-pages.css` → Update
   *(This sits alongside `product-page.css`. The two are scoped separately and
   do not clash. Keep the theme block identical in both.)*
2. Build the parent page `/knives/` first, titled **Shop Knives by State**
3. Per state: Pages → Add New → Page Attributes → **Parent = Shop Knives by State**
4. Container **Full Width**, padding `0` → **HTML widget** → paste the file
5. Page settings → **Hide Title = ON** — each file has its own `<h1>`
6. Paste both `<script>` blocks; Elementor passes them through untouched

## Before publishing

- [ ] `[N] products` counts filled in the category tiles
- [ ] `[YOUR FORM ENDPOINT]` replaced, or the form swapped for an Elementor Form
- [ ] Reviews section holds real reviews, **or is deleted entirely**
- [ ] Season dates verified — every page carries a `[VERIFY]` marker with the
      agency to check (CDFW, NY DEC, Ohio Division of Wildlife, TPWD)
- [ ] Images uploaded: hero 1600×600, tile 400×500, promo 640×400,
      6 categories 320×240, 8 brand logos, product shots 400×400
- [ ] Every source link clicked once to confirm it resolves
- [ ] Yoast / Rank Math schema set to **None** for these pages — the file
      already ships CollectionPage + BreadcrumbList
- [ ] Collections exist: `/collections/{state}-legal-knives/`

## Adding more states

Edit `STATES` in `build_states.py` and rerun. Each entry needs a headline, a
hero line, four legal facts with a pill class, the source links, the season
copy, and the category list.

**Research the legal facts from the state legislature's own site or AKTI.**
Use AI to tidy the wording once the verified fact is in hand — never to supply
it. Four wrong facts in a box that says "at a glance" is worse than no box.

## Legal facts as researched

| State | Automatics | Blade limit | Preemption | Key source |
|---|---|---|---|---|
| California | Illegal 2″+ | None statewide; LA caps public carry at 3″ | No | Penal Code 21510, 21310 |
| New York | Prohibited | None statewide; NYC requires full concealment | No | Penal Law 265.01(1) |
| Ohio | Legal | None | **Yes**, SB 156 from 13 Sep 2022 | SB 140, SB 156 |
| Texas | Legal | None for carry; over 5.5″ is location-restricted | **Yes**, Local Gov't Code 229.001 | Penal Code 46.01, HB 1935 |

Ohio's reform was **SB 140 and SB 156** — HB 243 was introduced but is not the
law that passed. Cite the right ones.
