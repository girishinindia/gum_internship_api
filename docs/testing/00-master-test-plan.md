# 00 — Master Test Plan & Setup (READ FIRST)

**Project:** GUM Internships · **Build under test:** Phase 0–6 + mobile web portal
**Audience:** 5 testers · **Owner:** Girish

This is the entry point. Every other document (01–08) assumes you have completed §3 (Environment) and uses the shared sample data in §4 and the bug template in §6.

---

## 1. What you are testing

| # | App | URL (local) | Who tests it |
|---|---|---|---|
| API | Express backend | http://localhost:4000 | all (indirectly) |
| Web | Student/instructor site (Next.js) — **desktop AND mobile layouts in one app**, auto-selected by device | http://localhost:3000 | T1, T2, T5 |
| Admin | Operations portal (Next.js) | http://localhost:3100 | T3, T4 |
| Flutter app | Android/iOS | emulator/device | T5 |

> **No separate mobile site.** The web app at :3000 detects the device: phones & tablets are automatically redirected to the mobile-native layout under `/m/*`; desktops get the desktop layout. To test the mobile layout, open :3000 with a phone/tablet user-agent (devtools device mode, or a real device).

## 2. Tester assignments

| Tester | Primary area | Documents |
|---|---|---|
| **T1 — Student journeys** | Signup, catalog, free enrollment, learning, mobile | 01, 02, 04, 07 |
| **T2 — Commerce** | Paid checkout, coupons, invoices, refunds | 01, 03 |
| **T3 — Instructor + content** | Instructor portal, projects, quizzes, reviews, certificates | 05, 06 (instructor) |
| **T4 — Admin + finance** | KYC, moderation, users, refunds, settlements, dashboard | 06 (admin/finance) |
| **T5 — Cross-cutting + mobile** | Security, accessibility, performance, mobile web + Flutter | 07, 08 |

Each tester owns their docs end-to-end but logs bugs against any app they touch.

## 3. Environment setup (do this once)

### 3.1 Prerequisites
Node 20+, a local PostgreSQL 15+ (or Supabase project), Flutter (T5 only).

### 3.2 Database + API
The real `.env` (Grow Up More credentials) is already placed in `internship-api/.env` (git-ignored). It points at the **live Supabase project**, schema **`intern`** (already created + migrated + seeded), live Bunny, Brevo, SMS Gateway Hub, and **LIVE Razorpay**. API runs on **port 8001**.

```bash
cd internship-api
npm install
# .env is already in place (do NOT commit it). To (re)load the intern schema on Supabase:
#   the 7 migrations were applied into schema `intern` with search_path=intern,extensions,public;
#   the updated_at trigger DO-block was switched from public→intern.
npm run dev                          # → :8001 ; GET /health → {"success":true,...}
```
Web/Admin already have `.env.local` with `API_URL=http://localhost:8001`.

**Provider behaviour flags (in .env / overridable):**
- `NOTIFY_DRY_RUN` master off. `EMAIL_DRY_RUN=false` → **real Brevo emails send** (branded "GI Internship" templates). `SMS_DRY_RUN=true` (safe) → SMS only dispatches when you set `SMS_FORCE_SEND=true` with a real test number (DLT-approved templates only).
- `STORAGE_DRY_RUN=false` → files go to the **real Bunny zone** `growupmore-internship`; Stream library `682477`.
- ⚠️ **`PAYMENTS_DRY_RUN=false` → LIVE Razorpay.** Creating an order is free, but **capturing charges real money.** Use a tiny amount / test card or flip `PAYMENTS_DRY_RUN=true` for full-flow rehearsal.
- To rehearse the full auth flow without spending email credits, set `NOTIFY_DRY_RUN=true` → OTP codes echo in `meta.dev.otp`.

**Connectivity verified (read-only) on setup:** Supabase intern schema (38 tables, 36 triggers, seed exact) · Bunny Storage PUT/GET/DELETE · Bunny Stream library reachable · Brevo real email delivered to the admin address · live auth→catalog→enroll chain on the real DB.

