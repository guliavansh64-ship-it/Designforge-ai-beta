# DesignForge API reference

Base URL: `https://<api-host>/api`. JSON in and out unless noted.

**Auth:** `Authorization: Bearer <Firebase ID token>`. The web uses `getIdToken()` and Android uses `auth().currentUser.getIdToken()`. Tokens are verified with `checkRevoked`, and suspended users get `403 ACCOUNT_SUSPENDED`. Android also sends `x-client: android`, which is used only for analytics and notification routing.

**Errors** always look like this:
```json
{ "error": { "code": "INSUFFICIENT_CREDITS", "message": "Human readable", "action": "buy_credits" } }
```
| Code | HTTP | `action` hint |
|---|---|---|
| UNAUTHENTICATED | 401 | sign in |
| ACCOUNT_SUSPENDED / FORBIDDEN | 403 | — |
| NOT_FOUND | 404 | — |
| VALIDATION_ERROR | 400/413 | — |
| INSUFFICIENT_CREDITS | 402 | `buy_credits` |
| FEATURE_LOCKED / PROJECT_LIMIT_REACHED | 403 | `upgrade_plan` |
| STITCH_NOT_CONNECTED / STITCH_AUTH_FAILED / STITCH_NO_ACCESS | 412/401/403 | `open_integrations` |
| STITCH_RATE_LIMITED | 429 | wait (Google quota) |
| GEMINI_NOT_CONNECTED / GEMINI_ERROR | 412/401/403/429/502 | `open_integrations` |
| STITCH_ERROR | 400/404/502 | retry |
| PAYMENT_PENDING | 402 | wait for webhook |
| EXPORT_VALIDATION_FAILED / IMPORT_FAILED | 422 | see report |
| TIMEOUT | 504 | retry (credits refunded) |
| PAYMENT_INVALID / PAYMENTS_UNAVAILABLE | 400/503 | — |
| MAINTENANCE_MODE | 503 | — |
| RATE_LIMITED | 429 | — |
| INTERNAL_ERROR | 500 | no internals leaked |

**Rate limits** (per user, falling back to per IP):

| Scope | Limit |
|---|---|
| Global | 300/min |
| Generation endpoints | 12/min |
| Connect key | 10 per 15 min |
| Payments | 20/min |

**Idempotency:** every endpoint that spends credits requires `idempotencyKey` (8–64 chars, `[A-Za-z0-9_-]`). Retrying with the same key returns the original job and never charges twice.

**Async jobs:** generation endpoints return `202 { job }`. Poll `GET /jobs/:id` with backoff (the clients poll every 1.5s, backing off to 6s). Job statuses are `queued | running | succeeded | failed | cancelled`. Credits are reserved when the job starts and **refunded automatically** on failure or cancel (`job.refunded: true`).

---

## Public (no auth)
| Method | Path | Response |
|---|---|---|
| GET | `/health` (no `/api` prefix) | `{ ok, env, time }` |
| GET | `/plans` | `{ plans, packs, razorpayKeyId }` |
| GET | `/announcements` | active announcements |
| GET | `/status` | `{ api, maintenance, generationSuccessRateToday, stitchEndpoint }` |
| GET | `/templates?category&q&featured` | `{ templates }` (no HTML) |
| GET | `/templates/:id` | `{ template }` with HTML |
| GET | `/assets/:id?t=<token>` | binary; owner or signed token |
| POST | `/webhooks/razorpay` | raw body, verified with `X-Razorpay-Signature` |

## Me
| Method | Path | Body / notes |
|---|---|---|
| GET | `/me` | `{ user: {uid, email, displayName, photoURL, isAdmin, adminRole}, plan, subscription, credits, connections, preferences }` |
| PATCH | `/me` | `{ displayName?, preferences?: { theme, defaultDevice, defaultModel, notificationPrefs } }` |
| POST / DELETE | `/me/push-token` | `{ token }` (Expo push token) |
| POST | `/me/logout-all` | revokes all refresh tokens |
| GET | `/me/export` | JSON data export (DPDP/GDPR) |
| DELETE | `/me` | `{ confirm: "DELETE" }` |

## Connections (`:p` = `stitch` \| `gemini`)
| Method | Path | Notes |
|---|---|---|
| GET | `/connections` | status and last-4 hint only, never the key |
| POST | `/connections/:p` | `{ apiKey }` → verified, encrypted, stored |
| POST | `/connections/:p/verify` | `{ ok, connections }` |
| DELETE | `/connections/:p` | `{ ok, revokeUrl, connections }` |

## Projects
| Method | Path | Notes |
|---|---|---|
| GET | `/projects?q&kind&folder&archived&sort=updated\|created\|name&shared&limit&cursor` | `{ projects, nextCursor }` |
| POST | `/projects` | `{ name, kind: ui\|website\|logo\|improve, deviceType, description?, folder? }` (plan project limit enforced) |
| GET / PATCH / DELETE | `/projects/:id` | PATCH: `{ name?, description?, folder?, archived? }` |
| POST | `/projects/:id/duplicate` | |
| POST | `/projects/:id/pages` | `{ name }` |
| PATCH / DELETE | `/projects/:id/pages/:pageId` | |
| POST | `/projects/:id/share` | `{ email, role: viewer\|editor\|none }` (Premium/Lifetime) |
| GET | `/folders` | |

