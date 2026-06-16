# 05 — Projects, Quizzes & Certificates

**Owner:** T3 (instructor side) + T1 (student side) · **Apps:** Web :3000, API :4000
**Pre-req:** A student actively enrolled in internship 2 (Flutter, Priya's). Instructor login `priya@gum-demo.in`. The seeded project has 4 weekly tasks (ids 21–24) with rubrics.

> Rubric shape (stored on each task): `[{ "criterion":"Navigation works","weight":0.4,"maxPoints":40 }, …]`. Reviews must score the SAME criterion names, each `0…maxPoints`.

---

## Flow A — Project task timeline & submission (student)

**T-05-01 — Task timeline with deadlines**
- Steps: open the project workspace for the enrollment.
- Expected: 4 weekly tasks; each shows a deadline computed from **batch start + due-offset** (week 1 = start + 7 days), status chips, "resubmits left: 2".
- Pass ☐ Fail ☐

**T-05-02 — Submit (type-aware)**
- Steps: task 21 (accepts `github_url` only) → submit a GitHub URL.
- Expected: 201, version 1, status `submitted`. Submitting a `live_url` to this task → `VALIDATION_ERROR` (type not allowed).
- Pass ☐ Fail ☐

**T-05-03 — File submission with upload** (a task allowing `file`): file picker → upload to media → submit; version recorded; file in private zone. Pass ☐ Fail ☐

**T-05-04 — Double-submit blocked while pending**
- Steps: submit again before review.
- Expected: `SUBMISSION_PENDING_REVIEW`.
- Pass ☐ Fail ☐

**T-05-05 — Late flag**
- Steps: (set a past deadline, or a task whose offset puts it before today) submit.
- Expected: submission carries `isLate:true`; UI shows a "late" chip.
- Pass ☐ Fail ☐

## Flow B — Mentor review (instructor)

**T-05-06 — Review queue (oldest first)**
- Steps: instructor → review queue (filter by internship 2).
- Expected: the pending submission appears with the task rubric and student name.
- Pass ☐ Fail ☐

**T-05-07 — Rubric validation**
- Steps: submit a review scoring an unknown criterion, or points above maxPoints.
- Expected: `VALIDATION_ERROR`; must score every criterion within range.
- Pass ☐ Fail ☐

**T-05-08 — Request resubmit (+3 days)**
- Steps: decision `resubmit` with feedback.
- Expected: total score computed; task reopens with a new deadline = today + 3 days; student notified (in-app feed).
- Pass ☐ Fail ☐

**T-05-09 — Resubmit → approve → weighted score**
- Steps: student submits v2; instructor approves with rubric scores summing to e.g. 93/100.
- Expected: `totalScore` correct; enrollment `project_score` updates as the **weighted** average across mandatory tasks (verify the math if multiple tasks approved).
- Pass ☐ Fail ☐

**T-05-10 — Max resubmits**
- Steps: attempt a 3rd resubmission after 2 resubmits.
- Expected: `MAX_RESUBMITS` (versions cap at 1 + 2). Submitting after approval → `CONFLICT` "already approved".
- Pass ☐ Fail ☐

**T-05-11 — Events → notifications**
- Expected: `submission.received` and `review.completed` produce in-app notifications for the right users.
- Pass ☐ Fail ☐

## Flow C — Quizzes (student)

**T-05-12 — Start attempt**
- Steps: open the Flutter Essentials quiz (id 2), start.
- Expected: questions returned **without correct answers**; `attemptsUsed`, `expiresAt` (if timed) shown; one question/screen on mobile, list on desktop.
- Pass ☐ Fail ☐

**T-05-13 — Autosave + submit + server scoring**
- Steps: answer all 5, submit.
- Expected: server-side score; multi-choice scored as **exact set match**; all-correct → 100%, passed. Result screen shows per-question correctness + explanations, attempts left.
- Pass ☐ Fail ☐

**T-05-14 — Attempts exhausted**
- Steps: use all `maxAttempts`, then start again.
- Expected: `ATTEMPTS_EXHAUSTED`.
- Pass ☐ Fail ☐

**T-05-15 — Timed expiry**
- Steps: (a short-time quiz) let it run past the limit.
- Expected: attempt auto-expires; late answer save → `410`/expired.
- Pass ☐ Fail ☐

## Flow D — Certificates

Set-up: make an enrollment satisfy its `certificate_rules` (progress %, quiz %, attendance %, all mandatory tasks approved, as applicable).

**T-05-16 — Eligibility shows each failing rule**
- Steps: check eligibility before meeting rules.
- Expected: `eligible:false` with a per-rule `checks[]` list (which passed/failed) — **owner or staff only** (a stranger gets 404).
- Pass ☐ Fail ☐

**T-05-17 — Claim blocked when ineligible** → `NOT_ELIGIBLE` with failed checks. Pass ☐ Fail ☐

**T-05-18 — Claim when eligible → issue**
- Expected: 201; certificate no `GUMI-2026-NNNNNN`; grade A/B/C from score band (A≥85, B≥70, C else); enrollment → `completed`; PDF (A4 landscape + QR) generated in `var/storage/private/certificates/`.
- Pass ☐ Fail ☐

**T-05-19 — Public verify**
- Steps: open `/verify/GUMI-2026-NNNNNN` (web) — no login.
- Expected: shows valid, learner name, internship, duration, grade, issue date — and **nothing else** (no email/phone/id). Exactly 7 fields.
- Pass ☐ Fail ☐

**T-05-20 — Tamper detection (CRITICAL)**
- Steps: (DB) change the learner name in the certificate metadata; verify again.
- Expected: `valid:false`, reason "Integrity check failed" (HMAC mismatch). Restore → valid again.
- Pass ☐ Fail ☐

**T-05-21 — Revoke** (admin/moderator) → verify shows revoked + date; audit row written. Pass ☐ Fail ☐

**T-05-22 — Idempotent claim** — claiming twice returns the same certificate (`alreadyIssued`), never a duplicate. Pass ☐ Fail ☐

---

## Checklist
- ☐ Task timeline, type-aware submit, late flag, double-submit guard
- ☐ Review: rubric validation, resubmit (+3d), approve, weighted score, max-resubmits
- ☐ Quiz: start (no answers leaked), server scoring incl. exact multi-set, attempts + expiry
- ☐ Certificate: eligibility per-rule, claim gate, issue + grade + PDF/QR
- ☐ Public verify minimal-fields + **HMAC tamper detection** + revoke + idempotent claim
