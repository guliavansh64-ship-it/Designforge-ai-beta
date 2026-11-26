# Test the Android app without Render

The **test APK** (`DesignForgeAI-1.0.0-test-arm64.apk`, version `1.0.0-test`) has a **Server URL** field right on the login screen, plus a Server card in Settings. You can point the app at any DesignForge API without rebuilding:

1. Paste the URL into the **Server URL** field (on the login screen) or tap **Change server** (in Settings).
2. Tap **Connect**.

The app checks `<url>/health` before saving.

> The test APK also allows `http://` addresses (only needed for option B). The production APK built later for Render won't have the Server card and is HTTPS-only.

---

## Option A: the temporary server I'm running for you (no setup)
The APK comes preset to a server running in the Arena workspace, reached through a free Cloudflare tunnel:
`https://carb-trembl-would-psi.trycloudflare.com` (this URL changes whenever the tunnel restarts)

It uses your real Firebase project, so sign-in, projects and integrations all work.

⚠️ It only works **while this chat session is active**. When the workspace sleeps or resets, the tunnel stops. If I restart it, it gets a **new** URL; I'll give it to you, and you paste it into **Change server**.

## Option B: run the API on your PC (same Wi-Fi as your phone)
Needs Node.js 20+ (https://nodejs.org).
```bash
# in the unzipped designforge-ai folder
npm ci
npm --workspace packages/shared run build
# put the apps/api/.env file from the workspace into apps/api/.env  (it is SECRET; don't commit it)
npm run dev:api          # → "DesignForge API listening on :8080"
```
1. Find your PC's Wi-Fi IP address:
   - Windows: `ipconfig` → *IPv4 Address* (e.g. `192.168.1.20`)
   - macOS: `ipconfig getifaddr en0`
2. In the app, tap **Change server** and enter `http://192.168.1.20:8080`.
3. If it can't connect, allow Node.js / port 8080 through the **Windows Defender Firewall** (Private networks), and check that the phone and PC are on the same Wi-Fi network.

## Option C: your PC + a free HTTPS tunnel (works on mobile data too)
1. Run the API as in option B.
2. Install cloudflared: on Windows run `winget install Cloudflare.cloudflared`; on macOS run `brew install cloudflared`.
3. Run `cloudflared tunnel --url http://localhost:8080`. It prints a `https://….trycloudflare.com` URL.
4. Paste that URL into **Change server**. The URL changes every time you restart cloudflared.

## What works without extra keys
- ✅ Google sign-in, profile, projects, settings, notifications and support tickets.
- ✅ Generation, once **you** connect your own Stitch API key (and Gemini key for logos) in **Settings → Integrations**.
- ⛔ Payments show "Payments are not configured" until all three Razorpay variables are set on the server.
- ⚠️ Some lists may show an "index required" error until you deploy Firestore indexes (see docs/10, step 5).

## When you move to Render
Deploy as in `docs/10-DEPLOY-API-RENDER.md`. You can paste the Render URL into **Change server** right away to keep testing. For the final release, I'll build the normal APK with the Render URL built in and no Server card.
