# Testing

## Automated (run on every change)
```bash
npm run typecheck          # API + web (tsc --noEmit, strict)
npm test                   # API unit/integration tests (vitest)
npm run typecheck:mobile   # Android app (tsc, strict)
npm run build              # shared + API + web production builds
```

### What the API suite covers (52 tests in 8 files)
| File | Covers |
|---|---|
| `crypto.test.ts` | AES-GCM round trip, fresh IV per encryption, tamper detection, **key rotation** (old envelopes decrypt, flagged for re-encryption), last-4 hints, constant-time compare |
| `credits.test.ts` | monthly allowance granted once per period, **never deducts twice for the same idempotency key, even concurrently**, refunds exactly once, insufficient balance, idempotent payment grants by order reference, user isolation |
| `billing.test.ts` | Razorpay checkout signature (forgeries rejected), subscription signatures, **webhook HMAC over the raw body** |
| `audit.test.ts` | WCAG contrast maths, flags real problems, built-in templates score ≥ 90, prioritised improvement plan + version compare, website prompt enrichment, section targeting |
| `exporter.test.ts` | HTML→JSX conversion (attributes, styles, void tags, handlers stripped), generated Vite+TS project passes TypeScript validation, `<select defaultValue>`, validator catches broken TSX, HTML ZIP with CSS/JS extraction + README |
| `chat-logos.test.ts` | logo background keying/transparency, mono-white variant, brand colour extraction, wordmark SVG is real escaped vector text, logo prompt rules |
| `http.test.ts` | public health route, **operator Stitch key stripped from the environment at boot**, invalid webhook signatures rejected, disallowed CORS origins blocked, security headers |
| `sanitize.test.ts` | saved-HTML sanitiser keeps Tailwind/inline config and removes scripts from other hosts, lookalike hosts, frames, handlers, `javascript:` (including obfuscated forms), base and meta refresh |

**Not yet covered by automated tests** (covered by the manual plan below): coupon redemption limits, webhook replay dedupe, export SSRF guard, rate-limit responses, admin RBAC per route, and the Stitch/Gemini network calls themselves (those can't be meaningfully faked without misrepresenting Google's behaviour). These are good candidates for an emulator-based integration suite (`firebase emulators:exec`).

Firestore is replaced with an in-memory transactional fake (`test/fakeFirestore.ts`), so tests need no network or credentials.

### Export build validation (manual, run once per exporter change)
The React export was verified by unzipping a generated project and running `npm install && npm run build` (Vite + TS) successfully. Repeat this in CI with a fixture if you change `services/exporter.ts`.

### Web
- `npm --workspace apps/web run dev` with `VITE_UI_PREVIEW=1` gives a clearly bannered sample-data mode for visual QA, active only in dev builds.
- `docs/screens/*.png` were captured with Playwright (desktop and 390px mobile) with zero page or console errors.
- **CSP and sandbox browser test:** the production build loads under its strict CSP with no violations. In the preview sandbox, Tailwind designs render while `fetch()` exfiltration and `document.cookie` are blocked.

### Android
- `npx tsc --noEmit` (strict, 30 files) → 0 errors.
- `npx expo-doctor` → 18/18 checks pass.
- `npx expo export --platform android` → Hermes bundle builds (about 5.3 MB) and contains no secrets (checked with a string scan for API key, Razorpay secret and private key patterns).

## Manual end-to-end test plan (staging, Razorpay **test mode**)
| # | Flow | Expected |
|---|---|---|
| 1 | Google sign-in (web + Android) | Account created, Free plan, 40 credits, welcome notification |
| 2 | Generate without Stitch connected | `STITCH_NOT_CONNECTED` → "Connect Stitch" CTA; **no credits charged** |
| 3 | Connect an invalid key | Rejected, nothing stored |
| 4 | Connect a valid key | `••••last4`, status Active |
| 5 | Generate (Flash) | Job progresses, screen appears, −2 credits, version 1 |
| 6 | Disconnect Wi-Fi mid-job / cancel | Job failed or cancelled, **credits refunded**, transaction marked refunded |
| 7 | Edit, variants, restore an older version | New versions; restore is non-destructive |
| 8 | Improve with auto-iterate (Pro) | Checklist with before/after scores, stops at the limit, the target, or no gain |
| 9 | Export HTML + React | ZIP downloads (web) or share sheet (Android); the React ZIP builds with `npm run build` |
| 10 | Buy a pack with `success@razorpay` | Credits granted once, even if you refresh or retry verify |
| 11 | Subscribe to Pro | "Activating…" then active after the webhook arrives |
| 12 | Payment failure (`failure@razorpay`) | No grant, clear message |
| 13 | Replay a webhook (Razorpay dashboard → resend) | No double grant |
| 14 | Redeem a coupon twice | Second redemption rejected |
| 15 | Admin: adjust credits, suspend a user | Audit log entry; suspended user gets 403 |
| 16 | Non-admin calls `/api/admin/stats` | 403 |
| 17 | Push notification (Android dev build) | "Design ready" notification; tapping it opens the project |
| 18 | Maintenance mode on | Users see a 503 banner; admins still work |
| 19 | Delete account | Data removed; can sign up fresh |

### Stitch smoke test (your own key, Phase 1 POC)
```bash
cd apps/api && STITCH_API_KEY=<your key> npm run poc
```
This creates a project, generates a screen and downloads its HTML. It uses only the key you pass in, and the server never reads this variable.
