#!/usr/bin/env python3
"""Generate MSO state landing pages. Edit STATES, run, paste output into Elementor."""
import json

SIBLINGS = [("Michigan","michigan"),("Texas","texas"),("Florida","florida"),
            ("California","california"),("New York","new-york"),("Ohio","ohio"),
            ("Pennsylvania","pennsylvania"),("Georgia","georgia"),
            ("North Carolina","north-carolina"),("Tennessee","tennessee"),
            ("Illinois","illinois"),("Wisconsin","wisconsin")]

BRANDS = [("Vosteed","vosteed"),("Kansept Knives","kansept-knives"),("Kubey Knives","kubey-knives"),
          ("Bestech Knives","bestech-knives"),("RUIKE","ruike"),("Kunwu Knives","kunwu-knives"),
          ("Elk Ridge","elk-ridge"),("ESEE","esee")]

# Products are all single-edge folders under 3.6" — compliant in all four states.
PRODUCTS = [
 ("Vosteed","Vosteed Crossbar Lock Blue","vosteed-crossbar-lock-blue","3.25","14C28N","66.00","52.80"),
 ("Kubey Knives","Kubey Knives Bluff Brown","kubey-knives-bluff-brown","3.50","D2","85.00","68.00"),
 ("Elk Ridge","Elk Ridge Wildlife Linerlock","elk-ridge-wildlife-linerlock","2.80","Stainless","12.00","8.70"),
 ("Bestech Knives","Bestech Knives Sanuk","bestech-knives-sanuk","3.15","14C28N","61.00","49.00"),
 ("Kansept Knives","Kansept Knives SIF Crossbar Lock","kansept-knives-sif","3.10","154CM","96.00","76.80"),
 ("RUIKE","RUIKE P801 Framelock","ruike-p801-folding-knife","3.50","14C28N","52.00","41.60"),
]

BASE_CATS = [
 ("Hunting Knives","hunting-knives","cat-hunting.jpg"),
 ("Field Dressing","field-dressing-knives","cat-field-dressing.jpg"),
 ("EDC Folders","edc-folding-knives","cat-edc.jpg"),
 ("Fixed Blades","fixed-blade-knives","cat-fixed.jpg"),
]
CAT_AUTO   = ("Automatic Knives","automatic-knives","cat-auto.jpg")
CAT_CAMP   = ("Camping & Survival","camping-knives","cat-camping.jpg")
CAT_FILLET = ("Fillet & Bait","fillet-knives","cat-fillet.jpg")

