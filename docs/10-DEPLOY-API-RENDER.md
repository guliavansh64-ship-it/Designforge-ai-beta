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
   { "ok": true, "build": "2026-12-04", "stitchModels": ["GEMINI_3_8_FLASH", "GEMINI_3_5_FLASH_LITE"] }
   ```
   If `build` is missing, the old code is still running.
4. Optional: run a real end-to-end Stitch check from your PC. This uses 1 generation of *your* Stitch quota and deletes its test project afterwards:
   ```bash
   cd apps/api && npm run stitch:check -- GEMINI_3_5_FLASH_LITE you@gmail.com
   ```

**What changed in Nov 2026 (Stitch API):**
- Stitch retired the `GEMINI_3_FLASH` / `GEMINI_3_PRO` / `GEMINI_3_1_PRO` models and now accepts `GEMINI_3_8_FLASH` and `GEMINI_3_5_FLASH_LITE`.
- Generated HTML and screenshot download URLs now need credentials. The API downloads files through Stitch's official `download_file` tool instead.

## Build 2026-11-27: prompt enhancement, full-app generation, full-screen preview, downloads

**What's new**
- **Prompt enhancement before Stitch.** Every generation request goes through `services/promptEnhancer.ts` first:
  - If the user has connected **their own Gemini key** (Integrations), Gemini (`gemini-flash-latest`, JSON mode) rewrites the idea into a detailed design brief, a shared theme and one detailed prompt per screen.
  - Without a key, or if Gemini fails, a built-in planner does the same from category templates (fitness, food, shop, finance, travel, education, generic, website pages).
  - There is no shared or operator Gemini key.
- **Full app from a short prompt.** "Create a fitness app" → 3–6 screens (Home, Workouts, Active workout, Progress, Profile…). Every screen is generated in the same Stitch project with the same theme, navigation and brief, then saved as its own page.
  - Credits are charged **per screen** (2 each): screen 1 at enqueue, each further screen when it starts.
  - If a later screen fails, finished screens are kept and only that screen is refunded.
  - In `mode: 'app'` the API checks up front that the whole app is affordable.
- **`POST /api/prompt/enhance`**: previews the plan for free. The client may send that plan back in `/generate` (`plan`), so Stitch gets exactly what the user saw.
- **`/generate` body additions** (all optional; old app builds keep the old one-screen behaviour): `enhance`, `mode: auto|single|app`, `maxScreens` (2–6), `plan`, `pageNames`.
- **Downloads:**
  - `GET /api/versions/:vid/download?format=png|html` is free: the Stitch screenshot, or the page as one `.html` file.
  - Whole-app ZIP exports (HTML 1 cr, React 2 cr) include every generated screen.
- **Full-screen preview:** Android `app/preview/[id].tsx` and web `/preview/:projectId`.
  - Mobile / Tablet / Desktop buttons on top, every screen as a tab, and a download menu.
  - It opens automatically when a new generation finishes.
- **Gemini model defaults updated:** text `gemini-flash-latest`, images `gemini-nano-banana-2.1` (`gemini-2.5-*` is being retired).
  - If you set `GEMINI_IMAGE_MODEL_DEFAULT` / `GEMINI_TEXT_MODEL_DEFAULT` on Render, update or delete them.

## Build 2026-11-28: ZetPay UPI payments, push notifications, automatic generation, Assistant fixes

**New Render environment variable (required for payments):**

| Key | Value |
|---|---|
| `ZETPAY_API_KEY` | your ZetPay developer key (server only, never in the app) |

`RENDER_EXTERNAL_URL` is set by Render automatically and is used for the ZetPay return page
(`/api/billing/zetpay/return/app|web`). Only set `PUBLIC_API_URL` if you use a custom domain.
Razorpay variables can stay empty. When `ZETPAY_API_KEY` is set, ZetPay is the payment provider.

**ZetPay notes**
- Switch the ZetPay dashboard from **Test mode** to **Live mode** to take real money. In test mode the payment page is a simulator.
- ZetPay accepts ₹1–₹5,000 per order. Premium annual (₹12,470) and Lifetime (₹14,999) show "Not available via UPI". You can lower those prices in Admin → Plans if you want to sell them.
- Plans are prepaid for 30 days or 1 year, with no auto-debit. Users get a push before the plan expires.
- Credits are granted only after the server checks `order-status` = `success` with ZetPay. A reconciler checks recent pending orders every 75 s, so the purchase still completes if the buyer closes the app early.

**Push notifications**: these use Firebase Cloud Messaging through the existing service account. No Expo/EAS account is needed.
- Automatic pushes: design ready, design failed, payment success, payment failed, low credits (once a day), plan expiring, plan expired, support reply, welcome.
- Manual pushes: Admin → Push notifications on the web, or Settings → "Admin · Send push notification" in the app (admins only). You can send to all users, to everyone on one plan, or to one user by email or uid.
- The phone registers its push token after sign-in, so users must install the 2026-11-28 APK.

**Automatic generation**: the Studio has one prompt box and one button. The server chooses everything else:
- One screen or a full app, and how many screens.
- Device and theme.
- The Stitch model: 3.8 Flash, with automatic retry on 3.5 Flash-Lite.
- The hidden prompt enhancement. Gemini runs on the user's own key when it is connected; otherwise the built-in planner is used. The enhanced prompts are never returned to clients.
Gemini is used only for enhancement and for rewriting short chat edit requests. Stitch does every design.

## Build 2026-11-29: push while the app is closed

**Redeploy is required.** Phones can only save their push token on API build `2026-11-28` or newer. The older live build (`2026-11-27`) has no `/api/me/push-token` route, so no phone is registered and no push arrives, whether the app is open or closed. After deploying, `GET /health` must show `"build":"2026-11-29"`.

What changed:
- **Server (`notify.ts`):** sends FCM messages with a `notification` payload and `priority: high`, plus a 3-day TTL, a channel, a status-bar icon, sound, vibration and public lock-screen visibility. Android shows these by itself even when the app is closed or killed, so the app does not need to run.
- **New route `POST /api/me/push-test`:** sends a test push 15 s later, so you can close the app and check delivery.
- **App:**
  - Creates high-importance channels at startup.
  - Re-registers the token on every launch, with retries while the server wakes up.
  - Opens the right screen when a notification is tapped from the closed state.
  - Sets the status-bar icon and default channel in the manifest.
  - New Settings card: "Notifications when the app is closed", with a test button, battery settings and brand-specific tips.

Phone requirements:
- Notifications are allowed.
- The app is **not force-stopped**. Settings → Force stop blocks all pushes until the app is opened again; swiping it away from recents is fine.
- On Xiaomi, Oppo, Vivo, Realme and Samsung phones: turn on Autostart and set battery to "No restrictions".

## Build 2026-11-30: free Assistant, onboarding, redesign

Redeploy the API, then check that `GET /health` shows `"build":"2026-11-30"`.

**Server:**
- **New routes** `GET/DELETE /api/assistant/messages` and `POST /api/assistant/ask` (free and read-only, rate-limited to 20 per minute).
  - The assistant never starts jobs or charges credits.
  - It uses the user's own Gemini key when it is connected. Otherwise it falls back to built-in answers from the project data: pages, colours, fonts, buttons, job status, credits and plan.
- **`GET /api/projects`** now returns `activeJob` for projects that are still generating.
- **`POST /api/me/push-test`** was removed (the test button was removed from the app).

**App:**
- **First-run flow:** Google sign-in → API keys (Stitch and Gemini, with step-by-step instructions) → permissions (notifications, battery, autostart) → main app.
- **Login and Studio** were redesigned. The Studio shows only 3 short ideas. The server URL was removed from the login screen.
- **Projects** show "Generating… x%", and opening a project re-attaches to the running job.
- **Settings:** admin push removed; notifications are a single on/off switch.
- **Plan expired** pop-up, shown at most once a day, with a "Renew now" button (plans don't auto-renew).
- **Plans & credits:** a History button at the top right opens payment and credit history.
- **New circular logo** for the app icon, adaptive icon, splash and in-app logo.
- **Instant start:** the cached profile is shown at once and refreshed in the background.

**Note on keys:** the `ENCRYPTION_KEY` on Render is different from the one used before. Keys saved under the old value show as "invalid" and must be pasted once again. The new key-setup screen asks for this automatically.

## Build 2026-12-01: rename to Designo, mandatory permissions, 5 credits per screen

Redeploy the API, then check that `GET /health` shows `"build":"2026-12-01"`.

- **App name** is now **Designo** in the launcher label and every screen, push notification, invoice, README and the web app. The Android package ID stays `app.designforge.ai`, so the APK installs as an update and Firebase keeps working.
- **Creating designs** (UI screens, websites, each screen of a full app) now costs **5 credits per screen** (`CREDIT_COSTS.generate_flash = 5`). Edits and exports are unchanged.
- **Permissions are mandatory and verified.** A new local native module `apps/mobile/modules/designo-power` reads the real settings from Android:
  - Notifications: the Android permission.
  - Battery unrestricted: `PowerManager.isIgnoringBatteryOptimizations`.
  - Background activity: `ActivityManager.isBackgroundRestricted`.

  A tick appears only when Android confirms the setting. "Open Designo" stays locked until all three are on. If one is switched off later, the app returns to the permissions screen.
- **Autostart** (Xiaomi, Oppo, Vivo…) has no public Android API that lets apps read it, so it is offered as a shortcut button rather than a verified tick.
- **Assistant** built-in answers now understand greetings, "name of project", summaries and help.

## Build 2026-12-02: Stitch-made logos and the curved bottom navigation

Redeploy the API, then check that `GET /health` shows `"build":"2026-12-02"`.

- **Logo Studio now uses Google Stitch** with the user's own Stitch key; Gemini is no longer used for logos.
  - For each concept, Stitch designs a screen that contains only the logo on a white canvas.
  - The server trims Stitch's rendering to the logo (`cropToLogo`), centres it on a 1024×1024 square, and then makes the transparent, dark and white versions plus the palette, as before.
  - The `/projects/:id/logos` route now checks the **Stitch** connection.
  - An empty canvas is rejected and the credits are refunded. If one concept fails, the finished ones are kept.
- **Bottom navigation** (`apps/mobile/components/CurvedTabBar.tsx` and `tabBarShape.ts`) is a custom tab bar for the existing expo-router `<Tabs>`:
  - Order: Dashboard · Projects · raised purple **+** (Studio) · Assistant · Settings.
  - Look: curved notch, neon green/cyan border, dark glass body. Animations (breathing, rotating ring, halo, icon pop, ripple) respect the phone's reduce-motion setting.
  - The bar hides while the keyboard is open. Screens keep `tabBarSpace(insets.bottom)` free at the bottom.
  - Android back goes to Dashboard, then exits.

## Build 2026-12-03: logo generation fixed, bottom bar in the app theme

Redeploy the API, then check that `GET /health` shows `"build":"2026-12-03"`.

- **Root cause of "Logo · Generation failed unexpectedly":** Stitch had already designed the logo and the images were stored. Then `createVersion` pointed the page at the new version with `stitchScreenId: undefined`, and Firestore rejects `undefined`, so the job crashed.
  - Fixes:
    - `repo.ts` only writes `stitchScreenId` when it has a value.
    - `db()` now uses `ignoreUndefinedProperties`.
    - Logo versions keep the Stitch screen ID.
  - A second bug was found by the new test: with 2 or more concepts, adding the next page overwrote the earlier concepts' head versions. Pages are now appended in a transaction.
  - Crashed jobs now store a technical `error.detail` for admins.
  - The in-memory test database now rejects `undefined` like real Firestore. New end-to-end test: `test/logo-job.test.ts`.
- **About Stitch and logos:** the Stitch API has no image or logo tool, only screen generation (`generate_screen_from_text`) plus screen HTML and screenshots. Logo Studio therefore asks Stitch to design a screen that contains only the logo on a white canvas, then crops Stitch's own rendering (`cropToLogo`).
- **Bottom bar** uses the theme colours: card-coloured body, brand gradient border (`primary → #a855f7 → ember`), brand-gradient + button, `primary` for the active tab and `muted` for inactive tabs. It supports light and dark mode.

