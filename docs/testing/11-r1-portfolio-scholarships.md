# 11 — R1: Portfolio, Credential Wallet, Resume & Scholarships

Covers the R1 release. **Push notifications (R1-S6) are deferred** until a
Firebase service-account JSON is supplied, so there is nothing to test there yet.

Seed logins (all `Password@123`): `student@gum-demo.in`, `admin@gum-demo.in`.

---

## 11.1 Portfolio editor (student)

| # | Step | Expected |
|---|---|---|
| 1 | Log in as the student → open **My internships** → click **Portfolio & resume** (`/my/portfolio`). | Editor loads; shows lifetime stats (internships / certificates / projects). |
| 2 | Enter a handle (e.g. `arjun-mehta`), a headline, bio, location; set **Visibility = Public**; toggle what to show; add a GitHub link; **Save**. | "Portfolio saved." A public URL chip appears with a **View ↗** link. |
| 3 | Try a handle shorter than 4 chars or with spaces. | Input strips invalid chars; server rejects bad handles with a clear message. |
| 4 | Save a handle that another user already owns. | Error: "That handle is already taken." |

## 11.2 Public credential wallet

| # | Step | Expected |
|---|---|---|
| 1 | Open `/u/<handle>` for a **public** portfolio (incognito / logged out). | Profile renders: name, headline, bio, links, stats, and **only** the sections the owner enabled. |
| 2 | Each certificate row → click **Verify ✓**. | Lands on `/verify/<certificateNo>` and shows a valid certificate. |
| 3 | Owner sets visibility = **Private**, save; reload `/u/<handle>`. | Page returns **404 / Profile not found** (private is never publicly resolvable). |
| 4 | Owner disables **Contact email**; reload public page. | No email shown. Same for certificates / projects toggles. |

## 11.3 Resume PDF

| # | Step | Expected |
|---|---|---|
| 1 | In the editor, click **Download resume PDF**. | A new tab opens a signed (time-limited) URL to an A4 PDF. |
| 2 | Inspect the PDF. | Header (name, track, email), snapshot stats line, **Internship Experience** and **Verified Certificates** sections, GI Internship footer. Empty sections read "None … yet". |
| 3 | Wait past the signed-URL TTL, reopen the old link. | Access denied (signature expired) — confirms private signing works. |

## 11.4 Scholarships (admin → student)

| # | Step | Expected |
|---|---|---|
| 1 | As admin/finance: `POST /admin/scholarships` with `{ userId, discountType:"percent", discountValue:50, eligibilityNote }`. | 201; returns a coupon with `kind:"scholarship"`, `assigned_user_id` = that student, and a `SCH-…` code. Student receives an email with the code. |
| 2 | As **that student**, validate the code at checkout (`POST /coupons/validate`) on a paid internship. | `valid:true`; discount applied. |
| 3 | As **a different user**, validate the same code. | `valid:false`, reason: "This scholarship is not assigned to your account." |
| 4 | Redeem the scholarship once, then try to reuse it. | Second attempt rejected (per-user limit = 1). |
| 5 | `discountValue > 100` with `percent`. | Rejected with a validation error. |

---

### API reference (R1)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/users/me/portfolio` | student | own portfolio + aggregated achievements |
| PUT | `/users/me/portfolio` | student | create/update portfolio (handle, visibility, toggles, links) |
| GET | `/users/me/resume` | student | signed URL to the generated resume PDF |
| GET | `/p/:handle` | public | privacy-aware credential wallet |
| POST | `/admin/scholarships` | moderator / finance_admin | issue a single-student scholarship coupon |

**DPDP note:** portfolios default to **private**; nothing is public until the
learner opts in, and per-section toggles plus contact-email visibility give
granular control.
