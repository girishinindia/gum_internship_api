# 01 — Auth & Onboarding

**Owner:** T1 (student), T2 (commerce shares login) · **Apps:** Web :3000, Mobile :3200, API :4000
**Pre-req:** Environment up (doc 00 §3). OTP codes appear in dev — for the web UI, read the API server log line `[DRY RUN] OTP email … code: NNNNNN`, or call the endpoint directly (steps note where).

> Reminder: dev OTP echo. `POST /v1/auth/register` and `/auth/otp/request` return `meta.dev.otp` in non-prod. Use it.

---

## Flow A — Signup with dual OTP (email + phone)

**T-01-01 — Register a new student**
- Steps: Web → Get started → fill Full name `Test One`, email `test1@demo.in`, phone `9870000001`, password `Password1`, submit.
- Expected: 201; screen advances to "verify". API returns `data.userId`, `verificationRequired:true`, and `meta.dev.otp.email` + `.phone`. Account status = `pending_verification`.
- Pass ☐ Fail ☐

**T-01-02 — Login blocked before verification**
- Steps: Try to log in as `test1@demo.in` / `Password1` before verifying.
- Expected: 403, friendly message "Verify your email or phone first". Code `VERIFICATION_PENDING`.
- Pass ☐ Fail ☐

**T-01-03 — Verify email OTP**
- Steps: Enter the emailed 6-digit code on the verify step.
- Expected: success "Your email is verified"; account becomes `active` (first verified channel activates it).
- Pass ☐ Fail ☐

**T-01-04 — Wrong OTP rejected, attempts capped**
- Steps: Request a phone OTP; enter a wrong code 5 times.
- Expected: each wrong attempt → `OTP_INVALID`; after 5 → `OTP_ATTEMPTS_EXHAUSTED` (must request a new code).
- Pass ☐ Fail ☐

**T-01-05 — Resend cooldown + hourly cap**
- Steps: Request OTP, immediately request again (<60s); then request >3 times in an hour.
- Expected: within 60s → `RATE_LIMITED` (cooldown); 4th in an hour → `RATE_LIMITED` (hourly cap).
- Pass ☐ Fail ☐

## Flow B — Login / session

**T-01-06 — Login by email**, **T-01-07 — Login by phone** (`9870000001`)
- Expected: both succeed; land on My Internships (web) / Learn (mobile). Session cookie set (httpOnly — not visible to `document.cookie`).
- Pass ☐ Fail ☐

**T-01-08 — Wrong password**
- Expected: `INVALID_CREDENTIALS`, friendly copy; no lockout leak.
- Pass ☐ Fail ☐

**T-01-09 — Session persists across reload + auto-refresh**
- Steps: Log in, reload after a few minutes of activity.
- Expected: still logged in; no visible re-login. (Behind the scenes the access token refreshes on 401.)
- Pass ☐ Fail ☐

**T-01-10 — Logout**
- Expected: returns to public home; visiting `/my` (web) or `/m/learn` (mobile) redirects to login with `?next=`.
- Pass ☐ Fail ☐

## Flow C — Password reset

**T-01-11 — Forgot → reset → login with new password**
- Steps: Forgot password for `test1@demo.in`; use the emailed code at the reset screen; set `Password2`; log in.
- Expected: reset succeeds; new password works; **old password fails**; all prior sessions revoked.
- Pass ☐ Fail ☐

**T-01-12 — Change password (authenticated)**
- Expected: requires current password; on success other devices are logged out.
- Pass ☐ Fail ☐

## Flow D — Instructor application (KYC)

**T-01-13 — Apply as instructor**
- Steps: As a logged-in student → instructor application form → bio (≥30 chars), expertise, PAN `ABCDE1234F`, bank name/number/IFSC `HDFC0001234`.
- Expected: 201, status `submitted`; response shows bank masked as `••••<last4>` — **full account number never returned**.
- Pass ☐ Fail ☐

**T-01-14 — Re-apply blocked while pending**
- Expected: second submit while `submitted`/`approved` → `CONFLICT`. (Re-apply allowed only after rejection.)
- Pass ☐ Fail ☐

## Negative / edge

**T-01-15** weak password (`abc`) at signup → `VALIDATION_ERROR`, inline message. Pass ☐ Fail ☐
**T-01-16** duplicate email signup → `CONFLICT` "Email already registered". Pass ☐ Fail ☐
**T-01-17** duplicate phone signup → `CONFLICT`. Pass ☐ Fail ☐
**T-01-18** malformed phone (`12345`) → validation error. Pass ☐ Fail ☐

---

## Checklist (tick when its cases all pass)
- ☐ Signup + dual OTP verification
- ☐ Login (email & phone), session persistence, logout
- ☐ OTP wrong/expired/rate-limit behaviours
- ☐ Forgot/reset/change password incl. session revocation
- ☐ Instructor application with masked bank, re-apply rules
- ☐ All negative cases return friendly mapped messages (never a raw stack trace)
