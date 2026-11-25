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
2. Render reads `render.yaml` and proposes the **designforge-api** service (free plan, Singapore region). It will ask for the values marked `sync: false`. You can leave them blank for now and fill them in the next step.
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
