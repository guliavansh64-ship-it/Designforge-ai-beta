# DesignForge AI

An AI design platform for UI screens, websites and brand identities. Generation runs in **each user's own Google Stitch account** (logos use the user's own Gemini key). The platform has three clients and one backend:

| Part | Stack | Path |
|---|---|---|
| API | Node 20, Express, TypeScript, Firebase Admin, Razorpay, `@google/stitch-sdk` | `apps/api` |
| Web app + admin panel | React 18, TypeScript, Vite, Tailwind, Framer Motion, Lucide | `apps/web` |
| Android app | Expo SDK 52, React Native 0.76, expo-router (native screens, not a WebView) | `apps/mobile` |
| Shared types/plans/costs | TypeScript | `packages/shared` |

## Quick start (local)
```bash
npm install                                   # API + web + shared
cp apps/api/.env.example apps/api/.env        # fill in (see docs/03-ENVIRONMENT.md)
cp apps/web/.env.example apps/web/.env
npm --workspace packages/shared run build
npm run dev:api                               # http://localhost:8080
npm run dev:web                               # http://localhost:5173 (proxies /api)

npm run install:mobile                        # Android app (separate, not hoisted)
cd apps/mobile && npx expo start --dev-client
```
To try only the UI without any credentials: `VITE_UI_PREVIEW=1 npm run dev:web`. This shows clearly bannered sample data and works in dev builds only.

## Verify everything
```bash
npm run check     # typecheck API+web → 52 API tests → production builds → Android typecheck
```

## Documentation
| # | Doc |
|---|---|
| 01 | [Feasibility report](docs/01-FEASIBILITY-REPORT.md): Stitch API research, what is and isn't possible, architecture |
| 02 | [Connecting Stitch (user guide)](docs/02-STITCH-CONNECTION-GUIDE.md) |
| 03 | [Environment & credentials](docs/03-ENVIRONMENT.md): Firebase, Razorpay, encryption key, first admin |
| 04 | [API reference](docs/04-API.md) |
| 05 | [Testing](docs/05-TESTING.md): automated suite and manual end-to-end plan |
| 06 | [Security model](docs/06-SECURITY.md) |
| 07 | [Deployment](docs/07-DEPLOYMENT.md): Render/Fly, Cloudflare Pages, EAS/Play Store, free-tier limits |
| 08 | [Production checklist](docs/08-PRODUCTION-CHECKLIST.md) |
| — | [Android app README](apps/mobile/README.md) |
| — | Screenshots: `docs/screens/` |

Infrastructure files: `firebase.json`, `firestore.rules` (deny-all client access), `firestore.indexes.json` (37 composite indexes derived from the API's queries), `render.yaml`, `apps/api/Dockerfile`, `apps/web/public/_headers`, `apps/web/functions/api/[[path]].ts` (Pages proxy).

## Honest limits (by design)
- **No shared AI key.** Every user connects their own Stitch key (and a Gemini key for logos). Their quota is Google's, separate from DesignForge credits.
- **Stitch generates UI, not images.** Logos use Gemini image models. AI logos are raster; wordmark concepts also get a real SVG.
- **No Figma export.** There is no reliable public API for it, so the product doesn't claim one.
- **Audit scores are DesignForge heuristics** (a transparent checklist), not objective quality ratings.
- **Stitch connection uses API keys, not OAuth.** Stitch's OAuth path requires each user to have a Google Cloud project with IAM setup (see the feasibility report). API keys are the realistic per-user option today and are encrypted at rest.
- **Free hosting sleeps.** See the deployment doc for what that means and when to upgrade.
- **Play Store payments policy** for digital goods needs a business decision (07-DEPLOYMENT §4).

## First admin
There is no public admin signup:
```bash
cd apps/api && npm run make-admin -- you@example.com owner
```

## Setup checklist
Everything you need to provide (Firebase web config, secrets, Razorpay, SHA-1): **[docs/09-WHAT-I-NEED.md](docs/09-WHAT-I-NEED.md)**. Firebase Storage is not used.
