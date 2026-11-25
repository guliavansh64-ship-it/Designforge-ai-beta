# Deployment (free-tier first, honest limits)

| Part | Recommended | Free-tier reality |
|---|---|---|
| API | **Render** free web service (`render.yaml`) or Fly.io (`apps/api/Dockerfile`) | Render free **sleeps after ~15 min idle** (cold start about 30–60 s) and has 750 instance-hours/month. The in-process job queue stops while asleep. On restart, any queued or running jobs that were interrupted are **marked failed and refunded automatically** (`recoverInterruptedJobs`), so users never lose credits but do need to retry. For production use a paid instance (about $7/month) or Fly with `min_machines_running = 1`. |
| Web | **Cloudflare Pages** (`apps/web`) | Static hosting is free with generous limits. Pages Functions (the `/api` proxy) are free up to 100k requests/day. |
| Database/Auth | Firebase Spark | 50k reads / 20k writes / 20k deletes per day, 1 GiB. A few hundred daily active users fit; move to Blaze (pay-as-you-go) before launch. |
| Assets (images, logos) | **Firestore chunked blobs** by default (no Firebase Storage), or the Cloudinary free tier | Blobs count toward Firestore's 1 GiB and 20k writes/day (a logo batch is roughly 4–20 writes). Set `CLOUDINARY_*` to move assets to a CDN once you have real usage. |
| Payments | Razorpay | No fixed fee; about 2% per transaction (verify current pricing). KYC is required for live mode. |
| AI | **Each user's own** Stitch/Gemini quota | DesignForge pays nothing for generation. Users are bound by Google's quotas, which can change. |

> Nothing here is "unlimited free production". The free stack is suitable for development, beta and low traffic. The checklist in 08 lists the upgrade points.

## 1. Firebase
Follow `03-ENVIRONMENT.md` §1, then:
```bash
npx firebase-tools login
npx firebase-tools use <project-id>
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

## 2. API on Render
1. Push the repo to GitHub (private). Render → **New → Blueprint** → select the repo. `render.yaml` is detected.
2. Fill in the `sync: false` secrets in the dashboard. Set `CORS_ORIGINS` to your Pages URL(s).
3. After deploy: `curl https://<service>.onrender.com/health` → `{"ok":true,...}`.
4. Seed and create the first admin from your machine, using the service account in your local `.env`:
   `npm --workspace apps/api run seed` and `npm --workspace apps/api run make-admin -- you@example.com owner`.
5. Add the Razorpay webhook: `https://<service>.onrender.com/api/webhooks/razorpay`.

**Fly.io alternative:**
```bash
fly launch --dockerfile apps/api/Dockerfile --no-deploy
fly secrets set ENCRYPTION_KEY=... FIREBASE_SERVICE_ACCOUNT_BASE64=... RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=... CORS_ORIGINS=... PUBLIC_WEB_URL=...
fly deploy
```

## 3. Web on Cloudflare Pages
Pages → Create → connect the repo, then set:
- **Build command:** `npm ci && npm --workspace packages/shared run build && npm --workspace apps/web run build`
- **Build output directory:** `apps/web/dist`
- **Root directory:** repo root
- **Functions directory:** `apps/web/functions` (in the Pages project settings; otherwise set the root directory to `apps/web` and adjust the commands)
- **Env (build):** `VITE_FIREBASE_*`. Leave `VITE_API_BASE` empty to use the same-origin proxy.
- **Env (runtime, for Functions):** `API_ORIGIN=https://<service>.onrender.com`
- `public/_headers` (security headers + sandbox CSP) and `public/sandbox.html` are deployed automatically.

Then add the Pages domain to Firebase Auth → Authorized domains.

## 4. Android app (EAS Build)
The app uses native modules (Google Sign-In, Razorpay, notifications, secure store), so **it does not run in Expo Go**. Use a development build or EAS.

```bash
cd apps/mobile
npm install --legacy-peer-deps      # mobile is intentionally NOT in the root npm workspaces (Metro hoisting)
npx eas login
npx eas init                        # writes EAS_PROJECT_ID
```

**google-services.json** (keep it out of git):
```bash
npx eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret --environment production
```
`app.config.ts` reads `process.env.GOOGLE_SERVICES_JSON` and falls back to the local `./google-services.json`.

**Public config:** set the `EXPO_PUBLIC_*` variables as EAS environment variables (or in `.env` for local builds).

**SHA-1 for Google Sign-In:** run `npx eas credentials` → Android → copy the SHA-1 of the keystore. Add it in Firebase → Project settings → Android app, re-download `google-services.json`, and update the secret. After the first Play upload, also add the **Play App Signing** SHA-1 from Play Console → App integrity.

**Local APK without EAS:** see `apps/mobile/README.md` → *Build an APK locally* (`npm run build:apk:local`).

**Builds:**
```bash
npm run build:apk      # eas build -p android --profile preview → installable APK for testers
npm run build:aab      # eas build -p android --profile production → AAB for Play Store
npx eas build -p android --profile development   # dev client for local development
npx expo start --dev-client
```

**targetSdk:** Expo SDK 52 targets API 34, which is fine for sideloaded APKs. Google Play requires API 35 for new apps and updates, so before a Play release either upgrade to Expo SDK 53+ or set `android.targetSdkVersion=35` and test edge-to-edge layouts on Android 15.

**Play Store:**
1. Create the app in Play Console.
2. Complete the Data safety form: email, name, purchase history, user content, app activity. Data is encrypted in transit, and account deletion is available in-app.
3. Add a privacy policy URL.
4. Content rating.
5. Upload the AAB to Internal testing.

Razorpay in-app purchases of **digital goods** fall under Google Play's payments policy. Review Play's billing requirements for India (user-choice billing / alternative billing programs) before publishing paid features in the Play build. Options are enabling Play Billing for in-app purchases, or offering purchases only on the web. This is a **policy decision you must make**; the code supports either approach.

## 5. Post-deploy smoke test
Run rows 1, 4, 5, 9, 10, 11 and 16 of the test plan in `05-TESTING.md` against production with Razorpay **test** keys, then switch to live keys.
