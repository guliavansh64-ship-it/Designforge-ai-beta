# Environment & credentials setup

**Never commit real values.** Every `.env*` file except `.env.example` is git-ignored. In production, set secrets in your host's dashboard (Render/Fly secrets, EAS secrets).

## What is secret and what is public
| Value | Secret? | Where it lives |
|---|---|---|
| Firebase service account | **SECRET** | API host only |
| `ENCRYPTION_KEY` | **SECRET** (losing it = all users must reconnect) | API host + offline backup |
| Razorpay key secret / webhook secret | **SECRET** | API host only |
| Cloudinary API secret | **SECRET** | API host only |
| Firebase web config (`apiKey`, `projectId`, …) | Public by design | Web + Android bundles |
| Razorpay **key id** (`rzp_…`) | Public | Served by `GET /api/plans` |
| Google OAuth *web client id* | Public | Android bundle |
| Users' Stitch/Gemini keys | **SECRET** | Encrypted in Firestore only, never in any client |

## 1. Firebase (Auth + Firestore)
1. Create a project at https://console.firebase.google.com (the Spark free plan works).
2. **Authentication → Sign-in method → Google → Enable.** Add your web domains under *Authorized domains*.
3. **Firestore → Create database** (production mode). **Do not enable Firebase Storage.** DesignForge doesn't use it (it now also requires the paid Blaze plan for new buckets). Generated images and exports are stored as chunked Firestore records, or in Cloudinary if you set `CLOUDINARY_*`.
4. Deploy the rules and indexes: `npx firebase-tools deploy --only firestore:rules,firestore:indexes` (uses `firebase.json` at the repo root). Index builds take a few minutes.
5. **Project settings → Service accounts → Generate new private key.** Then run `base64 -w0 key.json` and put the output in `FIREBASE_SERVICE_ACCOUNT_BASE64`. Delete the downloaded file afterwards.
6. **Project settings → Your apps → Web app** gives you the `VITE_FIREBASE_*` and `EXPO_PUBLIC_FIREBASE_*` values.
7. **Android app** (package `app.designforge.ai`, or your `ANDROID_PACKAGE`):
   - Add your **SHA-1** fingerprints: the debug keystore, plus the **EAS upload key** (run `eas credentials`), plus the **Play App Signing** key from Play Console. Without them, Google Sign-In fails with `DEVELOPER_ERROR`.
   - Download `google-services.json`. Do **not** commit it; see 07-DEPLOYMENT.md.
8. `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` = the **Web client** ID (type 3) inside `google-services.json`, or Google Cloud Console → Credentials → "Web client (auto created by Google Service)".

## 2. Encryption key
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Store it in `ENCRYPTION_KEY` and keep an offline backup in a password manager. To rotate it, see 06-SECURITY.md.

## 3. Razorpay
1. Sign up at https://dashboard.razorpay.com and stay in **Test mode** until KYC is done.
2. Settings → API Keys gives you `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Use `rzp_test_` keys during development.
3. **Subscriptions** (Pro/Premium auto-renew): create Plans in Razorpay. Then, in DesignForge Admin → Plans, paste the Razorpay plan IDs per cycle. Prices shown to users always come from DesignForge's server, and the API rejects mismatches.
4. Settings → Webhooks → Add:
   - URL: `https://<api-host>/api/webhooks/razorpay`
   - Secret: a random string, which goes in `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `subscription.activated`, `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`
5. Test UPI: `success@razorpay`. Test card: `4111 1111 1111 1111`, any future expiry, any CVV.

In **development** the Razorpay variables are optional: payment endpoints return `PAYMENTS_UNAVAILABLE` (HTTP 503) and the UI hides the buy buttons. In **production** the API refuses to start without `FIREBASE_SERVICE_ACCOUNT_BASE64`, `ENCRYPTION_KEY` and the three Razorpay variables (fail-fast config check).

## 4. API (`apps/api/.env`)
| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` in prod |
| `PORT` | no | default 8080 |
| `CORS_ORIGINS` | yes | Comma list, e.g. `https://designforge.pages.dev,https://admin.designforge.app` |
| `PUBLIC_WEB_URL` | yes | Used in links/emails/notifications |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | yes | See above |
| `FIREBASE_PROJECT_ID` | yes | |
| `ENCRYPTION_KEY`, `ENCRYPTION_KEY_ID` | yes | 32-byte base64; id e.g. `k1` |
| `ENCRYPTION_KEY_PREVIOUS`, `ENCRYPTION_KEY_PREVIOUS_ID` | rotation only | |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | all-or-nothing | None set = payments disabled (503 `PAYMENTS_UNAVAILABLE`); a partial set fails startup. Use test keys on staging. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | optional | Without them, assets are stored as chunked Firestore blobs |
| `MAX_CONCURRENT_JOBS` | no | default 4 (free hosts: keep at 2–4) |
| `JOB_TIMEOUT_MS` | no | default 300000 |
| `GEMINI_IMAGE_MODEL_DEFAULT`, `GEMINI_TEXT_MODEL_DEFAULT` | no | Override if Google renames models |
| `LOG_LEVEL` | no | `info` |
| `STITCH_API_KEY` | **POC only** | Used only by `npm run poc` with **your own** key. The server explicitly strips it, so it can never act as a fallback for users. |

## 5. Web (`apps/web/.env`)
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, and `VITE_API_BASE`. Leave `VITE_API_BASE` empty to use same-origin `/api` through a proxy; otherwise set it to `https://api.example.com/api`. `API_PROXY_TARGET` is dev only. Never set `VITE_UI_PREVIEW=1` in production; it is only for screenshots with labelled sample data.

## 6. Android (`apps/mobile/.env` or EAS environment variables)
`EXPO_PUBLIC_API_URL` (e.g. `https://api.example.com`, **without** `/api`), the `EXPO_PUBLIC_FIREBASE_*` values, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, optional `ANDROID_PACKAGE`, `EAS_PROJECT_ID`, and `GOOGLE_SERVICES_JSON` (an EAS *file* secret). Everything prefixed `EXPO_PUBLIC_` is compiled into the APK, so only public values go there.

## 7. First admin
There is no public admin signup. After your first Google login:
```bash
cd apps/api && npm run make-admin -- you@example.com owner
```
This sets the `adminRole` custom claim and creates `admin_users/{uid}`. Sign out and back in to refresh the token. Revoke with `… revoke`.

## 8. Seed data
`npm --workspace apps/api run seed` writes the default plans, system settings and starter templates. It is idempotent.