## Build 2026-12-04: full-page logo viewer and "Change this logo"

Redeploy the API, then check that `GET /health` shows `"build":"2026-12-04"`. Install the new APK.

- **Logo Studio:** the "Logos are designed by Google Stitch…" info card is gone. Concepts are shown as large cards; tapping one opens the new full-page viewer (`app/logo-view/[id].tsx`).
- **Full-page viewer:**
  - Large preview with Light / Transparent (checkerboard) / Dark / White backgrounds.
  - Previous/next arrows and thumbnails to switch between concepts.
  - Palette, typography, Download brand kit, and Save PNG for the selected background.
  - **Change this logo:** type a change (or tap an idea chip) and press *Change logo · 2 cr*.
  - **Previous versions:** older versions of a concept can be brought back with *Use*.
- **API:** `POST /api/versions/:vid/logo-edit` `{ instruction, idempotencyKey }` queues a `logo` job with `payload.editOf`.
  - It costs 2 credits, the same as a design edit, and requires the `logo_studio` feature and a Stitch connection.
  - `runLogoEdit` asks Stitch to edit that concept's own screen. Older concepts without a screen ID are redesigned from their original brief plus the change.
  - The result is cropped, split into light/transparent/dark/white files, and saved as the new head of the same concept page, so the other concepts are untouched.
  - `POST /versions/:vid/restore` keeps `source: 'logo'` and the logo files, so restored logos still work in Logo Studio and the brand kit.
