# Elementor mein State Page kaise banayein

Michigan Sports Outdoor · Knife Laws by State
Roman Urdu + English. Pehli page ~25 minute, uske baad ~10 minute per state.

---

## Step 0 · CSS install karein (sirf EK BAAR)

Yeh sirf pehli dafa karna hai. Uske baad 51 pages isi ek file se style honge.

1. WordPress admin → koi bhi page kholein → **Edit with Elementor**
2. Top-left **hamburger icon (☰)** → **Site Settings**
3. **Custom CSS** kholein
4. `knife-law-pages.css` ka poora content paste karein
5. **Update** dabayein

> **Custom CSS nahi dikh raha?** Woh Elementor **Pro** feature hai.
> Free Elementor par: **Appearance → Customize → Additional CSS** mein paste karein.
> Dono jagah same kaam karta hai.

**Har page par CSS paste mat karein.** 51 copies = har page par ~11 KB extra
CSS, aur agar kal design change karna ho to 51 pages edit karne padenge.

---

## Step 1 · URL structure banayein

Target URL: `michigansportsoutdoor.com/knife-laws/michigan/`

Iske liye pehle **parent page** chahiye:

1. **Pages → Add New**
2. Title: `Knife Laws by State`
3. Permalink: `knife-laws`
4. **Publish**

Ab har state page is parent ke andar jayega. Yeh hub page hai — baad mein
ismein 51 states ke links aur comparison table dalna hai.

---

## Step 2 · Michigan page banayein

1. **Pages → Add New**
2. Title: `Michigan Knife Laws`
3. Right sidebar → **Page Attributes → Parent** → `Knife Laws by State` select karein
4. Permalink check karein: `knife-laws/michigan` hona chahiye
5. **Publish** (khali page publish kar dein, phir Elementor kholein)

---

## Step 3 · Page settings — yeh step skip na karein

**Edit with Elementor** → bottom-left **gear icon (⚙)** → **Settings**:

| Setting | Value | Kyun |
|---|---|---|
| **Page Layout** | `Elementor Full Width` | Hero band edge-to-edge chahiye |
| **Hide Title** | **YES / ON** | Warna do H1 ban jayenge — SEO defect |

**Hide Title zaroori hai.** Theme page ka title `<h1>` mein print karta hai,
aur hamare HTML mein bhi ek `<h1>` hai. Do H1 = confusing signal Google ko.

---

## Step 4 · Container add karein

1. **+** dabayein → **Container** (Flexbox) add karein
2. Container select karein → **Layout** tab:
   - **Content Width:** `Full Width`
   - **Width:** `100%`
3. **Advanced** tab:
   - **Padding:** chaaron taraf `0`
   - **Margin:** `0`

Yeh isliye ke hamari CSS khud `.mso-kl__inner` se max-width aur padding
handle karti hai. Agar Elementor bhi padding dega to hero band ke dono
taraf safed gaps aa jayenge.

---

## Step 5 · HTML widgets paste karein

Search box mein **"HTML"** likhein → **HTML widget** container mein drag karein.

### Recommended split — 2 widgets

| Widget | Kya paste karein |
|---|---|
| **HTML widget A** | File ke start se brand strip ke `</div>` tak (hero banner → trust bar → products → categories → brands) |
| **HTML widget B** | Baaki sab — seasonal promo → reviews → featured tabs → sibling states, **dono `<script>` blocks samet** |

**Simple rakhna hai?** Poori `michigan.html` ek hi HTML widget mein paste kar
dein. Bilkul theek kaam karega — split sirf isliye hai taake beech mein
Elementor ke apne widgets daal sakein.

### Elementor ke native widgets kahan use karein (optional)

Do blocks aise hain jo khud update ho sakte hain agar Elementor widget
use karein:

- **Featured Knives (tabs wala block)** → HTML hata kar **Products widget**
  daalein, Query → Source: `Recent` / `Best Selling` / `On Sale`. Phir
  aapko 51 pages haath se update nahi karne padenge.
- **Reviews row** → agar review plugin ka apna widget hai to wahi use karein.

Lekin **product grid (Knives You Can Legally Carry)** hamesha manual rakhein —
usme legal chips hain jo aapne khud verify karne hain, koi automatic query
nahi laga sakti.

### Zaroori: dono `<script>` blocks bhi paste karein

File ke aakhir mein do script hain — ek tabs + sticky bar ka JavaScript,
doosra JSON-LD schema. **Dono HTML widget B mein aane chahiye.** Elementor
inhein bina badle output karta hai. "Custom Code" mein daalne ki zaroorat
nahi.

> **Agar tabs kaam na karein:** iska matlab JavaScript wala block paste
> nahi hua. Woh block Featured Knives section ke *baad* aana chahiye.

---

## Step 6 · Publish se pehle yeh fill karein

`michigan.html` mein yeh placeholders hain:

**Images** — sab `/wp-content/uploads/...` paths abhi dummy hain. Media
Library se asli URLs nikaal kar replace karein:

| Image | Size |
|---|---|
| `banner-michigan-knives.jpg` | 1600 × 600 (hero) |
| `tile-city-carry.jpg` | 400 × 500 (grid ke andar wala promo tile) |
| `promo-deer-season.jpg` | 640 × 400 |
| 6 category images | 320 × 240 |
| 8 brand logos | ~120 × 80, transparent PNG |
| Product images | 400 × 400 |

**Text placeholders:**

1. **Form endpoint** — `[YOUR FORM ENDPOINT]` ki jagah apna Mailchimp /
   Klaviyo / WPForms endpoint. Ya poora `<form>` hata kar Elementor ka
   Form widget use karein.
2. **Featured tabs ke products** — `[Brand]`, `[Product name]`, `$0.00`
3. **Reviews** — `[Reviewer name]`, `[Real review text]`. **Asli reviews
   hi daalein, wording exactly waisi hi.** Agar abhi reviews nahi hain to
   poora reviews block delete kar dein — khali ya banaya hua block na hone
   se bhi bura hai.
4. **Category counts** — `[N] products`

---

## Step 7 · SEO plugin settings (Yoast / Rank Math)

Page edit screen ke neeche:

| Field | Michigan ke liye |
|---|---|
| **Focus keyword** | `Michigan knife laws` |
| **SEO Title** | `Michigan Knife Laws 2026: Blade Length, Switchblades & Carry Rules` |
| **Meta Description** | `Michigan has no blade-length limit and switchblades are legal since 2017 — but a concealed dagger is a felony, even in your car. Full 2026 guide with statute citations.` |
| **Index** | Index, Follow |
| **Schema type** | `None` / `Article` — **default WebPage schema OFF karein** |

> **Schema conflict se bachein.** Yoast aur Rank Math apna khud ka schema
> add karte hain. Hamari JSON-LD already Article + FAQPage + Breadcrumb
> deti hai. Plugin ka FAQ/Article schema bhi ON hoga to **duplicate**
> ban jayega. Plugin mein is page ka schema `None` set kar dein.

---

## Step 8 · Publish ke baad — 4 checks

1. **Rich Results Test** — `search.google.com/test/rich-results` par URL
   daalein. Article, FAQPage, BreadcrumbList — teeno detect hone chahiye,
   zero errors.
2. **Mobile check** — phone par kholein. At-a-glance table **stack** honi
   chahiye, side-scroll nahi. Sticky bar table scroll hone ke baad neeche
   se aana chahiye.
3. **Do H1 to nahi?** — page par right-click → View Source → `<h1` search
   karein. Sirf **ek** hona chahiye.
4. **Search Console** → URL Inspection → **Request Indexing**

---

## Step 9 · Hub page complete karein

`/knife-laws/` par sab states ke links + comparison table daalein.
Har state page pehle se hub ko link karta hai (breadcrumb + bottom grid).

**Yeh reciprocal linking hi asli asset banati hai.** Iske bina 51 orphan
pages hain, ek authority hub nahi.

---

## Agli states ke liye (~10 minute each)

1. `_TEMPLATE.html` copy karein
2. Har `{{TOKEN}}` replace karein — file ke aakhir mein keyword map hai
3. Steps 2–8 repeat karein

**Legal facts ka rule:** har `{{ANSWER}}` state legislature ki apni site se
verify karein. AI se sirf plain-English drafting karwayein — **facts kabhi
generate na karwayein.** Ek galat statute number us bharose ko tabah kar
deta hai jiske liye yeh page banaya hi gaya hai.

---

## Common problems

| Problem | Fix |
|---|---|
| Hero band ke dono taraf safed gap | Container padding `0`, Content Width `Full Width` |
| Do H1 dikh rahe hain | Elementor page settings → **Hide Title** ON |
| Styling bilkul nahi lag rahi | CSS Site Settings mein save nahi hui — Step 0 dobara |
| Sticky bar nahi aa raha | JavaScript block paste nahi hua, ya `.mso-kl__glance` page par nahi hai |
| Colours theme se match nahi | CSS ke top wala theme block edit karein (neeche dekhein) |
| Schema duplicate warning | Yoast/Rank Math ka schema is page ke liye `None` karein |

### Colours exactly match karne ke liye

CSS ke shuru mein 10 variables hain. Meri values screenshot se li gayi hain —
qareeb hain, bilkul exact nahi:

1. Homepage par amber **Search** button par right-click → **Inspect**
2. Styles panel mein `background-color` ki value copy karein
3. CSS mein `--kl-accent` mein paste karein
4. Yehi header band (`--kl-header`) aur green price (`--kl-price`) ke liye

**Font ki fikar na karein** — sab kuch `font-family: inherit` par hai, to
theme ka font khud utha lega. Kuch set nahi karna.