STATES = {
"california": dict(
  name="California", abbr="CA",
  h1="Hunting &amp; EDC Knives in California",
  hero="Every knife on this page is legal to own and carry in California &mdash; single-edge folders only, no restricted automatics. Shipped in 2&ndash;3 business days.",
  tile=("California<br>Legal Folders","No switchblades, no dirks","folders-california"),
  chip="CA-Legal",
  cats=BASE_CATS+[CAT_CAMP, CAT_FILLET],
  season_kicker="California season &middot; 2026",
  season_h="Deer, Hog and Backcountry",
  season_p="Field dressing and skinning knives for California deer and year-round wild hog &mdash; picked by Michigan Sports Outdoor and shipped in two to three business days.",
  season_slug="california-hunting-knives",
  season_sub="[VERIFY season dates with California Dept. of Fish and Wildlife]",
  legal=[
    ("Folding pocket knives","ok","Legal","No statewide blade-length limit. A folder may be carried openly or concealed when closed."),
    ("Switchblades 2&Prime; and over","no","Illegal","Possession, carry or sale is a misdemeanour under Penal Code 21510 &mdash; up to 6 months and a $1,000 fine. There is no open-carry exception."),
    ("Concealed fixed blades","no","Felony risk","Carrying a concealed dirk or dagger is a wobbler under Penal Code 21310. Fixed blades must be carried openly in a sheath."),
    ("City rules","warn","They apply","California has no knife preemption. Los Angeles ordinance 55-10 caps public carry at 3&Prime;."),
  ],
  notice="<strong>We do not ship automatic or switchblade knives to California.</strong> Blades of 2&Prime; and over are prohibited under Penal Code 21510, so those products are filtered out of every California collection. Everything you see here is a single-edge folder that is legal to own and carry statewide.",
  sources=[("Penal Code 21510 &mdash; Switchblade knives","https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=21510.&lawCode=PEN"),
           ("California Knife Laws","https://www.akti.org/state-knife-laws/california/")],
),
"new-york": dict(
  name="New York", abbr="NY",
  h1="Hunting &amp; EDC Knives in New York",
  hero="Gravity knives have been legal in New York since 2019. Every knife here is a single-edge folder that is legal to own statewide &mdash; shipped in 2&ndash;3 business days.",
  tile=("New York<br>Legal Folders","No switchblades","folders-new-york"),
  chip="NY-Legal",
  cats=BASE_CATS+[CAT_CAMP, CAT_FILLET],
  season_kicker="New York season &middot; 2026",
  season_h="Whitetail, Upland and Adirondack Trips",
  season_p="Field dressing knives, skinners and camp blades for New York whitetail and the Adirondacks &mdash; picked by Michigan Sports Outdoor and shipped in two to three business days.",
  season_slug="new-york-hunting-knives",
  season_sub="[VERIFY season dates with NY DEC]",
  legal=[
    ("Gravity knives","ok","Legal since 2019","Repealed from the Penal Law weapon lists on 30 May 2019. Simple possession is no longer a crime."),
    ("Switchblades","no","Prohibited","Still listed in Penal Law 265.01(1), with only narrow exceptions such as the hunting and fishing exception in 265.20(6)."),
    ("Folding knives","ok","Legal","Ordinary folders are legal to own and carry. Keep them fully out of sight in public."),
    ("New York City","warn","Stricter","NYC requires any knife to be completely concealed in public &mdash; a visible pocket clip is enough to breach it."),
  ],
  notice="<strong>We do not ship automatic or switchblade knives to New York.</strong> Switchblades remain prohibited under Penal Law 265.01(1), so they are filtered out of every New York collection. If you carry in New York City, keep the clip out of sight &mdash; a visible knife is a breach there even when the blade is legal.",
  sources=[("Penal Law 265.01 &mdash; Criminal possession of a weapon","https://www.nysenate.gov/legislation/laws/PEN/265.01"),
           ("New York Knife Laws","https://www.akti.org/state-knife-laws/new-york/")],
),
"ohio": dict(
  name="Ohio", abbr="OH",
  h1="Hunting &amp; EDC Knives in Ohio",
  hero="Ohio is one of the most permissive knife states in the country &mdash; automatics legal since 2021, and cities cannot add their own rules. Shipped in 2&ndash;3 business days.",
  tile=("Automatics<br>Legal in Ohio","Since April 2021","automatic-knives"),
  chip="OH-Legal",
  cats=BASE_CATS+[CAT_AUTO, CAT_CAMP],
  season_kicker="Ohio season &middot; 2026",
  season_h="Get Field-Ready Before the Opener",
  season_p="Field dressing knives, gut hooks, skinners and bone saws for Ohio whitetail &mdash; picked by Michigan Sports Outdoor and shipped in two to three business days.",
  season_slug="ohio-deer-season-gear",
  season_sub="[VERIFY season dates with Ohio Division of Wildlife]",
  legal=[
    ("Switchblades &amp; automatics","ok","Legal","Senate Bill 140 repealed the ban on making and selling switchblade, spring-blade and gravity knives, effective 12 April 2021."),
    ("Concealed carry","ok","Legal","A knife counts as a deadly weapon only if it is used as one. Concealed carry of any knife has been lawful statewide since 12 April 2021."),
    ("Blade length","ok","No limit","Ohio sets no statewide blade-length restriction for ordinary carry."),
    ("City rules","ok","Preempted","Senate Bill 156 added knives to Ohio&rsquo;s preemption law on 13 September 2022. Cities and counties cannot impose their own knife rules."),
  ],
  notice="",
  sources=[("Ohio Knife Laws","https://www.akti.org/state-knife-laws/ohio/"),
           ("Ohio knife law reform &mdash; effective dates","https://kniferights.org/legislative-update/knife-rights-ohio-knife-law-reform-effective-today/")],
),
"texas": dict(
  name="Texas", abbr="TX",
  h1="Hunting &amp; EDC Knives in Texas",
  hero="No blade-length carry limit in Texas, and cities cannot go stricter. Everything here is under 5.5&Prime;, so it goes anywhere. Shipped in 2&ndash;3 business days.",
  tile=("Go Anywhere<br>Under 5.5&Prime;","No location limits","edc-knives-under-5-5-inch"),
  chip="TX-Legal",
  cats=BASE_CATS+[CAT_AUTO, CAT_CAMP],
  season_kicker="Texas season &middot; 2026",
  season_h="Whitetail, Hog and Exotics",
  season_p="Field dressing knives, skinners, gut hooks and bone saws for Texas whitetail and year-round hog &mdash; picked by Michigan Sports Outdoor and shipped in two to three business days.",
  season_slug="texas-deer-season-gear",
  season_sub="[VERIFY season dates with Texas Parks &amp; Wildlife]",
  legal=[
    ("Blade length","ok","No carry limit","Any length is legal to carry. Over 5.5&Prime; becomes a &ldquo;location-restricted knife&rdquo; under Penal Code 46.01 &mdash; a limit on where, not whether."),
    ("Daggers, dirks, Bowie knives","ok","Legal","House Bill 1935 deleted that whole category on 1 September 2017."),
    ("Switchblades &amp; automatics","ok","Legal","Removed from the prohibited list by House Bill 1862, effective 1 September 2013."),
    ("Over 5.5&Prime; at a school","no","Felony","Third-degree felony, 2 to 10 years. Other restricted places are a Class C misdemeanour capped at $500."),
  ],
  notice="<strong>Everything on this page is under 5.5&Prime;</strong>, which keeps it clear of Texas&rsquo;s location-restricted category entirely &mdash; no school, bar, hospital or stadium rules to think about. Longer blades are legal to own and carry in Texas; they just come with the location list.",
  sources=[("Texas Penal Code Chapter 46 &mdash; Weapons","https://statutes.capitol.texas.gov/Docs/PE/htm/PE.46.htm"),
           ("Local Government Code 229.001 &mdash; preemption","https://statutes.capitol.texas.gov/Docs/LG/htm/LG.229.htm"),
           ("Texas Knife Laws","https://www.akti.org/state-knife-laws/texas/")],
),
}