- **Dark variant fix:** a mostly dark logo was almost invisible on the dark preview. `darkPreview()` now measures the logo's brightness and uses the white version on dark backgrounds when needed. Existing logos were back-filled (`logo.darkFixed`).
- Tests: 96 (new: change-logo job and dark-preview contrast in `test/logo-job.test.ts`).
- **Project screen (app only):**
  - Versions now show the page name and a number ("Home · Version 3"), a **Current** badge, the type (Generated / AI edit / Variant / Manual / Improved), and a colour-coded **Audit NN/100** badge.
  - Restored versions read "Restored from version N" instead of an internal ID.
  - The Audit tab has a "What does Audit do?" explainer and a **Fix these with AI · 3 cr** button, which runs Improve with the failed checks as instructions.
  - In AI edit, prompts like "Create order page" show a hint that Apply edit changes the *current* page, with **Make it a new page**. That fills in the page name, and Add page includes the typed details.

## Build 2026-12-06: Play mode, downloads to the phone, rename screens, always-awake server

Redeploy the API, then check that `GET /health` shows `"build":"2026-12-06"`. Install the new APK.

- **Play (clickable prototype):** project screen → **Play** (or ▶ in the top-right corner) opens `app/play/[id].tsx`.
  - Every screen's real HTML runs in a WebView; nothing is an image.
  - A small injected script reports taps on links, buttons, tabs and menu items. `lib/prototype.ts` (`resolveTap`) opens the screen whose name best matches the tapped text, icon name or aria-label. It uses synonyms: cart = basket = shopping_cart, profile = account = person, and so on.
  - Back arrows go back, and the Android back button walks the history.
  - Visited screens stay loaded, so switching back is instant.
  - Use the screen picker to jump; use Restart to start again from the first screen.
  - Taps with no matching screen show "No screen for "X" yet".