## Versions
| Method | Path | Notes |
|---|---|---|
| GET | `/projects/:id/versions?pageId&limit` | metadata (newest first) |
| GET | `/versions/:vid` | includes `html`, `audit` |
| POST | `/versions/:vid/restore` | makes it the page head (non-destructive) |
| POST | `/projects/:id/pages/:pageId/save` | `{ html, parentVersionId?, note? }` (manual edit; HTML sanitised) |
| POST | `/versions/:vid/audit` | free heuristic audit |

## Generation (202 `{ job }`)
All are under `/projects/:id/`, are owner-only, and use the **owner's own** Stitch or Gemini key.

| Path | Body | Credits |
|---|---|---|
| `generate` | `{ prompt, deviceType?, model: GEMINI_3_FLASH\|GEMINI_3_1_PRO, pageId?, newPageName?, category?, style?, idempotencyKey }` | 2 (Flash) / 5 (Pro) |
| `edit` | `{ prompt, pageId, deviceType?, model?, idempotencyKey }` | 2 |
| `variants` | `{ prompt, pageId, count 1–5, creativeRange: REFINE\|EXPLORE\|REIMAGINE, idempotencyKey }` | 4 |
| `improve` | `{ pageId, instructions?, autoIterate, maxIterations 1–5 (plan-capped), targetScore 50–100, importAssetBase64?, importExt?, idempotencyKey }` | 3 per iteration actually run |
| `logos` | `{ brandName, industry, styles[], colorHints?, tagline?, count 1–4, idempotencyKey }` (Gemini) | 4 per 2 concepts |

## Jobs
`GET /jobs/:id` (includes `improvementHistory[]` with before/after scores and the fixed checklist) · `GET /projects/:id/jobs` · `POST /jobs/:id/cancel`

## Chat assistant
`GET /projects/:id/chat` → `{ messages }`

`POST /projects/:id/chat { message, pageId, model?, deviceType?, imageBase64?, imageExt?, idempotencyKey }` → `{ message, job? }`. The intent router answers questions, generates React code for free, or starts an edit, variants or improve job, which costs credits as above.

## Exports
- `POST /projects/:id/export { format: html|react, pageIds?, idempotencyKey }` → `application/zip`. The `x-export-report` header carries base64 JSON `{ files, assetsDownloaded, assetsFailed, warnings, errors }`. Returns 422 if validation fails, and **you are only charged on success** (1 credit for HTML, 2 for React).
- `GET /versions/:vid/brand-kit` → zip containing PNGs, an SVG for wordmarks, the palette and a README.

## Billing
| Method | Path | Body |
|---|---|---|
| GET | `/billing/summary` | `{ credits, transactions, payments }` |
| GET | `/billing/usage` | per-day usage |
| POST | `/billing/orders` | `{ purchase: {kind:'plan', planId, cycle} \| {kind:'pack', packId}, coupon? }` → `{ orderId, amount, keyId, description }`. The amount is computed on the server. |
| POST | `/billing/verify` | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` → grants (idempotent, ref `order_<id>`) |
| POST | `/billing/subscriptions` | `{ planId: pro\|premium, cycle }` → `{ subscriptionId, keyId }` |
| POST | `/billing/subscriptions/verify` | signature check; **activation happens only via webhook** |
| POST | `/billing/cancel` | cancel at period end |
| POST | `/billing/downgrade` | `{ toPlanId }` |
| POST | `/billing/redeem` | `{ code }` → `{ ok, credits }` |
| GET | `/billing/invoices/:id` | printable HTML invoice |

## Support & notifications
`GET|POST /tickets { subject, type: question|bug|feature|billing|account, message, projectId? }` · `POST /tickets/:id/reply { message }` · `GET /notifications` → `{ notifications, unread }` · `POST /notifications/read { ids? }`

## Templates
`POST /templates/:id/favorite { favorite }` · `POST /templates/:id/use` → `{ projectId }`

## Admin (`/api/admin`)
Every route requires the `adminRole` custom claim **and** an active `admin_users/{uid}` doc. **All GET routes are readable by every admin role.** Mutations need the roles listed below; `owner` always passes. Every mutation writes to `admin_audit_logs` with the actor, action, target and details (including the reason where one is required).

| Endpoint | Mutating roles |
|---|---|
| `GET /stats` → `{ users, activeUsers7d, newRegistrations30d, paidSubscribers, projects, generationsSucceeded, generationsFailed, successRate, revenueMonthInr, revenueYearInr, daily[] }` | — |
| `GET /users?q&status`, `GET /users/:uid` | — |
| `POST /users/:uid/status {status, reason}` | admin, support |
| `DELETE /users/:uid {reason}` | admin |
| `POST /users/:uid/credits {amount, reason, ref}` | admin, finance |
| `POST /users/:uid/subscription {planId, days, reason}` | admin, finance |
| `GET /plans`, `PUT /plans/:id` | admin |
| `GET /subscriptions`, `GET /payments?status`, `POST /payments/:orderId/refund {reason}` | admin, finance |
| `GET /coupons`, `PUT /coupons/:code {type, value, maxRedemptions, appliesTo, active}` | admin, finance |
| `GET /templates`, `PUT /templates/:id`, `DELETE /templates/:id` | admin |
| `GET /settings`, `PUT /settings` (maintenance, feature flags, limits) | admin |
| `GET /announcements`, `POST /announcements`, `PATCH /announcements/:id` | admin |
| `GET /tickets?status`, `POST /tickets/:id/reply {message, status}` | admin, support |
| `GET /errors`, `GET /audit-logs` | — |
