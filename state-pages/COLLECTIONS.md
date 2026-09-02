# Collections to build

32 collections are referenced across the hub and the twelve state pages.
Cross-checked against the HTML: every one listed here is linked from a page,
and every link on a page appears here. `collections.csv` is the same list in
a form you can work through row by row.

**Most of this is less work than the number suggests.** Six of the twelve
state collections need no filter at all, and seven of the core ones probably
exist already.

---

## The prerequisite: five product attributes

Ten of the 32 cannot be built until your SKUs carry these. This is the same
attribute pass flagged in the game plan, and it is still on the critical path.

| Attribute | Values | Which collections need it |
|---|---|---|
| `opening` | manual · assisted · automatic · OTF | CA, NY, IL, NC state sets + Automatic Knives |
| `blade_type` | folding · fixed | CA, NC state sets + EDC Folders + Fixed Blades |
| `blade_length` | decimal inches | Georgia, Under 5.5″ |
| `edge_count` | single · double | Michigan |
| `blade_shape` | drop point · clip · tanto · dagger · stiletto · … | Michigan |

Set them once as WooCommerce global attributes, fill them from your supplier
data, and every filtered collection below builds itself.

---

## 1. Core catalogue — 7

Shared by every state page. Most of these you already have.

| Slug | Title | Filter |
|---|---|---|
| `hunting-knives` | Hunting Knives | existing category |
| `field-dressing-knives` | Field Dressing Knives | gut hooks, skinners, caping |
| `edc-folding-knives` | EDC Folding Knives | `blade_type = folding` |
| `fixed-blade-knives` | Fixed Blade Knives | `blade_type = fixed` |
| `automatic-knives` | Automatic Knives | `opening = automatic OR OTF` |
| `camping-knives` | Camping & Survival | existing category |
| `fillet-knives` | Fillet & Bait Knives | existing category |

> **`automatic-knives` is never linked from the California, New York or
> Illinois pages.** That is deliberate — those three filter automatics out.
> If you add the tile back by hand, you undo the compliance work.

## 2. State-legal sets — 12

The compliance filter. This is what every state page's main CTA points at.

**Six need no filter — they are the full knife catalogue under a state name:**

`florida-legal-knives` · `ohio-legal-knives` · `texas-legal-knives` ·
`pennsylvania-legal-knives` · `tennessee-legal-knives` · `wisconsin-legal-knives`

Those states restrict nothing you stock. Build them as a plain "all knives"
query. They still deserve their own URL so the page can say *"Shop
Texas-Legal Knives"* and so you can merchandise them separately later.

**Six need a real filter:**

| Slug | Rule | Why |
|---|---|---|
| `michigan-legal-knives` | `edge_count = single` AND `blade_shape` not dagger/stiletto/dirk | Michigan restricts by blade shape, not opening — automatics are fine |
| `california-legal-knives` | `opening` manual/assisted AND `blade_type = folding` | Automatics 2″+ prohibited (PC 21510); concealed fixed blades are a wobbler |
| `new-york-legal-knives` | `opening` manual/assisted | Switchblades still listed in Penal Law 265.01(1) |
| `illinois-legal-knives` | `opening` manual/assisted | Automatics need a FOID card you cannot verify at checkout |
| `north-carolina-legal-knives` | `opening` manual/assisted AND `blade_type = folding` | The ordinary pocket knife exception excludes spring-opening knives |
| `georgia-legal-knives` | `blade_length <= 12` | Georgia's weapon threshold — effectively your whole catalogue |

## 3. Filtered subset — 1

| Slug | Title | Filter |
|---|---|---|
| `edc-knives-under-5-5-inch` | Under 5.5″ EDC Knives | `blade_length < 5.5` |

Texas tile. Clears the location-restricted category entirely, so it goes
anywhere in the state — schools, bars and stadiums included.

## 4. Seasonal — 12

Hand-curated, one per state, swapped as the season turns. Not urgent for
most; see the build order below.

| Slug | Angle |
|---|---|
| `michigan-deer-season-gear` | Archery opens 1 Oct — **build first** |
| `ohio-deer-season-gear` | Archery from 26 Sep |
| `pennsylvania-deer-season-gear` | Archery 3 Oct |
| `tennessee-deer-season-gear` | Archery 26 Sep |
| `texas-deer-season-gear` | Archery 3 Oct |
| `california-hunting-knives` | **Wild pig — year-round, no bag limit** |
| `florida-hunting-fishing-knives` | **Wild hog — year-round on private land** |
| `georgia-hunting-fishing-knives` | Archery 12 Sep |
| `illinois-hunting-fishing-knives` | Archery 1 Oct |
| `new-york-hunting-knives` | Northern bow 27 Sep |
| `north-carolina-hunting-knives` | Archery 12 Sep |
| `wisconsin-hunting-fishing-knives` | Nine-day gun hunt 21–29 Nov |

California and Florida are the two worth building properly, because wild
pig and hog have no closed season — those collections sell in all twelve
months, not six weeks.

---

## Build order

**Week 1 — unblocks everything**
1. Add the five attributes and populate them
2. The 6 filtered state sets: MI, CA, NY, IL, NC, GA
3. The 6 unfiltered state sets — an "all knives" query each

**Week 2**
4. Core seven, if any are missing
5. `edc-knives-under-5-5-inch`
6. `michigan-deer-season-gear` — the opener is 1 October

**Week 3 — as pages go live**
7. Remaining seasonal collections, starting with California and Florida

---

## Before you publish a state page

- [ ] Its `{state}-legal-knives` collection exists and returns products
- [ ] Its seasonal collection exists
- [ ] The `[N] products` counts on the page match the live collections
- [ ] For CA, NY and IL — confirm no automatic appears in the results
- [ ] For MI — confirm no dagger or double-edged blade appears

Re-run that automatic check after any catalogue import. A supplier feed can
quietly reintroduce a product class you filtered out, and the page will keep
telling California buyers you do not sell it.