- **Download button (top-right) + Export tab:** one list.
  - This screen: PNG and HTML, both free.
  - All screens: screenshots ZIP (free, new `GET /api/projects/:id/screenshots`), HTML/CSS/JS ZIP (1 cr) and React + TypeScript ZIP (2 cr).
  - Exports the plan doesn't include show a lock and open Plans instead.
- **Downloads are saved, not shared:** the native module `designo-power.saveToDownloads` writes to **Downloads/Designo** through MediaStore (Android 10+, no permission needed). After saving, an "Open" option appears. The share sheet is only used on Android 9 and older.
- **Rename screen:** a **Rename** button next to the screen chips uses `PATCH /projects/:id/pages/:pageId`.
- **No more "Waking up the server…":**
  - The API now pings itself every 4 minutes **all the time** (`startKeepAwake`, disable with `KEEP_AWAKE=0`), so Render's free plan never sleeps.
  - Backup: `.github/workflows/keep-awake.yml` pings `/health` every 10 minutes from GitHub.
  - The app pings `/health` the moment it opens, and the GET cache is saved on the phone, so screens show instantly while fresh data loads.
  - Note: one always-on free service uses ~744 of Render's 750 free hours per month. A second free service would run out. A paid instance never sleeps.
- **Complete app = 5 cr per screen, all or nothing:** Studio shows "5 cr / screen · you can make up to N screens", and Generate is disabled with a "Get credits" link when you have fewer than 5 credits. The server plans only as many screens as the balance covers, then **reserves every screen up front**. If the balance can't cover them all, nothing is generated, nothing is charged, and the error says how many screens the balance allows. Screens that fail or are skipped are refunded.
- **Smoother UI:** Version cards and Audit rows no longer overlap. The saved data cache loads before the first screen is drawn.
- **Improve a design:** choose which **screen** of a project to improve; same-named projects show the screen count and date. The explanation text was rewritten.

## Build 2026-12-07: complete apps really generate every screen; Play opens the whole app

Redeploy the API, then check that `GET /health` shows `"build":"2026-12-07"`. Install the new APK.

- **Bug fixed: "A … app" only made one Home screen.** Studio always sends the new project's empty first page, and the server treated that as "add one screen". Now only a page that *already has a design* means "one more screen" (`chooseGenerateMode` in `services/appShape.ts`, unit-tested).
- **Studio, "What to make":** choose **Complete app** (default: all screens, up to 5, 5 cr each) or **One screen** (5 cr).
  - Prompts saying "complete / full / entire / whole … app" or "all screens" always make a complete app.
  - Credits for every screen are reserved up front. If they can't all be covered, nothing is generated and nothing is charged.
- **Tabs = screens:** in a complete app, the bottom tab bar must use exactly the screens' names (e.g. Home, Workouts, Progress, Profile). That way every tab opens a real screen in Play.
- **"Complete this app"** (project screen card, and a banner in Play when the app has only 1 screen):
  - Reads the existing screen's tab bar (e.g. Nova: Home, Bounties, Earnings, Profile), colours and fonts.
  - Designs one new screen per missing tab in the same look; the generic "Screen 1" is renamed to the first tab's name.
  - `POST /projects/:id/generate {completeApp:true}`, 5 cr per screen, all or nothing.
- **Play** always starts from the first (home) screen. When a multi-screen generation finishes, the app opens Play automatically.