### 3.3 Web apps
```bash
cd internship-web   && npm install && cp .env.local.example .env.local && npm run dev   # :3000 (desktop + mobile in one app)
cd internship-admin && npm install && cp .env.local.example .env.local && npm run dev   # :3100
```
Both default `API_URL=http://localhost:4000`. The mobile layout is the same :3000 app viewed from a phone/tablet UA — no separate server.

### 3.4 Flutter (T5)
```bash
cd internship-app
flutter create . --platforms=android,ios
flutter pub get
flutter run --dart-define=FLAVOR=dev --dart-define=API_URL=http://10.0.2.2:4000   # Android emulator
```

### 3.5 Reset between test runs
To return to a clean state, re-run the migrations (0001 drops nothing, so for a full reset: `drop schema public cascade; create schema public;` then re-run all seven files). Note seeded ids are deterministic, so a reset restores the exact sample data below.

## 4. Shared sample data (seeded)

### 4.1 Logins (password `Password@123` for seeded staff; test-created accounts use `Password1`)
| Role | Email | Notes |
|---|---|---|
| super_admin | admin@gum-demo.in | sees everything in admin portal |
| internal instructor | ananya@gum-demo.in | owns internships 1 & 4 |
| internal instructor | rahul@gum-demo.in | owns internship 3 |
| external instructor | priya@gum-demo.in | owns internship 2, 70% revenue share |
| student | student@gum-demo.in | "Arjun Mehta" |

### 4.2 Internships
| id | slug | title | price | mode | batch id |
|---|---|---|---|---|---|
| 1 | full-stack-web-development-internship | Full-Stack Web Development | FREE | recorded | 1 |
| 2 | flutter-app-development-internship | Flutter App Development | ₹4,999 | live | 2 (waitlist on) |
| 3 | data-science-with-python-internship | Data Science with Python | ₹7,999 | hybrid | 3 |
| 4 | digital-marketing-portfolio-internship | Digital Marketing Portfolio | FREE | project_only | 4 |

### 4.3 Coupons
| code | effect | scope |
|---|---|---|
| WELCOME10 | 10% off (cap ₹500) | any paid |
| FLUTTER500 | flat ₹500 off | internship 2 only |
| EARLYBIRD25 | 25% off (cap ₹1500) | internship 3 only |

### 4.4 Expected money math (verify these exactly)
- Internship 2 + FLUTTER500, billing **Maharashtra** (inter-state): subtotal ₹4,999 − ₹500 = ₹4,499 taxable → **IGST ₹809.82** → **total ₹5,308.82**.
- Internship 2 + FLUTTER500, billing **Gujarat** (intra-state, = home state): same total, but split **CGST ₹404.91 + SGST ₹404.91**.
- Internship 3 + EARLYBIRD25, Gujarat: ₹7,999 − ₹1,500 = ₹6,499 → CGST+SGST ₹584.91 each → **total ₹7,668.82**.
- External-instructor earning on a ₹5,308.82 capture: 70% of (₹4,499 − 2% gateway fee on total) = **₹3,074.97**.

## 5. How to read the test docs

Each test case has: **ID** (e.g. T-01-03), **Pre-conditions**, **Steps**, **Expected result**, **Pass/Fail** box. Run them top to bottom — later cases often depend on earlier state. Mark severity on any failure using §6.

## 6. Bug report template (copy per bug into your tracker)

```
BUG-ID:           [area]-[number]   e.g. AUTH-004
Title:            one line
Severity:         S1 blocker / S2 major / S3 minor / S4 cosmetic
App + version:    web @ commit / build
Environment:      local | staging
Tester:           T_
Pre-conditions:   logged in as …, data state …
Steps to reproduce:
  1.
  2.
Expected:
Actual:
Evidence:         screenshot / API response / request-id (x-request-id header)
Notes:
```

**Severity guide:** S1 = data loss, money wrong, security hole, app unusable. S2 = core flow broken with no workaround. S3 = flow works but wrong behaviour/copy. S4 = visual only.

## 7. Definition of Done (exit criteria)
- All S1/S2 closed; S3 triaged.
- Every doc's checklist 100% executed (pass or logged).
- Money math (§4.4) verified to the paisa.
- Consumption-first confirmed: no in-app payment on mobile web or Flutter (doc 07).
- Security spot-checks (doc 08) pass.
