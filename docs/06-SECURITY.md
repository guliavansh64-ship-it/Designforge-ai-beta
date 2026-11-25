# Security model

## Principles
1. **Every user's AI access is their own.** Stitch and Gemini keys are per-user, encrypted, and never shared. There is no admin or shared fallback key. The server strips `STITCH_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY` and similar variables from its environment at boot so the SDKs cannot silently pick one up.
2. **Clients are untrusted.** Prices, credits, plan entitlements, ownership and admin rights are decided server-side only.
3. **No Google passwords or cookies, no scraping.** Login uses Firebase Google Sign-In. Stitch is reached only through Google's official SDK/API with the user's own key.

## Authentication
- Firebase ID tokens are verified on every request with `verifyIdToken(token, checkRevoked=true)`.
- Suspended users are blocked (`ACCOUNT_SUSPENDED`). *Sign out everywhere* revokes refresh tokens.
- Login and Stitch authorization are separate steps with separate consent.
- **Android:** native Google Sign-In → Firebase credential. The session lives in Android Keystore-backed `expo-secure-store` (chunked). `allowBackup=false`, so it is not copied by cloud or adb backups.

## Credential vault (users' Stitch/Gemini keys)
- AES-256-GCM, random 96-bit IV, with the uid bound as AAD. A ciphertext copied into another user's document fails authentication.
- Envelope format: `v1:<keyId>:<iv>:<tag>:<ct>`. Only the last 4 characters are ever returned to clients.
- Keys are verified with a read-only call before they are stored. Decryption failures (rotation without a window, or tampering) mark the connection `invalid` and ask the user to reconnect; the server never guesses.

### Rotating `ENCRYPTION_KEY`
1. Generate a new key.
2. Set `ENCRYPTION_KEY_PREVIOUS` and `ENCRYPTION_KEY_PREVIOUS_ID` to the **current** values.
3. Set `ENCRYPTION_KEY` to the new key and `ENCRYPTION_KEY_ID` to a new id (e.g. `k2`). Deploy.
4. Old envelopes still decrypt, and each is **re-encrypted with the new key on first use**.
5. After a window (e.g. 30 days), remove the `PREVIOUS` variables. Users whose key was never used during the window will be asked to reconnect.

This flow is covered by `test/crypto.test.ts`.

## Authorization
- **Projects:** every lookup goes through `loadProject(id, uid, need)`, which checks owner/editor/viewer. AI actions are **owner-only** because they spend the owner's quota and credits. Sharing is stored as `sharedWith` plus `sharedUids`.
- **Admin:** requires the `adminRole` custom claim (`owner|admin|support|finance`) **and** an active `admin_users/{uid}` doc, so revocation takes effect immediately. There is no admin signup; the role is granted only through `npm run make-admin` with service-account access. Every mutation is written to `admin_audit_logs`. For 2FA, enable **2-Step Verification enforcement for admin Google accounts** in Google Workspace/Account settings (Firebase's own MFA needs Identity Platform; see the production checklist).
- **Firestore rules deny all client access** (`firestore.rules`). Clients use the API only. Firebase Storage is not used at all; assets are served by the API (`/api/assets/:id`, owner check or signed token) or by Cloudinary.

## Payments (Razorpay)
- Order amounts are computed on the server from plan/pack and coupon data; client-supplied amounts are never trusted.
- Checkout signature: `HMAC_SHA256(order_id|payment_id, key_secret)`, compared with a constant-time check.
- Webhook signature: HMAC of the **raw body**. The route is mounted before the JSON parser, and replays are rejected through `webhook_events/{eventId}`.
- Grants are idempotent (`order_<id>` reference) inside Firestore transactions. Subscriptions activate only via the webhook.

## Credits
Credits are reserved in a transaction, the job runs, and then the reservation is committed or refunded. Idempotency keys make retries free. Improve uses per-iteration keys (`{jobId}_it{n}`). Exports are charged only after the build validation passes.

## Generated content
- **Web preview:** `<iframe sandbox="allow-scripts">` (opaque origin) loading `/sandbox.html`, which has its own CSP: no `connect-src`, no forms, no frames, scripts only inline plus the Tailwind runtime. It deliberately avoids `srcdoc`, because srcdoc would inherit and force-weaken the app's CSP. A browser test verified that Tailwind renders while `fetch` and `document.cookie` are blocked.
- **Android preview:** a WebView with an injected CSP (`connect-src 'none'`), all navigation blocked, and no file access.
- **Manually saved HTML** (visual editor or shared editors) goes through `services/sanitize.ts`. It removes external scripts except the Tailwind runtime, `iframe/object/embed/base`, meta refresh, all `on*` handlers, `javascript:`/`vbscript:`/`data:text/html` URLs, and editor artefacts. Inline `<script>` blocks are **kept**, because generated designs use them for `tailwind.config`. What was removed is returned as `sanitized[]`. Tested in `test/sanitize.test.ts`. Stitch output is stored as returned and is contained by the preview sandbox; review any exported code before deploying it to your own domain.
- **Exports** download remote assets with SSRF protection (private IP ranges blocked, size and time limits).

## Web headers
- **App:** a strict CSP `<meta>` injected at build time (`vite.config.ts`). It allows scripts only from self, Google Sign-In and Razorpay.
- **`_headers`:** HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`, Referrer-Policy, Permissions-Policy, and COOP `same-origin-allow-popups` (needed for the Google popup).
- **API:** helmet (`default-src 'none'`, `frame-ancestors 'none'`), a CORS allowlist, bearer-only auth (no cookies, so CSRF does not apply), rate limits, zod validation on every body/query, a body-size cap, and pino logs with redaction of `authorization`, `apiKey` and similar fields.

## Data protection (DPDP Act 2023 / GDPR-style)
Users can export their data (`GET /me/export`) and delete their account (`DELETE /me`). Payment records are retained only as tax law requires. Store only what is needed.

## Reporting
Security issues: security@your-domain (set up before launch). Don't file public issues for vulnerabilities.
