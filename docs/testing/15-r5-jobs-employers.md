# 15 — R5: Job Board, Employer Portal & Applications

Covers the R5 career-outcomes release. **Stipend payouts (R5-S5)** are deferred
pending RazorpayX (R0-S5). No new credentials required for the rest.

Seed logins (all `Password@123`): `student@gum-demo.in`, `admin@gum-demo.in`.
Any user can register as an employer (e.g. `priya@gum-demo.in`).

> Employer-only endpoints gate on the **employer profile**, not the JWT role, so
> a freshly registered employer works immediately (no re-login needed). The
> `employer` role is also granted for visibility and activates on next refresh.

---

## 15.1 Employer onboarding

| # | Step | Expected |
|---|---|---|
| 1 | `POST /employers/register { companyName, website, contactEmail, gstin }`. | 201; profile created, `kycStatus:"pending"`. Second call → 409 (one per user). |
| 2 | `GET /employers/me`. | The employer profile. |
| 3 | `PATCH /employers/me { about, logoUrl, … }`. | Profile updated. |
| 4 | `POST /employers/me/submit`. | Agreement accepted + `kycStatus:"submitted"`. |

## 15.2 Posting jobs (verification-gated publish)

| # | Step | Expected |
|---|---|---|
| 1 | `POST /jobs { title, description, workMode, employmentType, stipendMin/Max, skills[] }`. | 201; job `status:"draft"`. |
| 2 | `POST /jobs/:id/submit` while employer is **not yet verified**. | 409 — must be verified first. |
| 3 | Admin: `GET /admin/employers?kycStatus=submitted`, then `POST /admin/employers/:id/verify { decision:"verified" }`. | Employer verified. |
| 4 | `POST /jobs/:id/submit` again. | `status:"pending_review"`. |
| 5 | Admin: `POST /admin/jobs/:id/decision { decision:"published" }`. | Job published (`published_at` set). Rejecting requires a `reason` and sets `rejected`. |
| 6 | `GET /employer/jobs`. | Mentor's jobs with live applicant counts. `PATCH /jobs/:id` allowed only on draft/rejected. |

## 15.3 Public board + applying

| # | Step | Expected |
|---|---|---|
| 1 | `GET /jobs?q=&workMode=` (any logged-in user). | Only **published** jobs; paginated; filter by keyword / work mode. |
| 2 | `GET /jobs/:id`. | Full job + company profile. Non-published → 404. |
| 3 | `POST /jobs/:id/apply { coverNote }`. | 201 `status:"applied"`; the learner's **portfolio handle + resume URL are auto-attached** from their profile. |
| 4 | Apply again to the same job. | 409 — already applied. |
| 5 | Apply to your own company's job. | 400 — can't apply to your own posting. |
| 6 | `GET /me/applications`. | The learner's applications with current status. |
| 7 | `POST /me/applications/:id/withdraw`. | Status → `withdrawn`. |

## 15.4 Employer applicant pipeline

| # | Step | Expected |
|---|---|---|
| 1 | `GET /employer/jobs/:id/applicants`. | Applicants with name, email, portfolio handle, resume URL, cover note. |
| 2 | `PATCH /employer/applications/:appId { status:"shortlisted" }`. | Status updated (also `interview` / `offered` / `rejected`). |
| 3 | The applicant re-checks `GET /me/applications`. | Sees the new status (e.g. `shortlisted`). |

---

### API reference (R5)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/employers/register` | any user | become an employer |
| GET/PATCH | `/employers/me` | employer | view / edit profile |
| POST | `/employers/me/submit` | employer | accept agreement + submit KYC |
| POST | `/jobs` | employer | create a draft job |
| PATCH | `/jobs/:id` | employer | edit draft/rejected job |
| POST | `/jobs/:id/submit` | verified employer | submit for review |
| POST | `/jobs/:id/close` | employer | close a job |
| GET | `/employer/jobs` | employer | my jobs + applicant counts |
| GET | `/employer/jobs/:id/applicants` | employer | applicant list |
| PATCH | `/employer/applications/:appId` | employer | move applicant in pipeline |
| GET | `/jobs` · `/jobs/:id` | any user | public board / detail |
| POST | `/jobs/:id/apply` | any user | apply with portfolio |
| GET | `/me/applications` | applicant | my applications |
| POST | `/me/applications/:appId/withdraw` | applicant | withdraw |
| GET | `/admin/employers` | staff | employer verification queue |
| POST | `/admin/employers/:id/verify` | staff | verify / reject employer |
| POST | `/admin/jobs/:id/decision` | staff | publish / reject a job |

**Deferred:** stipend-paid internships / student payouts (TDS + RazorpayX,
needs R0-S5).
