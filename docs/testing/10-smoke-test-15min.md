# 10 — Smoke Test: Happy Path in 15 Minutes

A fast first pass to decide **"is this build worth deep-testing?"** If any **STOP** step fails, halt and report — the build is not ready for the full suite (docs 01–08).

**Pre-req:** API :4000, Web :3000, Admin :3100 running with seed data (doc 00 §3). Dry-run on (OTP echoed, payments fake). Have two browser profiles/incognito windows ready (student + admin).

> Time budget in brackets. Tick as you go. Total ≈ 15 min.

---

## A. Health & catalog (2 min)
1. ☐ `GET http://localhost:4000/health` → `{"success":true,...}`. **[STOP if fail]**
2. ☐ Open `http://localhost:3000/` → home renders, "Popular now" shows seeded internships.
3. ☐ `/internships?category=flutter&pricingType=paid` → only the Flutter internship; URL keeps the params.
4. ☐ Open the Flutter internship detail → curriculum, batches with seats, price **incl. GST** visible; **no locked-video URL** in page source. **[STOP if video URL leaks]**

## B. Auth (3 min)
5. ☐ Sign up `smoke@demo.in` / phone `9879990001` / `Password1` → status "verify"; grab the email OTP from the API log (`[DRY RUN] OTP email … code:`).
6. ☐ Verify the email OTP → account active.
7. ☐ Log in → land on My Internships.
8. ☐ Log out → visiting `/my` redirects to `/login?next=/my`. **[STOP if a logged-out user can see /my]**

## C. Free enrollment → learning (2 min)
9. ☐ Log back in; open the **Full-Stack (FREE)** internship → Enroll → pick batch → confirms `active`.
10. ☐ My Internships shows it with a progress ring; an **offer letter** appears within a few seconds.
11. ☐ Open the first lesson (preview) → playback returns a signed URL (`token=`); a locked later lesson shows 🔒 / "complete previous first".

## D. Paid checkout + webhook (3 min)
12. ☐ Open the **Flutter (₹4,999)** internship → start checkout, apply `FLUTTER500`, billing state **Maharashtra** → order total = **₹5,308.82** (IGST ₹809.82). **[STOP if the math is off by any paisa]**
13. ☐ Simulate capture: `cd internship-api && ./scripts/test-webhook.sh <razorpayOrderId> 530882`
    - First delivery → `processed`; **second (duplicate) → `duplicate-ignored`**; bad-signature → `401`. **[STOP if duplicate double-processes]**
14. ☐ Order → `paid`; enrollment → `active`; **GST invoice `INV/2026-27/NNNN`** generated; one instructor earning **₹3,074.97**.

## E. Admin + certificate + verify (3 min)
15. ☐ Admin window: log in `admin@gum-demo.in` at `:3100` → dashboard stats load; a **student login is rejected** at :3100. **[STOP if a student can enter admin]**
16. ☐ KYC queue (after a submitted application) → Approve → applicant gains instructor role; audit row written.
17. ☐ Make an enrollment meet its certificate rules (or use a seeded-complete one) → claim certificate → `GUMI-2026-NNNNNN`, grade shown, PDF generated.
18. ☐ Open `http://localhost:3000/verify/GUMI-2026-NNNNNN` → **valid**, shows only name/internship/grade/date (no email/id). Tamper the DB name → verify shows **"Integrity check failed"**. **[STOP if tampered cert still verifies]**

## F. Mobile auto-redirect (1 min)
19. ☐ Devtools → device mode (iPhone) → open `http://localhost:3000/` → **auto-redirects to `/m`** with the mobile app shell (app bar + bottom tabs). Desktop UA on `/m` → back to `/`.
20. ☐ Mobile FREE internship → "Enroll free" bottom sheet works; mobile PAID → "Proceed to secure checkout" (no separate site, no in-app-payment dead end).

---

## Verdict
- **All ticked, no STOP hit** → green light: proceed to the full suite (01–08), assign testers (doc 00 §2).
- **Any STOP failed** → red: file an S1 with the bug template (doc 00 §6) and block the cycle.

| Result | ☐ GO (full suite) | ☐ NO-GO (blocker) |
|---|---|---|
| Smoke run by | __________ | Date / build: __________ |

> Want the wider net but still fast? After this passes, run the automated suites: `cd internship-api && npm run test:unit && DATABASE_URL_TEST=… npm run test:int` (18 integration cases, ~3s).