TRUST = """  <div class="mso-st__trust">
    <div class="mso-st__trust-item"><span class="mso-st__trust-ico">&#9992;</span><span class="mso-st__trust-t">Free Shipping</span><span class="mso-st__trust-s">On orders over $50</span></div>
    <div class="mso-st__trust-item"><span class="mso-st__trust-ico">&#9873;</span><span class="mso-st__trust-t">Authorised Dealer</span><span class="mso-st__trust-s">Genuine stock only</span></div>
    <div class="mso-st__trust-item"><span class="mso-st__trust-ico">&#8635;</span><span class="mso-st__trust-t">30 Days Return</span><span class="mso-st__trust-s">Prepaid label</span></div>
    <div class="mso-st__trust-item"><span class="mso-st__trust-ico">&#9878;</span><span class="mso-st__trust-t">Ships 2&ndash;3 Days</span><span class="mso-st__trust-s">Weekdays only</span></div>
    <div class="mso-st__trust-item"><span class="mso-st__trust-ico">&#9993;</span><span class="mso-st__trust-t">Help Center</span><span class="mso-st__trust-s">24/7 support</span></div>
  </div>
"""

def product_card(p, chip):
    brand, name, slug, blade, steel, rrp, price = p
    return f"""      <div class="mso-st__prod">
        <span class="mso-st__chip">{chip}</span>
        <a class="mso-st__prod-img" href="/product/{slug}/"><img src="/wp-content/uploads/{slug}.jpg" alt="{name}" loading="lazy" width="400" height="400"></a>
        <div class="mso-st__prod-body">
          <span class="mso-st__prod-micro">{brand}</span>
          <p class="mso-st__prod-name"><a href="/product/{slug}/">{name}</a></p>
          <span class="mso-st__prod-spec">{blade}&Prime; &middot; {steel}</span>
          <div class="mso-st__prod-price"><span class="mso-st__was mso-st__num">${rrp}</span><span class="mso-st__now mso-st__num">${price}</span></div>
        </div>
      </div>
"""

def placeholder_card():
    return """      <div class="mso-st__prod">
        <a class="mso-st__prod-img" href="#"><img src="/wp-content/uploads/placeholder.jpg" alt="" loading="lazy" width="400" height="400"></a>
        <div class="mso-st__prod-body">
          <span class="mso-st__prod-micro">[Brand]</span>
          <p class="mso-st__prod-name"><a href="#">[Product name]</a></p>
          <span class="mso-st__prod-spec">[Blade]&Prime; &middot; [Steel]</span>
          <div class="mso-st__prod-price"><span class="mso-st__was mso-st__num">$0.00</span><span class="mso-st__now mso-st__num">$0.00</span></div>
        </div>
      </div>
"""

