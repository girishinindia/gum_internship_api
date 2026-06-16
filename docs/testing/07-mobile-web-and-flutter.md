# 07 — Mobile Web (auto-served in the web app) & Flutter App

**Owner:** T5 (+ T1 for mobile web) · **Apps:** Web :3000 (mobile layout under `/m`), Flutter app (emulator/device)
**Pre-req:** API + web up. For Flutter, complete doc 00 §3.4. The golden rule for the **Flutter app**: consumption-first — NO in-app payment. (The mobile *web* layout, being a browser, uses normal Razorpay web checkout like desktop.)

> There is **no separate mobile site/server**. The same :3000 app serves a mobile-native layout when the device is a phone/tablet (User-Agent redirect to `/m/*`). Test it via devtools device mode or a real device.

---

## PART A — Mobile web layout (:3000 → `/m`, device-detected)

**T-07-01 — Automatic device redirect (CORE)**
- Steps: in devtools device mode (iPhone/Pixel/iPad), load `http://localhost:3000/`, then `/internships`, then `/my`.
- Expected: redirected to `/m`, `/m/explore`, `/m/learn`. Switch to a desktop UA → those paths stay desktop, and `/m` redirects back to `/`. `/login` and `/verify/*` are shared (no redirect either way).
- Pass ☐ Fail ☐

**T-07-02 — Full-screen native layout on a device**
- Steps: open on a real phone or mobile devtools.
- Expected: the mobile layout fills the viewport edge-to-edge (no phone-bezel — this is a real device), respects safe-area insets, pinch-zoom disabled.
- Pass ☐ Fail ☐

**T-07-03 — App shell**
- Expected: fixed top app bar per screen; persistent **bottom tab bar** (Home/Learn/Live/Profile) that highlights the active tab; body scrolls between them.
- Pass ☐ Fail ☐

**T-07-04 — Bottom sheets**
- Steps: tap search on Home; tap the CTA on a detail page.
- Expected: bottom sheets slide up from the bottom with a drag-grabber and dimmed backdrop; tapping the backdrop closes them.
- Pass ☐ Fail ☐

**T-07-05 — Segmented control + chips** in the filter sheet behave like native controls. Pass ☐ Fail ☐

**T-07-06 — Screen transitions** — navigating between screens uses a subtle slide/fade (`screen-enter`), not a hard page flash. Pass ☐ Fail ☐

**T-07-07 — Free enrollment in-app**
- Steps: open a FREE internship → CTA → pick batch in the sheet → confirm.
- Expected: enrolls in-app; lands on `/m/learn` with a progress card.
- Pass ☐ Fail ☐

**T-07-08 — Paid checkout (mobile web = real web checkout)**
- Steps: open a PAID internship (Flutter) on the mobile layout → CTA.
- Expected: a "Secure checkout" bottom sheet shows the total incl. GST and a "Proceed to secure checkout" button (routes into the shared web checkout — full flow is session 3.6). This is browser web checkout, allowed on mobile web. (Consumption-first applies to the **Flutter app**, Part B, not the mobile browser.)
- Pass ☐ Fail ☐

**T-07-09 — Auth parity** — login sets the httpOnly session; `/m/learn` & `/m/profile` are protected (redirect to `/login?next=`); logout returns to `/m`; a logged-in mobile user hitting `/my` lands on `/m/learn`. Pass ☐ Fail ☐

**T-07-10 — Indic text** — if any content is Hindi/Gujarati, it renders with correct script (Noto fonts) and taller line-height; nothing is clipped. Pass ☐ Fail ☐

## PART B — Flutter app (consumption-first native app)

> Note: the Flutter app is scaffolded (5.1) with 5.2–5.6 pending. Test what's present; mark unbuilt screens **N-A / pending**.

**T-07-11 — Builds & runs** on Android emulator and iOS simulator (`flutter run --dart-define=API_URL=http://10.0.2.2:4000`). Pass ☐ Fail ☐
**T-07-12 — Home catalog** loads from the live API; InternshipCards render with price/mode. Pull-to-refresh works. Pass ☐ Fail ☐
**T-07-13 — Login persists across restart** — log in, kill the app, relaunch → still logged in (token restored from secure storage; splash → Learn). Pass ☐ Fail ☐
**T-07-14 — 401 auto-refresh** — let the access token age out (or shorten TTL), trigger a call → app transparently refreshes (watch API log for `/auth/refresh`), no forced re-login. Pass ☐ Fail ☐
**T-07-15 — Bottom navigation** — Home / My Internships / Live / Profile tabs switch correctly. Pass ☐ Fail ☐
**T-07-16 — My Internships** — progress rings reflect API progress. Pass ☐ Fail ☐
**T-07-17 — Logout** — clears secure storage; returns to login. Pass ☐ Fail ☐
**T-07-18 — Consumption-first** — confirm there is **no purchase UI** anywhere; paid programs link out to the web (url_launcher external). Pass ☐ Fail ☐
**T-07-19 — Theme parity** — colors/typography match the design tokens (primary blue, Poppins headings). Pass ☐ Fail ☐

## PART C — Store-readiness review (T5, against docs/store-listing.md)
**T-07-20** — walk the **pre-submission compliance checklist** in `internship-app/docs/store-listing.md`: no purchase button, external browser for paid, account-deletion path, permission timing, reviewer demo account, deep-link `gum://enrolled/{id}`. Note any item not yet satisfiable (pending sessions). Pass ☐ Fail ☐

---

## Checklist
- ☐ Automatic device redirect (phone/tablet → /m, desktop → desktop, shared /login & /verify)
- ☐ Mobile layout feels native (app bar, bottom tabs, sheets, transitions, safe areas, full-screen)
- ☐ Free enrollment in-app; paid → shared web checkout
- ☐ Mobile web auth parity (protected routes, logout, /my→/m/learn when logged in)
- ☐ Flutter builds/runs both platforms; catalog + login-persist + 401-refresh + bottom nav
- ☐ Flutter consumption-first verified; theme parity
- ☐ Store compliance checklist reviewed
