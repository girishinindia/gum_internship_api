# 04 — Learning Delivery, Live Sessions & Media

**Owner:** T1 · **Apps:** Web :3000 (+ Mobile :3200), API :4000
**Pre-req:** Logged in as `student@gum-demo.in`, **actively enrolled** in the Full-Stack internship (id 1) — do T-03-01 first. Videos are dry-run (no real Bunny), so playback returns a signed URL that won't actually stream bytes; you are testing **authorization + progress logic**, not pixels.

> Tip: to make lessons "ready" without Bunny, an admin/instructor can mark seeded video lessons ready, or use the API: lessons 101–105 are video lessons in internship 1.

---

## Flow A — Signed playback authorization

**T-04-01 — Enrolled learner gets a signed URL**
- Steps: open the classroom, play the first lesson (101, a preview).
- Expected: `GET /lessons/101/play?enrollmentId=…` → 200 with `hlsUrl`/`embedUrl` containing `token=` and `expires=`.
- Pass ☐ Fail ☐

**T-04-02 — Non-enrolled user blocked (IDOR/leak check)**
- Steps: as a *different* logged-in user, request play for someone else's enrollment id on a non-preview lesson (102).
- Expected: **403** — no token minted.
- Pass ☐ Fail ☐

**T-04-03 — Sequential unlock**
- Steps: with lessons 101 & 102 ready, try lesson 102 before completing 101.
- Expected: `LESSON_LOCKED`, error details name the blocking lesson (101). After completing 101, 102 unlocks.
- Pass ☐ Fail ☐

**T-04-04 — Token expiry mid-session (re-fetch)**
- Steps: (Flutter/long session) let a playback token age out, continue watching.
- Expected: app transparently re-fetches a fresh signed URL; playback resumes (no hard error).
- Pass ☐ Fail ☐

## Flow B — Progress tracking

**T-04-05 — Mark complete + weighted progress**
- Steps: complete lesson 101, then 102.
- Expected: `progressPercent` increases **weighted by lesson duration** (not a flat per-lesson %). Verify the number changes proportionally to the minutes of the completed lessons.
- Pass ☐ Fail ☐

**T-04-06 — Progress persists**
- Steps: reload classroom / re-open My Internships.
- Expected: progress ring/bar reflects the saved %; resume position respected (Flutter/mobile).
- Pass ☐ Fail ☐

**T-04-07 — Auto-complete at 90% (UI)**
- Steps: (web/Flutter player) watch to ≥90%.
- Expected: lesson auto-marks complete without pressing the button.
- Pass ☐ Fail ☐

## Flow C — Documents & quiz lessons

**T-04-08 — Document lesson** opens/downloads (internship 4 has document lessons). Pass ☐ Fail ☐
**T-04-09 — Quiz lesson** routes into the quiz player (covered fully in doc 05). Pass ☐ Fail ☐

## Flow D — Live sessions (instructor schedules, student joins)

Set-up: as instructor `priya@gum-demo.in`, schedule a session on her batch (id 2). Student must be active in batch 2.

**T-04-10 — Schedule a Zoom session**
- Steps: instructor → batch 2 → schedule (title, start, duration, provider Zoom).
- Expected: created with a join URL + passcode (dry-run fabricates them); appears in the batch session list.
- Pass ☐ Fail ☐

**T-04-11 — Google Meet requires manual link**
- Steps: schedule with provider Meet but no `manualJoinUrl`.
- Expected: `VALIDATION_ERROR` "provide manualJoinUrl"; with a link it succeeds.
- Pass ☐ Fail ☐

**T-04-12 — Join window enforced**
- Steps: as the student, try Join well before start, then within 15-min window.
- Expected: early → `TOO_EARLY`; in-window → returns join URL and records **attendance present** with `joined_at`.
- Pass ☐ Fail ☐

**T-04-13 — Attendance % + manual override**
- Steps: instructor marks attendance (bulk) for a past session.
- Expected: student attendance % reflects present/late over ended sessions; manual override updates it.
- Pass ☐ Fail ☐

**T-04-14 — Recording becomes a lesson**
- Steps: instructor attaches a recording (Bunny video id) to a past session.
- Expected: a new video lesson appears under a "Session Recordings" section; session marked `completed`.
- Pass ☐ Fail ☐

**T-04-15 — Live reminders**
- Steps: schedule a session ~10 minutes out; wait for the 60-second reminder sweep.
- Expected: the API log shows a reminder dispatched (T-1h window); markers prevent duplicate sends.
- Pass ☐ Fail ☐

## Flow E — Media uploads

**T-04-16 — Resume upload (student)** to `/resumes` → stored in private zone; only the owner gets a signed read URL. Pass ☐ Fail ☐
**T-04-17 — Role-gated folder** — student uploading to `/assets` → `FORBIDDEN`. Pass ☐ Fail ☐
**T-04-18 — Size cap** — file > 50 MB → rejected. Pass ☐ Fail ☐
**T-04-19 — Video upload creds (instructor)** — request video-upload for a lesson → returns Bunny TUS endpoint + signature + libraryId; encode webhook (header-secret) marks the lesson `ready`. Pass ☐ Fail ☐

---

## Checklist
- ☐ Playback only for active enrollment / preview; non-enrolled 403
- ☐ Sequential unlock with named blocker
- ☐ Weighted progress accurate + persistent + 90% auto-complete
- ☐ Documents open; quiz lessons route correctly
- ☐ Live: schedule (Zoom + Meet-manual), join window + attendance, recording→lesson, reminders fire once
- ☐ Uploads: private zone, role gates, size cap, video creds + encode webhook