def build(slug, d):
    name, abbr = d["name"], d["abbr"]
    tile_t, tile_s, tile_slug = d["tile"]

    cards = "".join(product_card(p, d["chip"]) for p in PRODUCTS)
    cats = "".join(f"""      <a class="mso-st__cat" href="/collections/{cs}/">
        <span class="mso-st__cat-img"><img src="/wp-content/uploads/{img}" alt="{cn} in {name}" loading="lazy" width="320" height="240"></span>
        <span class="mso-st__cat-body"><span class="mso-st__cat-name">{cn}</span><span class="mso-st__cat-count">[N] products</span></span>
      </a>
""" for cn, cs, img in d["cats"])
    brands = "".join(f"""      <a class="mso-st__brand" href="/brand/{bs}/"><img src="/wp-content/uploads/brand-{bs}.png" alt="{bn}" loading="lazy" width="120" height="80"></a>
""" for bn, bs in BRANDS)
    legal = "".join(f"""      <div class="mso-st__legal-row">
        <dt>{lab}</dt>
        <dd><span class="mso-st__pill mso-st__pill--{cls}">{pill}</span>{txt}</dd>
      </div>
""" for lab, cls, pill, txt in d["legal"])
    sources = " &middot; ".join(f'<a href="{u}" rel="noopener">{t}</a>' for t, u in d["sources"])
    notice = f'    <div class="mso-st__notice">{d["notice"]}</div>\n' if d["notice"] else ""
    sibs = "".join(f'      <li><a href="/knives/{s}/">{n}</a></li>\n'
                   for n, s in SIBLINGS if s != slug)

    panels = ""
    for i, label in enumerate(["New Arrivals", "Best Sellers", "On Sale"], 1):
        hidden = "" if i == 1 else " hidden"
        panels += f"""    <div class="mso-st__panel" id="st-p{i}" role="tabpanel" aria-labelledby="st-t{i}"{hidden}>
      <div class="mso-st__grid">
{placeholder_card()*4}      </div>
    </div>

"""
    tabs = "".join(f'      <button class="mso-st__tab" role="tab" aria-selected="{"true" if i==1 else "false"}" aria-controls="st-p{i}" id="st-t{i}" type="button">{l}</button>\n'
                   for i, l in enumerate(["New Arrivals","Best Sellers","On Sale"], 1))

    ld = {"@context":"https://schema.org","@graph":[
      {"@type":"CollectionPage",
       "@id":f"https://www.michigansportsoutdoor.com/knives/{slug}/#page",
       "name":f"Hunting & EDC Knives in {name}",
       "description":f"Knives that are legal to own and carry in {name}, shipped in 2-3 business days by Michigan Sports Outdoor.",
       "inLanguage":"en-US",
       "isPartOf":{"@type":"WebSite","name":"Michigan Sports Outdoor","url":"https://www.michigansportsoutdoor.com/"},
       "about":{"@type":"Thing","name":f"Knives in {name}"},
       "spatialCoverage":{"@type":"State","name":name,"identifier":f"US-{abbr}"},
       "provider":{"@type":"Organization","name":"Michigan Sports Outdoor","url":"https://www.michigansportsoutdoor.com/"}},
      {"@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Home","item":"https://www.michigansportsoutdoor.com/"},
        {"@type":"ListItem","position":2,"name":"Shop by State","item":"https://www.michigansportsoutdoor.com/knives/"},
        {"@type":"ListItem","position":3,"name":name}]}]}

    return f"""<!-- =========================================================================
     Michigan Sports Outdoor — {name.upper()} state page
     Commerce-first. Legal strip is four facts, not an essay.
     Requires state-pages.css installed once in Site Settings → Custom CSS.
     URL: /knives/{slug}/
     Elementor: Container Full Width, padding 0 → HTML widget → paste all.
                Page settings → Hide Title = ON (this file has its own H1).
     ========================================================================= -->

<div class="mso-st">

<div class="mso-st__hero">
  <span class="mso-st__hero-bg"><img src="/wp-content/uploads/banner-{slug}.jpg" alt="" loading="eager" width="1600" height="600"></span>
  <div class="mso-st__hero-in">
    <div class="mso-st__inner">
      <span class="mso-st__badge">{name} &middot; 2026</span>
      <h1>{d["h1"]}</h1>
      <p>{d["hero"]}</p>
      <div class="mso-st__ctas">
        <a class="mso-st__btn" href="/collections/{slug}-legal-knives/">Shop {name}-Legal Knives</a>
        <a class="mso-st__btn mso-st__btn--onDark" href="#{slug}-rules">{name} Carry Rules</a>
      </div>
      <p class="mso-st__hero-meta">
        <span>Sold by <strong>Michigan Sports Outdoor</strong></span>
        <span>Ships to all of <strong>{name}</strong></span>
        <span>Updated <strong>1 September 2026</strong></span>
      </p>
    </div>
  </div>
</div>

<div class="mso-st__inner">

{TRUST}
  <div class="mso-st__sec">
    <div class="mso-st__sec-head">
      <h2>Knives You Can Legally Carry in {name}</h2>
      <p class="mso-st__sec-sub">Every one checked against {name} law before it goes on this page</p>
    </div>
    <div class="mso-st__grid">

      <a class="mso-st__tile" href="/collections/{tile_slug}/">
        <img src="/wp-content/uploads/tile-{slug}.jpg" alt="" loading="lazy" width="400" height="500">
        <span class="mso-st__tile-in">
          <strong>{tile_t}</strong>
          <span>{tile_s}</span>
          <em>Shop Now</em>
        </span>
      </a>

{cards}    </div>
    <div class="mso-st__ctas" style="justify-content:center;margin-top:26px">
      <a class="mso-st__btn" href="/collections/{slug}-legal-knives/">View All {name}-Legal Knives</a>
    </div>
  </div>

  <div class="mso-st__sec" id="{slug}-rules">
    <div class="mso-st__sec-head">
      <h2>{name} Knife Rules &mdash; The Short Version</h2>
      <p class="mso-st__sec-sub">Four things worth knowing before you carry</p>
    </div>
    <div class="mso-st__legal">
      <div class="mso-st__legal-hd">
        <strong>{name} at a glance</strong>
        <span>Updated 1 September 2026</span>
      </div>
      <dl class="mso-st__legal-rows">
{legal}      </dl>
      <p class="mso-st__legal-foot">
        Sources: {sources}. General information only &mdash; Michigan Sports Outdoor is a retailer, not a law firm. Check your city ordinance before you carry.
      </p>
    </div>
{notice}  </div>

  <div class="mso-st__sec">
    <div class="mso-st__sec-head">
      <h2>Shop by Category</h2>
      <p class="mso-st__sec-sub">Hunting, camping and everyday carry across {name}</p>
    </div>
    <div class="mso-st__grid mso-st__grid--6">
{cats}    </div>
  </div>

  <div class="mso-st__sec">
    <div class="mso-st__sec-head">
      <h2>Shop by Brand</h2>
      <p class="mso-st__sec-sub">Authorised dealer for every brand we carry</p>
    </div>
    <div class="mso-st__brands">
{brands}    </div>
    <div class="mso-st__brands-cta"><a class="mso-st__btn mso-st__btn--ghost" href="/brands/">All Brands</a></div>
  </div>

  <div class="mso-st__sec">
    <div class="mso-st__sec-head">
      <h2>{d["season_h"]}</h2>
      <p class="mso-st__sec-sub">{d["season_sub"]}</p>
    </div>
    <div class="mso-st__promo">
      <span class="mso-st__promo-img"><img src="/wp-content/uploads/promo-{slug}.jpg" alt="{name} hunting knives" loading="lazy" width="640" height="400"></span>
      <div class="mso-st__promo-body">
        <span class="mso-st__promo-kicker">{d["season_kicker"]}</span>
        <h3>{d["season_h"]}</h3>
        <p>{d["season_p"]}</p>
        <a class="mso-st__btn" href="/collections/{d["season_slug"]}/">Shop Season Gear</a>
      </div>
    </div>
  </div>

  <div class="mso-st__sec">
    <div class="mso-st__sec-head">
      <h2>What {name} Customers Say</h2>
      <p class="mso-st__sec-sub">Verified buyers from Michigan Sports Outdoor</p>
    </div>
    <!-- Real reviews only. If you have none for {name} buyers yet, delete
         this whole section rather than shipping placeholders. -->
    <div class="mso-st__revs">
      <div class="mso-st__rev">
        <div class="mso-st__rev-top"><span class="mso-st__rev-av">[A]</span><span><span class="mso-st__rev-name">[Reviewer name]</span><br><span class="mso-st__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span></span></div>
        <p>[Real review text &mdash; exactly as written]</p>
      </div>
      <div class="mso-st__rev">
        <div class="mso-st__rev-top"><span class="mso-st__rev-av">[B]</span><span><span class="mso-st__rev-name">[Reviewer name]</span><br><span class="mso-st__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span></span></div>
        <p>[Real review text]</p>
      </div>
      <div class="mso-st__rev">
        <div class="mso-st__rev-top"><span class="mso-st__rev-av">[C]</span><span><span class="mso-st__rev-name">[Reviewer name]</span><br><span class="mso-st__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span></span></div>
        <p>[Real review text]</p>
      </div>
      <div class="mso-st__rev">
        <div class="mso-st__rev-top"><span class="mso-st__rev-av">[D]</span><span><span class="mso-st__rev-name">[Reviewer name]</span><br><span class="mso-st__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span></span></div>
        <p>[Real review text]</p>
      </div>
    </div>
  </div>

  <div class="mso-st__sec">
    <div class="mso-st__sec-head">
      <h2>Featured Knives</h2>
      <p class="mso-st__sec-sub">All shipped from Michigan Sports Outdoor in 2&ndash;3 business days</p>
    </div>
    <div class="mso-st__tabs" role="tablist">
{tabs}    </div>

{panels}  </div>

  <div class="mso-st__capture">
    <h3>First look at {name} deals</h3>
    <p>One email from Michigan Sports Outdoor when we drop new stock or a season sale &mdash; and a note if a {name} carry rule changes.</p>
    <form class="mso-st__capture-form" action="[YOUR FORM ENDPOINT]" method="post">
      <label for="st-email" style="position:absolute;left:-9999px">Email address</label>
      <input type="email" id="st-email" name="email" placeholder="your@email.com" required>
      <button type="submit" class="mso-st__btn">Sign Up</button>
    </form>
    <p class="mso-st__capture-note">Unsubscribe any time.</p>
  </div>

  <div class="mso-st__sec">
    <div class="mso-st__sec-head">
      <h2>Shop Knives by State</h2>
      <p class="mso-st__sec-sub">Carry rules change at the state line</p>
    </div>
    <ul class="mso-st__states">
{sibs}      <li><a class="is-all" href="/knives/">All States &rarr;</a></li>
    </ul>
  </div>

</div><!-- /.mso-st__inner -->
</div><!-- /.mso-st -->

<div class="mso-st-sticky" id="stSticky" hidden>
  <p>{name}-legal knives &mdash; ships in 2&ndash;3 days</p>
  <a class="mso-st__btn" href="/collections/{slug}-legal-knives/">Shop Now</a>
  <button class="mso-st-sticky__x" type="button" aria-label="Dismiss">&times;</button>
</div>

<script>
(function () {{
  var root = document.querySelector('.mso-st');
  if (!root) return;

  var tabs = [].slice.call(root.querySelectorAll('.mso-st__tab'));
  tabs.forEach(function (tab) {{
    tab.addEventListener('click', function () {{
      tabs.forEach(function (t) {{
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        if (panel) panel.hidden = !on;
      }});
    }});
  }});

  var bar = document.getElementById('stSticky');
  var trigger = root.querySelector('.mso-st__legal');
  if (!bar || !trigger || !('IntersectionObserver' in window)) return;
  bar.hidden = false;
  var off = false;
  bar.querySelector('.mso-st-sticky__x').addEventListener('click', function () {{
    off = true; bar.classList.remove('is-on');
  }});
  new IntersectionObserver(function (e) {{
    if (off) return;
    bar.classList.toggle('is-on', !e[0].isIntersecting && e[0].boundingClientRect.top < 0);
  }}, {{ threshold: 0 }}).observe(trigger);
}})();
</script>

<!-- CollectionPage + BreadcrumbList. No Product schema here — these cards
     link out to real product pages that carry their own markup. Set
     Yoast / Rank Math schema to None for this page. -->
<script type="application/ld+json">
{json.dumps(ld, indent=2)}
</script>
"""

if __name__ == "__main__":
    for slug, d in STATES.items():
        open(f"{slug}.html", "w").write(build(slug, d))
        print(f"wrote {slug}.html")
