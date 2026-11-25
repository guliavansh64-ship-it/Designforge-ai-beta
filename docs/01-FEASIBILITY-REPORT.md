# DesignForge AI — Technical Feasibility Report
**Date:** 25 Nov 2026 | **Status:** Phase 1 Research Complete | **Verdict: FEASIBLE with BYO-Key architecture**

## 1. Executive Summary
DesignForge AI is buildable as a real commercial SaaS **without** a shared admin AI key, **without** scraping Stitch, and **without** embedding stitch.withgoogle.com. Google officially supports programmatic access via:
- **Stitch MCP Server:** `https://stitch.googleapis.com/mcp` (remote HTTP, Model Context Protocol)
- **Official SDK:** `@google/stitch-sdk` (TypeScript, Apache-2.0, github.com/google-labs-code/stitch-sdk)
- **Official docs:** stitch.withgoogle.com/docs/mcp/setup, docs.cloud.google.com/mcp/supported-products

## 2. What Google Officially Supports (verified Nov 2026)

### 2.1 Authentication — two official methods
| Method | How | Best for DesignForge |
|---|---|---|
| **A. Stitch API Key (RECOMMENDED)** | User creates key at stitch.withgoogle.com → Settings → API Keys. Sent as `X-Goog-Api-Key` header. Long-lived, no hourly expiry. | ✅ Per-user BYO key. User pastes own key once in Integrations. We store encrypted, call MCP with *their* key. No GCP project needed. |
| **B. OAuth Bearer Token** | `gcloud auth application-default print-access-token` + `Authorization: Bearer <token>` + `X-Goog-User-Project: <GCP_PROJECT>`. Token expires ~1 hour. Requires user to have a Google Cloud project + enable `stitch.googleapis.com` + IAM `roles/serviceusage.serviceUsageConsumer`. | ⚠️ Too much friction for consumers. Offer as "Advanced" later. Do NOT build consumer OAuth consent flow expecting every Google account to have a GCP project. |

**Critical correction to original brief:** "Google OAuth for Stitch" is NOT a simple one-click consent for normal users. The supported consumer path is the **Stitch API Key**. DesignForge therefore uses:
- **Firebase Google Sign-In** = DesignForge login (separate)
- **Stitch API Key (user-owned)** = Stitch authorization (separate consent step, as required)

This satisfies: individual accounts, no shared admin key, no password collection, no cookie sharing, no scraping.

### 2.2 MCP Tools available (15 tools, discovered via SDK `listTools()`)
- Projects: `create_project`, `get_project`, `list_projects`
- Screens: `list_screens`, `get_screen`, `generate_screen_from_text` (model: `GEMINI_3_FLASH` / `GEMINI_3_1_PRO`), `edit_screens`
- Design Systems: `create_design_system`, `update_design_system`, `list_design_systems`, `apply_design_system`
- SDK high-level API: `new Stitch(client).projects()`, `project.generate(prompt, deviceType)`, `screen.edit()`, `screen.variants()`, `screen.getHtml()`, `screen.getImage()`, `project.createDesignSystem()`
- Device types: `MOBILE | DESKTOP | TABLET | AGNOSTIC`

### 2.3 What Stitch does NOT do
- ❌ **No logo / image generation.** Stitch generates UI screens (HTML + screenshot). Logo Studio needs a separate provider.
  - **Compliant alternative implemented:** BYO **Gemini API Key** (aistudio.google.com) for `gemini-2.5-flash-image` logo generation, stored encrypted the same way. Fallback: Pollinations (free, no key) clearly labelled "Preview — BYO Gemini for production".
- ❌ **No direct Figma export.** Only advertise HTML/React export. Figma stays hidden until a real implementation exists.
- ❌ **No guaranteed consumer OAuth token flow** without GCP project (see 2.1).

## 3. Architecture Decision (Free-Tier-First, Honest Limits)

| Layer | Choice | Free Tier (Nov 2026) | Limit / Upgrade Path |
|---|---|---|---|
| Web Frontend | Cloudflare Pages (Vite React) | Unlimited bandwidth, 500 builds/mo, 100 projects | Fine to scale |
| Backend API | Node/Express on **Render Free** (or Fly.io) — NOT Workers for generation | Render free sleeps after 15 min idle (cold start ~30s). Workers free = 100k req/day but **10ms CPU** — too low for 30–120s Stitch calls. | Upgrade: Render $7/mo or Fly.io. Workers can later be used as edge gateway only. |
| Auth + DB | Firebase Auth + Firestore Spark | 50k reads/day, 20k writes/day, 1 GiB stored | Blaze pay-as-you-go: $0.06/100k reads, $0.18/100k writes. Set budget alerts. |
| Image Storage | Firestore chunked blobs (default) or Cloudinary free (25 credits/mo). Firebase Storage is **not used** | Cloudinary free tier limited | Upgrade to Cloudinary paid or S3-compatible R2. |
| Payments | Razorpay (test mode first) | No monthly fee, % per txn | Real KYC needed for live mode. |
| Android | Expo React Native (EAS Build) | EAS free builds limited/mo | EAS paid for production builds. |

**No service is "unlimited free" in production.** Costs are driven by Firestore reads (real-time listeners) — mitigated by pagination + no always-on listeners.

## 4. Security Model
- Stitch API keys + Gemini keys: **AES-256-GCM encrypted at rest** (server `ENCRYPTION_KEY`, never in client/APK), decrypted only in-memory per request, never logged, never returned to frontend (only `connected: true/false` + last-4).
- Credits: **server-side transactional** Firestore `runTransaction` — deduct once, refund on failure, idempotency key per generation job.
- Razorpay: verify `razorpay_signature` (HMAC-SHA256) + webhook signature server-side. Never trust frontend success.
- Preview: generated HTML rendered in `sandbox="allow-scripts"` iframe with `srcDoc`, CSP blocking external scripts.
- Firestore Rules: every doc has `ownerId == request.auth.uid`; admin via custom claim `admin: true` (set via Admin SDK, no public admin signup).

## 5. Phase 1 POC — Smallest Working Integration (Do This First)
```bash
# 1. Get your own key: stitch.withgoogle.com → Settings → API Keys → Create
export STITCH_API_KEY="your-key"
cd apps/api && npm install
npm run poc   # calls listTools() → create_project → generate_screen_from_text → getHtml()
# Expected: real HTML URL returned. If 403: account lacks Stitch access — visit stitch.withgoogle.com first.
```
POC code: `apps/api/src/poc.ts`. **Do not proceed to full build until POC returns real HTML.**

## 6. Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Stitch MCP is Beta, tool schema may change | Pin `@google/stitch-sdk` version, wrap all calls in `services/stitch.ts`, add contract test on `listTools()` |
| User has no Stitch access / quota exhausted (350/mo free) | Clear error mapping: `STITCH_NO_ACCESS`, `STITCH_QUOTA`, prompt user to check stitch.withgoogle.com |
| API key leaked by user | Revoke in Stitch settings; DesignForge disconnect deletes encrypted copy |
| Razorpay webhook replay | Idempotency: store `paymentId`, ignore duplicates |
| Firestore free quota exceeded | Pagination (20/page), cache templates, budget alerts, Blaze upgrade path documented |

## 7. Go / No-Go
**GO** — Build with BYO Stitch API Key + BYO Gemini Key for logos. All other features (studios, improvement via `edit_screens`, HTML/React ZIP export, credits, Razorpay, admin, Android) are standard engineering on top of this engine.
