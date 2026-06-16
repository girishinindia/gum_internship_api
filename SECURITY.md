# SECURITY — internship-api

## Video piracy mitigation (module 2.6)

Layered controls; no single layer is sufficient alone:

1. **No raw URLs ever stored or returned.** Lesson rows hold only `bunny_video_id`. Playable URLs exist solely as the output of `GET /lessons/:id/play`, which runs auth → active-enrollment → sequential-unlock checks first. Catalog/detail payloads never include video identifiers (verified in tests).
2. **Token-authenticated delivery.** Bunny Stream "Embed View Token Authentication" is enabled on the library: every embed/HLS request must carry `token = sha256(token_auth_key + video_id + expires)`. Tokens are minted server-side per request.
3. **Short expiry.** `BUNNY_STREAM_PLAYBACK_TTL_HOURS` (default 4h) bounds how long a leaked URL works; sharing a link is sharing a countdown.
4. **Optional IP lock.** `BUNNY_TOKEN_IP_LOCK=true` folds the requester's IP into the token, so the URL dies outside that network (off by default — Indian mobile carriers rotate IPs aggressively; enable for web-heavy cohorts).
5. **Sequential unlock + enrollment binding.** Tokens are only minted for the learner's OWN active enrollment and only once prior mandatory lessons are complete — bulk-ripping a whole course straight after purchase requires walking the curriculum.
6. **MP4 fallbacks disabled** on the Stream library (HLS only) — removes the trivial "download the .mp4" path.
7. **Watermarking (note).** v1 ships without forensic watermarking. Bunny Stream supports player-level dynamic overlays — the web/Flutter players render the learner's email + enrollment id as a semi-transparent moving overlay (deterrence). True per-viewer forensic watermarking (server-side, e.g. transcode-time) is a paid P2 item; revisit if leaks are observed.
8. **Operational:** signed URLs are never logged (pino redaction covers tokens), webhook endpoints authenticate (HMAC for Razorpay, shared secret for Bunny), and certificates/invoices/submissions live in a private zone served only via short-lived signed URLs (15 min).

## Reporting

Email security@gum-internships.example.com. Do not open public issues for vulnerabilities.
