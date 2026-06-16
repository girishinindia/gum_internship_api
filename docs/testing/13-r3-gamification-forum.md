# 13 — R3: Gamification, Forum & Portable Credentials

Covers the R3 engagement release. **WhatsApp (R3-S4)** and **Open Badges baking
(part of R3-S5)** are deferred pending credentials; the **LinkedIn "Add to
Profile"** link (S5-lite) ships now.

Seed logins (all `Password@123`): `student@gum-demo.in` (Arjun),
`priya@gum-demo.in` (instructor), `admin@gum-demo.in`.

---

## 13.1 XP, badges & streaks (event-driven)

XP is awarded automatically by the event bus — there is no "give me XP" call.

| # | Action that fires it | Award | Badge |
|---|---|---|---|
| 1 | Complete a lesson (`POST /lessons/:id/progress {completed:true}`) | +10 XP, streak touched | `first_steps` |
| 2 | Mentor approves a project task (`review.completed`) | +25 XP | `task_master` |
| 3 | Earn a certificate (`certificate.issued`) | +100 XP | `graduate` |
| 4 | Post a forum reply | +15 XP, streak touched | `helper` (after 5 replies) |
| 5 | 7- / 30-day learning streak | — | `streak_7` / `streak_30` |

| # | Step | Expected |
|---|---|---|
| 1 | `GET /me/xp`. | `{ xp, level, xpIntoLevel, rank, currentStreak, longestStreak, badges[], recent[] }`. Level = `floor(xp/100)+1`. |
| 2 | `GET /me/badges`. | `{ earned[], all[] }` — earned vs the full 6-badge catalogue. |
| 3 | Do the same XP action twice (e.g. re-complete the same lesson). | XP awarded **once** — `xp_events` is idempotent per `(user, source_key)`. |
| 4 | Be active today, then again tomorrow. | `currentStreak` increments; a gap resets it to 1. Same-day activity doesn't double-count. |
| 5 | `GET /leaderboard?limit=20`. | Users ranked by total XP with `rank`, name, avatar. |

## 13.2 Doubt forum

| # | Step | Expected |
|---|---|---|
| 1 | Enrolled student: `POST /forum/threads { internshipId, title, body }`. | 201; thread created. Non-enrolled non-staff → 403. |
| 2 | `GET /forum/threads?internshipId=N`. | Paginated list, **pinned first**, then most-recent reply. Deleted threads hidden. |
| 3 | `POST /forum/threads/:id/replies { body }` as **instructor**. | Reply has `isInstructor:true` (badge in UI). Poster earns +15 XP. |
| 4 | Thread owner (or staff): `POST /forum/threads/:id/replies/:replyId/accept`. | Reply marked accepted; thread `isResolved:true`. |
| 5 | `GET /forum/threads/:id`. | Thread + replies; accepted reply sorts first. |

## 13.3 Moderation (staff)

| # | Step | Expected |
|---|---|---|
| 1 | `PATCH /admin/forum/threads/:id { isPinned:true, isLocked:true }`. | Thread pinned + locked. |
| 2 | Student replies to a **locked** thread. | 409 — "This thread is locked." (staff can still reply.) |
| 3 | `PATCH /admin/forum/threads/:id { isDeleted:true }`. | Thread disappears from listings. |
| 4 | `DELETE /admin/forum/replies/:replyId`. | Reply soft-deleted (hidden, row retained). |

## 13.4 LinkedIn "Add to Profile" (S5-lite)

| # | Step | Expected |
|---|---|---|
| 1 | `GET /certificates/me`. | Each issued certificate includes `linkedinAddUrl`. |
| 2 | Open the URL. | LinkedIn's "Add licenses & certifications" opens pre-filled with the name, organisation (GI Internship), issue month/year, certificate id, and the public verify URL. No login/app integration required. |

---

### API reference (R3)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/me/xp` | any user | XP, level, rank, streak, badges, recent activity |
| GET | `/me/badges` | any user | earned vs full badge catalogue |
| GET | `/leaderboard` | any user | top users by XP |
| GET/POST | `/forum/threads` | enrolled / staff | list / create threads |
| GET | `/forum/threads/:id` | any user | thread + replies |
| POST | `/forum/threads/:id/replies` | enrolled / staff | reply (locked → 409) |
| POST | `/forum/threads/:id/replies/:replyId/accept` | asker / staff | accept an answer |
| PATCH | `/admin/forum/threads/:id` | staff | pin / lock / delete |
| DELETE | `/admin/forum/replies/:replyId` | staff | soft-delete a reply |

**Deferred:** WhatsApp notifications (needs WABA, R0-S7) and Open Badges baking
(needs an issuer key, R0-S8).
