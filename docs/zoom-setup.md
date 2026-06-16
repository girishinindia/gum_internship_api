# Zoom setup (module 2.7)

1. Go to https://marketplace.zoom.us → Develop → **Build App** → choose **Server-to-Server OAuth** (no user OAuth dance; the platform schedules meetings as your Zoom account).
2. App credentials page gives three values → put them in `.env`:
   - `ZOOM_ACCOUNT_ID`
   - `ZOOM_CLIENT_ID`
   - `ZOOM_CLIENT_SECRET`
3. **Scopes** tab → add: `meeting:write:meeting`, `meeting:read:meeting` (admin variants if your account is under an org: `meeting:write:meeting:admin`).
4. **Activate** the app (Activation tab). S2S apps don't need marketplace review for internal use.
5. The license on the host account determines limits (Basic = 40-min meetings). Cohort sessions need a Licensed user — the API creates meetings as `users/me` (the account owner).
6. Set `LIVE_DRY_RUN=false` once credentials are real. Token caching/refresh is handled in `src/services/liveProviders.ts` (account_credentials grant, cached until expiry).
7. Google Meet in v1: instructors paste the link (`manualJoinUrl`) — `MeetProvider` is a stub behind the same `LiveProvider` interface, ready for Calendar-API auto-creation in P2.
