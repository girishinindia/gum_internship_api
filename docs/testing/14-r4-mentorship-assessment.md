# 14 — R4: Mentorship Booking & Skill Assessment

Covers the R4 release. Uses Zoom (dry-run unless `LIVE_DRY_RUN=false`) and
Razorpay (dry-run unless `PAYMENTS_DRY_RUN=false`). No new credentials required.

Seed logins (all `Password@123`): `student@gum-demo.in`, `priya@gum-demo.in`
(instructor / mentor), `admin@gum-demo.in`.

---

## 14.1 Mentor publishes slots

| # | Step | Expected |
|---|---|---|
| 1 | As instructor: `POST /mentorship/slots { startsAt, durationMinutes, price, topic }` with `price:0`. | 201; a free/included slot, status `open`. Past `startsAt` → 400. |
| 2 | Create another with `price:500`. | 201; a paid slot. |
| 3 | `GET /mentorship/slots/mine`. | Lists the mentor's slots with booking info once booked. |
| 4 | `DELETE /mentorship/slots/:id` on an open slot. | Cancelled; booked slots can't be cancelled this way. |

## 14.2 Student books

| # | Step | Expected |
|---|---|---|
| 1 | `GET /mentorship/slots`. | Open, future slots across mentors (mentor name + expertise + price). |
| 2 | `POST /mentorship/bookings { slotId, note }` on a **free** slot. | 201 `status:"confirmed"` with a `joinUrl` (Zoom meeting created). Slot flips to `booked`. |
| 3 | Book a **paid** slot. | 201 `status:"pending_payment"` + `payment{ razorpayOrderId, amount, currency, keyId }`. No meeting yet. |
| 4 | `POST /mentorship/bookings/:id/confirm` with a **wrong** signature. | 401 — signature verification failed. |
| 5 | Confirm with a valid Checkout signature (in `PAYMENTS_DRY_RUN`, `signature:"dev_ok"`). | `status:"confirmed"` + `joinUrl`. |
| 6 | Try to book an already-booked slot. | 409 — "just booked by someone else" (race-safe slot claim). |
| 7 | `GET /mentorship/bookings/mine`. | The learner's bookings with status + join URL + mentor/slot details. |
| 8 | `DELETE /mentorship/bookings/:id`. | Booking cancelled; the slot returns to `open` for rebooking. |

## 14.3 Skill assessment / readiness

| # | Step | Expected |
|---|---|---|
| 1 | `GET /assessment/tracks`. | `["data","flutter","marketing","web"]`. |
| 2 | `GET /assessment/web`. | 4 questions with options — **no `correct_index`** in the payload. |
| 3 | `POST /assessment/submit { track:"web", answers:[{questionId, selectedIndex}…] }` (all correct). | `score:100`, `readiness:"ready"`, `recommendations[]` (matching internships, e.g. Full-Stack Web Dev). |
| 4 | Submit weak answers. | Low score, `readiness:"foundational"` with a beginner-internship nudge. Bands: ≥80 ready, ≥50 developing, else foundational. |
| 5 | `GET /assessment/me/attempts`. | Past attempts with scores + recommendations. |

---

### API reference (R4)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/mentorship/slots` | instructor | publish a bookable slot |
| GET | `/mentorship/slots/mine` | instructor | mentor's slots |
| DELETE | `/mentorship/slots/:slotId` | instructor | cancel an open slot |
| GET | `/mentorship/slots` | any user | open future slots |
| POST | `/mentorship/bookings` | student | book (free→confirm, paid→order) |
| POST | `/mentorship/bookings/:id/confirm` | owner | confirm paid booking (signed) |
| DELETE | `/mentorship/bookings/:id` | owner | cancel + free the slot |
| GET | `/mentorship/bookings/mine` | student | my bookings |
| GET | `/assessment/tracks` | any user | available diagnostic tracks |
| GET | `/assessment/:track` | any user | diagnostic questions (no answers) |
| POST | `/assessment/submit` | any user | score + readiness + recommendations |
| GET | `/assessment/me/attempts` | any user | past diagnostic attempts |

**Payments note:** mentor sessions use a parallel Razorpay order + Checkout
signature verify (the internship `orders` table is purchase-specific). Set
`PAYMENTS_DRY_RUN=false` + `LIVE_DRY_RUN=false` for real payments and Zoom links.
