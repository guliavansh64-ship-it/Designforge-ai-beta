# Production checklist

## Credentials and configuration
- [ ] All secrets are in host secret stores; no `.env` or `google-services.json` in git (`git log -p | grep -i "BEGIN PRIVATE\|rzp_live"` returns nothing)
- [ ] `ENCRYPTION_KEY` backed up offline (losing it forces every user to reconnect)
- [ ] `NODE_ENV=production`; the API fail-fast config check passes
- [ ] `CORS_ORIGINS` lists only your real domains
- [ ] Razorpay **live** keys and a live webhook with all events (03-ENVIRONMENT §3); a test payment and refund done
- [ ] Razorpay plan IDs set in Admin → Plans for Pro/Premium monthly and annual
- [ ] Prices in Admin → Plans reviewed (GST-inclusive or not, as decided with your CA)

## Firebase
- [ ] `firestore.rules` (deny-all) and `firestore.indexes.json` deployed; all indexes show **Enabled**
- [ ] Firebase Storage left **disabled** (not used by DesignForge)
- [ ] Upgraded to **Blaze** with a **budget alert** before launch (Spark daily limits stop the app when exceeded)
- [ ] Authorized domains: only production plus staging
- [ ] Android SHA-1s registered: upload key **and** Play App Signing key
- [ ] Optional: Identity Platform + MFA for admin accounts. At minimum, require 2-Step Verification on every admin Google account
- [ ] Scheduled Firestore export (backups) to a GCS bucket

## Admin and operations
- [ ] Exactly one `owner`; other staff get the least role needed (`support` / `finance` / `admin`)
- [ ] Maintenance mode and feature flags tested
- [ ] `security@` and `support@` mailboxes exist; support ticket replies tested
- [ ] Uptime monitor on `/health` (e.g. UptimeRobot free). On Render free this also reduces sleeping, but **upgrade the instance for real users**
- [ ] Log retention and alerts on `unhandled error` (Render log streams → Better Stack/Logtail free tier)

## Web
- [ ] `apps/web/dist/index.html` contains the CSP meta; `_headers` is served (check with `curl -I` for HSTS and `X-Frame-Options`)
- [ ] `/sandbox.html` responds with its own CSP (`connect-src 'none'`)
- [ ] The `VITE_UI_PREVIEW` banner never appears in production
- [ ] Lighthouse check of the login and dashboard pages

## Android
- [ ] `npx expo-doctor` passes; `npx tsc --noEmit` is clean
- [ ] Production AAB built with EAS; `versionCode` incremented (`autoIncrement` in `eas.json`)
- [ ] Tested on a low-end device (Android 8+), in dark and light mode, and on a slow network
- [ ] Push: FCM V1 credentials uploaded to EAS (`eas credentials` → Push notifications)
- [ ] Play Console: Data safety, privacy policy, account deletion URL, content rating
- [ ] **Decide the payments policy** for digital goods in the Play build (Play Billing vs. web-only purchases); see 07-DEPLOYMENT §4

## Legal and product honesty
- [ ] Privacy policy and terms published (DPDP Act 2023), including that designs are generated in **the user's own Google account** under Google's terms
- [ ] UI copy reviewed:
  - no "unlimited"
  - no claim that Stitch makes images
  - no Figma export claim
  - audit scores labelled as heuristics
- [ ] Refund policy for credits and subscriptions published (Razorpay requires one)
- [ ] Trademark disclaimer in Logo Studio is visible

## Scale triggers (upgrade when…)
| Signal | Action |
|---|---|
| Cold starts hurt or jobs are interrupted | Paid Render or Fly instance with min 1 machine |
| More than about 15k Firestore reads/day | Blaze plan (already required by the checklist above) |
| More than 4 concurrent generations queued for long periods | Raise `MAX_CONCURRENT_JOBS`, or move the queue to Cloud Tasks / a separate worker |
| Asset traffic grows | Configure Cloudinary (or Cloudflare R2 with a small adapter) |
