# 02 — Catalog & Discovery (public, SEO)

**Owner:** T1 · **Apps:** Web :3000, Mobile :3200 · **Auth:** none (public)
**Pre-req:** API up with seed data (doc 00 §4).

---

## Flow A — Browse & filter (Web)

**T-02-01 — Home loads featured**
- Steps: open `/`.
- Expected: hero + "Popular now" shows seeded internships (Flutter, Full-Stack, Data Science, Digital Marketing); category tiles present.
- Pass ☐ Fail ☐

**T-02-02 — Catalog list + counts**
- Steps: `/internships`.
- Expected: all 4 published internships; result count matches `meta.pagination.total`.
- Pass ☐ Fail ☐

**T-02-03 — Filters are shareable URLs**
- Steps: apply category=Flutter + price=PAID; copy URL into a fresh tab.
- Expected: URL is `/internships?category=flutter&pricingType=paid`; reopening reproduces the same filtered result (only Flutter internship).
- Pass ☐ Fail ☐

**T-02-04 — Each filter dimension** (run once each): category, pricingType free/paid, deliveryMode, level, sort newest/popular/price_asc/price_desc.
- Expected: results change correctly; price_asc shows FREE first; popular orders by enrolment count.
- Pass ☐ Fail ☐

**T-02-05 — Free-text search**
- Steps: `q=flutter`.
- Expected: returns the Flutter internship; `q=zzzz` → empty state with "Clear filters".
- Pass ☐ Fail ☐

## Flow B — Internship detail (SEO-critical)

**T-02-06 — Detail renders fully**
- Steps: open the Flutter internship detail.
- Expected: outcomes, curriculum accordion (titles + durations), upcoming batches with seats-left, instructor block, FAQs, price incl. GST.
- Pass ☐ Fail ☐

**T-02-07 — No paid content leaks** (IMPORTANT)
- Steps: View page source / network payload of a paid internship detail.
- Expected: **no `bunny_video_id` or playable video URL** anywhere except lessons flagged `isPreview`. Locked lessons show 🔒 only.
- Pass ☐ Fail ☐

**T-02-08 — SEO metadata + JSON-LD**
- Steps: View source.
- Expected: `<title>` and meta description present; `<link rel="canonical">`; OG tags; a `<script type="application/ld+json">` with `"@type":"Course"` and an `Offer` (price INR, availability from seats). Validate JSON-LD in Google Rich Results test.
- Pass ☐ Fail ☐

**T-02-09 — Seats messaging**
- Expected: batch with ≤10 seats shows "Only N seats left" in amber; full + waitlist → "Waitlist open"; full + no waitlist → "Batch full".
- Pass ☐ Fail ☐

**T-02-10 — Desktop vs mobile layout (Web)**
- Steps: view detail at 1440px then at 375px (devtools).
- Expected: desktop = sticky right-rail enroll card; mobile = price/CTA reordered to a sticky **bottom** bar, curriculum below. Genuinely different layout, not shrunk.
- Pass ☐ Fail ☐

**T-02-11 — Unknown slug** → branded 404 page with "Browse internships". Pass ☐ Fail ☐

## Flow C — Instructor public profile & CMS

**T-02-12** open instructor profile (`/instructors/3` Priya) → bio, expertise, her published internships. Pass ☐ Fail ☐
**T-02-13** public CMS page `/pages/refund-policy` (create it first in admin doc 06) renders markdown. Pass ☐ Fail ☐

## Flow D — Mobile layout (same :3000 app, auto-served to phones/tablets)

> Open Chrome devtools → device toolbar → pick iPhone/Pixel/iPad, then load `http://localhost:3000/`. You should be **auto-redirected to `/m`** and see the mobile-native layout. With a desktop UA, `/m` redirects back to `/`. There is no `:3200`.

**T-02-14 — Automatic device redirect**
- Steps: with a **mobile** UA, open `http://localhost:3000/` (and `/internships`, `/my`).
- Expected: redirects to `/m`, `/m/explore`, `/m/learn` respectively. With a **desktop** UA, the same paths stay on the desktop layout, and visiting `/m` redirects to `/`.
- Pass ☐ Fail ☐

**T-02-15 — App-shell chrome (full-screen on a real device, no bezel)**
- Expected: fixed top app bar, fixed **bottom tab bar** (Home/Learn/Live/Profile), screen content scrolls between them; tab highlights current section; fills the viewport edge-to-edge with safe-area insets.
- Pass ☐ Fail ☐

**T-02-16 — Search opens a bottom sheet**
- Steps: tap the search bar on `/m`.
- Expected: a **bottom sheet** slides up with keyword field, price segmented control, category chips; "Show results" navigates to `/m/explore?...` with those filters.
- Pass ☐ Fail ☐

**T-02-17 — Detail bottom-sheet + transitions**
- Steps: open a mobile internship detail; tap the bottom CTA.
- Expected: collapsing image hero; tapping CTA opens a batch-picker (free) or "Continue on website" (paid) bottom sheet; screen transitions slide.
- Pass ☐ Fail ☐

**T-02-18 — Cache headers**
- Steps: in non-dev (or check response headers): catalog responses carry `Cache-Control` for CDN. (Dev shows `no-store` — note it, not a bug.)
- Pass ☐ Fail ☐

---

## Checklist
- ☐ Home + catalog render seeded data
- ☐ Every filter + sort + search works; filters are shareable links
- ☐ Detail complete; **no locked-video leakage**; JSON-LD valid
- ☐ Seats/availability messaging correct
- ☐ Web desktop vs mobile layouts genuinely differ
- ☐ Mobile portal feels native: phone frame, app bar, bottom tabs, bottom sheets, transitions
- ☐ 404 + instructor profile + CMS page
