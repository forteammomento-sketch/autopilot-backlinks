# State pages

Michigan Sports Outdoor · commerce-first state landing pages, Elementor-ready.

| File | Where it goes |
|---|---|
| `state-pages.css` | **Once**, Elementor → Site Settings → Custom CSS |
| Ten state files — `california` `new-york` `ohio` `texas` `pennsylvania` `georgia` `north-carolina` `tennessee` `illinois` `wisconsin` | HTML widget, one per page |
| `build_states.py` | Regenerates all ten. Add a state to **both** `STATES` and `SIBLINGS`, then rerun. |

URLs: `/knives/{state-slug}/` — ten states, listed above
Hub: `/knives/` — build this first, it is what they all link up to.

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
| Pennsylvania | Included | Legal since Act 119 of 2022, 2 January 2023 |
| Georgia | Included | No switchblade ban in Georgia law |
| North Carolina | Included, with a caveat | Legal to own and open carry; outside the concealed-carry exception |
| Tennessee | Included | Legal since the 2014 repeal |
| **Illinois** | **Filtered out** | Lawful only for FOID cardholders — unverifiable at checkout |
| Wisconsin | Included | Legal since Act 149, February 2016 |

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
      agency to check (CDFW, NY DEC, Ohio Division of Wildlife, TPWD, PA Game
      Commission, Georgia DNR, NC Wildlife Resources Commission, TWRA,
      Illinois DNR, Wisconsin DNR)
- [ ] Images uploaded: hero 1600×600, tile 400×500, promo 640×400,
      6 categories 320×240, 8 brand logos, product shots 400×400
- [ ] Every source link clicked once to confirm it resolves
- [ ] Yoast / Rank Math schema set to **None** for these pages — the file
      already ships CollectionPage + BreadcrumbList
- [ ] Collections exist: `/collections/{state}-legal-knives/`

## Adding more states

Edit `build_states.py` and rerun. Add the state to **`STATES`** *and* to
**`SIBLINGS`** — `SIBLINGS` only lists states that actually have a page, so
forgetting it ships a broken link on every other page.

Each `STATES` entry needs a headline, a hero line, four legal facts with a
pill class, source links, season copy, and the category list.

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
| Pennsylvania | Legal | None | No — firearms only | Act 119 of 2022, 18 Pa.C.S. 908 |
| Georgia | Legal | Over 12″ needs a carry licence | **Yes**, O.C.G.A. 16-11-173 | O.C.G.A. 16-11-125.1 |
| North Carolina | Own/open carry only | None statutory | Not established — page does not claim either way | N.C.G.S. 14-269 |
| Tennessee | Legal | None since 2014 | **Yes**, 39-17-1314(f) since 2013 | 2014 Tenn. Acts ch. 870 |
| Illinois | FOID card only | None statewide; 3″ rule for public buildings | No | 720 ILCS 5/24-1 |
| Wisconsin | Legal | None | **Yes**, Wis. Stat. 66.0409 | 2015 Act 149 |

Two things worth getting right, because most pages online do not:

- Ohio's reform was **SB 140 and SB 156**. HB 243 was introduced but is not the
  law that passed.
- New York's 2019 repeal covered **gravity knives only**. Switchblades are
  still prohibited there.
- Pennsylvania's Philadelphia ordinance was declared **unenforceable by a
  federal court in 2023**, and the city was enjoined from enforcing it. Pages
  still telling readers Philadelphia bans knife carry are out of date.
- Georgia raised its weapon threshold from **five inches to twelve** in 2017.
  Older guides still quote five.
- Illinois automatics are **not flatly illegal** — 720 ILCS 5/24-1(e)(2) exempts
  FOID cardholders. We still do not ship them, because the card cannot be
  verified at checkout.
- Wisconsin's **Act 149 wiped out Milwaukee's three-inch rule** along with the
  state switchblade ban. Guides still citing Milwaukee are out of date.

**North Carolina preemption is deliberately not claimed either way.** Research
did not settle it, so the page uses location restrictions as its fourth fact
instead of asserting something unverified.
