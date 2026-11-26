# Deploy the API on Render (free), about 10 minutes

Firebase is already set up for project **designforge-ai-official**:
- Google sign-in is on.
- The Firestore database exists in asia-south1.
- The security rules are deployed.
- Both signing fingerprints (SHA-1 and SHA-256) are registered.

What's left is getting the API online so the app has a server URL.

## 1. Put the code in a **private** GitHub repo
1. Download `designforge-ai-source.zip` from the workspace and unzip it. It contains no secrets: no `.env` files, keystore, service account or `google-services.json`.
2. On github.com, click **New repository**, name it `designforge-ai` and choose **Private**.
3. Upload the files: drag the *contents* of the `designforge-ai` folder into "uploading an existing file", or use git:
   ```bash
   cd designforge-ai && git init && git add . && git commit -m "DesignForge AI"
   git branch -M main && git remote add origin https://github.com/<you>/designforge-ai.git && git push -u origin main
   ```

## 2. Create the Render service
1. Go to https://dashboard.render.com, then **New → Blueprint** → connect GitHub → pick the `designforge-ai` repo.
2. Render reads `render.yaml` and proposes the **designforge-api** service (free plan, Singapore region). It will ask for the values marked `sync: false`. **Fill them in here** (section 3 lists them). If you leave them blank, the first deploy fails at startup. That is harmless: fill them in later and click **Manual Deploy**.
3. Click **Apply**.

## 3. Paste the environment variables
1. Open **designforge-api → Environment → Add from .env**.
2. Paste the **entire contents** of `apps/api/.env.render`, which is in the workspace. It has your Firebase service account, the encryption key that was generated for you, and the CORS settings.
3. **Save, rebuild and deploy.**

> 🔴 `.env.render` is secret. Don't commit it or share it. Save a copy of the `ENCRYPTION_KEY` line in a password manager: if it's lost, every user has to reconnect their Stitch/Gemini keys.

Payments stay **off** until you add **all three** Razorpay variables (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`). Sign-in and generation work without them.

## 4. Check it's working
Open `https://designforge-api-XXXX.onrender.com/health`. You should see `{"ok":true,"env":"production",...}`.

Send me that base URL (without `/health`). I'll set `EXPO_PUBLIC_API_URL` and rebuild the APK (about 2–5 minutes). The Google button then becomes active.

The free plan sleeps after 15 minutes idle, so the first request after a break takes about 30–50 seconds.

## 5. Firestore indexes (one-time, from your PC)
The Firebase service account isn't allowed to create indexes, so run this yourself from the unzipped folder:
```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:indexes
```
`.firebaserc` already points to `designforge-ai-official`. Index builds take a few minutes; until they finish, project lists and history screens may show "index required" errors.

*Alternative:* in Google Cloud console → IAM, give `firebase-adminsdk-fbsvc@designforge-ai-official.iam.gserviceaccount.com` the role **Cloud Datastore Index Admin**, then tell me and I'll deploy the indexes for you.

## 6. Make yourself admin (after your first sign-in)
```bash
cd apps/api && npm install && npm run make-admin -- you@gmail.com owner
```
This needs `apps/api/.env`, which contains the service account. Download it from the workspace and don't commit it.

## Troubleshooting: "Failed deploy" / build exits with `TS7016 Could not find a declaration file for module 'express'`

Render sets `NODE_ENV=production`, so a plain `npm ci` skips dev dependencies (TypeScript and `@types/*`) and the build fails.
The `render.yaml` in this repo already uses `npm ci --include=dev ...`. If you created the service by hand, set:

- **Build Command:** `npm ci --include=dev --workspace packages/shared --workspace apps/api --include-workspace-root && npm --workspace packages/shared run build && npm --workspace apps/api run build`
- **Start Command:** `npm --workspace apps/api run start`

If the build succeeds but the deploy still fails, open **Logs**. A line starting with `Invalid configuration` means one of the 6 secret variables (section 3) is empty or wrong.

### "Something went wrong" on Projects / logs say `The query requires an index`
The Firestore indexes in `firestore.indexes.json` aren't deployed yet. The API now falls back to an
index-free query automatically, so the app keeps working. To restore full speed, run this once from a PC:
`npm i -g firebase-tools && firebase login && firebase deploy --only firestore:indexes` (in the repo root).

### "Stitch not connected" right after moving to Render
Keys are encrypted with `ENCRYPTION_KEY`. If Render's value differs from the one used when you connected, the
saved key can't be read. Open **Integrations** and reconnect Stitch once. **Never change `ENCRYPTION_KEY`
afterwards** (to rotate it, use `ENCRYPTION_KEY_PREVIOUS` as described in docs/03).

## 7. Updating the deploy (do this after every code update)

Render only runs the code you last pushed. If the app shows
`model: Invalid enum value. Expected 'GEMINI_3_FLASH' | 'GEMINI_3_1_PRO'` or
`Request contains an invalid argument`, your Render service is running an **old build**.

1. Replace the files in your GitHub repo with the latest `designforge-ai-source.zip` contents, then commit and push.
2. In Render, open **designforge-api → Manual Deploy → Clear build cache & deploy**.
3. Open `https://<your-service>.onrender.com/health`. It must show:
   ```json
   { "ok": true, "build": "2026-11-26b", "stitchModels": ["GEMINI_3_8_FLASH", "GEMINI_3_5_FLASH_LITE"] }
   ```
   If `build` is missing, the old code is still running.
4. Optional: run a real end-to-end Stitch check from your PC. This uses 1 generation of *your* Stitch quota and deletes its test project afterwards:
   ```bash
   cd apps/api && npm run stitch:check -- GEMINI_3_5_FLASH_LITE you@gmail.com
   ```

**What changed in Nov 2026 (Stitch API):**
- Stitch retired the `GEMINI_3_FLASH` / `GEMINI_3_PRO` / `GEMINI_3_1_PRO` models and now accepts `GEMINI_3_8_FLASH` and `GEMINI_3_5_FLASH_LITE`.
- Generated HTML and screenshot download URLs now need credentials. The API downloads files through Stitch's official `download_file` tool instead.
