# What I need from you (setup checklist)

This is everything DesignForge AI needs before sign-in, generation and payments work for real.
You won't need **Firebase Storage**: leave it disabled. Images, logos and exports are stored as chunked Firestore records, or in Cloudinary if you add it later.

> **Public vs secret.** Values marked 🟢 are public by design: they ship inside the app, and it's fine to send them to me so I can rebuild the APK.
> Values marked 🔴 are **secrets**. Don't paste them in chat or commit them. Put them straight into your API host's environment settings (Render/Fly dashboard → Environment).

---

## A. Rebuilding the APK with working sign-in (send me these 5–6 values)

| # | Value | Where to find it | Type |
|---|---|---|---|
| 1 | `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase console → ⚙ Project settings → *Your apps* → **Web app** (create one if you haven't) → `firebaseConfig.apiKey` | 🟢 |
| 2 | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | same → `authDomain` (e.g. `myproj.firebaseapp.com`) | 🟢 |
| 3 | `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | same → `projectId` | 🟢 |
| 4 | `EXPO_PUBLIC_FIREBASE_APP_ID` | same → `appId` (`1:…:web:…`) | 🟢 |
| 5 | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google Cloud console (same project) → APIs & Services → **Credentials** → *Web client (auto created by Google Service)* → Client ID (`…apps.googleusercontent.com`) | 🟢 |
| 6 | `EXPO_PUBLIC_API_URL` | The URL of your deployed API (section C), e.g. `https://designforge-api.onrender.com` | 🟢 |

You **don't** need these: `storageBucket` (Firebase Storage isn't used), `messagingSenderId`, or `measurementId`.

### Required one-time step: register the APK's signing fingerprint
Google Sign-In on Android fails with `DEVELOPER_ERROR` unless the signing key is registered:

1. Firebase console → Project settings → *Your apps* → **Add app → Android**
   - Package name: `app.designforge.ai`
   - SHA-1: `FE:A7:34:CC:7D:55:99:2D:C7:C7:15:FB:9C:BF:88:3E:0B:ED:58:32`
   - (Also add SHA-256 `EF:E0:70:B3:4B:09:F5:22:AB:E5:FD:F5:BD:3E:AE:F9:EE:13:B6:09:30:41:60:22:E6:8D:B1:FE:1E:DB:F9:67`.)
2. *(Optional, only needed for push notifications)* Download `google-services.json` and give it to me as a file. It's not secret, but keep it out of public repos.
3. When you publish to the Play Store later, also add the **Play App Signing** SHA-1 from Play Console → App integrity.

---

## B. Firebase console switches (2 minutes, free Spark plan)

- [ ] **Authentication** → Sign-in method → **Google → Enable** (choose a support email).
- [ ] Authentication → Settings → **Authorized domains**: add your web domain (e.g. `designforge.pages.dev`).
- [ ] **Firestore Database → Create database** → production mode → pick a region close to you (e.g. `asia-south1`, Mumbai).
- [ ] **Storage → leave it alone** (don't click "Get started").
- [ ] Deploy rules and indexes from the repo root:
  ```bash
  npx firebase-tools login
  npx firebase-tools use <your-project-id>
  npx firebase-tools deploy --only firestore:rules,firestore:indexes
  ```

---

## C. API server secrets (🔴 enter them in your host's dashboard, never in chat)

| Variable | How to get it | Required |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_BASE64` 🔴 | Firebase → Project settings → **Service accounts → Generate new private key**, then run `base64 -w0 key.json` and paste the output. Delete `key.json` afterwards. | ✅ |
| `FIREBASE_PROJECT_ID` | same as #3 above | ✅ |
| `ENCRYPTION_KEY` 🔴 | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Back it up**: if you lose it, every user has to reconnect their Stitch/Gemini keys. | ✅ |
| `RAZORPAY_KEY_ID` | Razorpay dashboard → Settings → API Keys (`rzp_test_…` while testing) | for payments |
| `RAZORPAY_KEY_SECRET` 🔴 | shown with the key id (only once) | for payments |
| `RAZORPAY_WEBHOOK_SECRET` 🔴 | Razorpay → Settings → **Webhooks → Add**: URL `https://<api-host>/api/webhooks/razorpay`, events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, and `subscription.activated/charged/halted/cancelled/completed`. Use any strong random string as the secret. | for payments |
| `CORS_ORIGINS` | Your web + admin URLs, comma-separated | ✅ |
| `PUBLIC_WEB_URL` | Your web app URL | ✅ |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` 🔴 | cloudinary.com free account → Dashboard. **Optional.** Without it, assets live in Firestore, which is fine for small usage. | ⬜ |

The API **refuses to start in production** without `FIREBASE_SERVICE_ACCOUNT_BASE64` and `ENCRYPTION_KEY`. Razorpay is **all-or-nothing**: with none of the three Razorpay values set, the API runs with payments switched off (users can sign in and generate with their own keys; purchases show "Payments are not configured"). Setting only one or two of them is rejected at startup.

Free hosting: Render's free web service works with `render.yaml`. It sleeps after 15 minutes idle, so the first request takes about 30–50 seconds.

---

## D. Web app (Cloudflare Pages / any static host)

`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`: the same 4 values as A1–A4. Leave `VITE_API_BASE` empty to use the `/api` proxy.

---

## E. After deploying

- [ ] Sign in once with your Google account in the app or on the web.
- [ ] Make yourself owner/admin: `cd apps/api && npm run make-admin -- you@gmail.com owner` (needs the service-account env locally).
- [ ] Admin panel → Plans: paste your Razorpay **plan IDs** if you want auto-renewing subscriptions.
- [ ] Each user (including you) connects **their own** Stitch API key / Gemini key in the app under *Integrations*. There is deliberately no shared admin key.

---

## Quick copy template (send me section A filled in)

```
EXPO_PUBLIC_API_URL=
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
```
Plus confirmation that you added the SHA-1 above, and `google-services.json` if you want push notifications.
