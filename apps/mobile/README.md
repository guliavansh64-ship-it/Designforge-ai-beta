# DesignForge AI — Android app (Expo SDK 52, React Native 0.76, expo-router 4)

This is a native Android client for the same backend as the web app. It is **not a WebView wrapper**: all screens are native React Native. A WebView is used only to preview the generated design HTML, inside a sandbox with no network access.

## Features
| Area | Screens |
|---|---|
| Account | Google Sign-In (native), sign out, sign out everywhere, data export, account deletion |
| Dashboard | credits, plan, Stitch connection card, quick actions, recent projects, announcements |
| Studio | App UI / Website: prompt, device, model, style; job progress with cancel and automatic refund |
| Projects | search, mine/shared/archived, duplicate, archive, delete |
| Project | multi-page preview (mobile/tablet/desktop), AI edit, variants, improve, add page, versions (preview/restore/use variant), heuristic audit, HTML/React export via the share sheet |
| Assistant | per-project chat that applies changes as new versions |
| Logo Studio | Gemini-powered concepts, palette, typography, brand-kit ZIP |
| Improve | from a project or an uploaded HTML/PNG/JPG/WEBP; 9-stage progress; auto-iterate on Pro |
| Integrations | Stitch and Gemini key connect/verify/replace/disconnect with explicit consent; keys never stored on the device |
| Billing | plans (auto-renew or one-time), credit packs, promo codes, transactions; native Razorpay checkout (UPI/cards/netbanking) **verified by the server** |
| Notifications | in-app list plus push (channels for default and jobs); tapping a notification opens the project |
| Support | FAQ and tickets |

## Run
```bash
cp .env.example .env          # fill in EXPO_PUBLIC_* (public values only)
npm install --legacy-peer-deps
npx eas build -p android --profile development   # once: builds the dev client APK
npx expo start --dev-client
```
**Expo Go is not supported**: Google Sign-In and Razorpay are native modules.

The app is kept **outside** the root npm workspaces on purpose, because Metro and React Native native modules break when hoisted into the root.

## Build an APK locally (no Expo account)
```bash
# one-time: JDK 17 + Android SDK (platform 35, build-tools 35, NDK 26.1.10909125, CMake 3.22.1)
export ANDROID_HOME=~/Android/Sdk JAVA_HOME=/path/to/jdk17
set -a; . credentials/keystore.env; set +a     # your upload key (never commit it)
DF_ABIS=arm64-v8a npm run build:apk:local      # → dist-apk/DesignForgeAI-<version>.apk
```
- `DF_ABIS=arm64-v8a` builds for 64-bit ARM phones only (nearly all phones since 2019) and is about 3× faster. Omit it to support all ABIs. Packaging always matches the compiled ABIs (`plugins/withReleaseSigning.js`).
- `DF_LOW_MEMORY=1` tunes Gradle for machines with less than 4 GB of RAM.
- Without the `DF_KEYSTORE_*` variables the APK is debug-signed (testing only).
- Animations use `react-native-reanimated` (native C++). After adding or upgrading native deps, re-run `expo prebuild` before Gradle. All motion respects the system *Reduce motion* setting (`components/motion.tsx`).
- Config you must supply before a real build: see `docs/09-WHAT-I-NEED.md`.
- **Keep the same keystore forever** for an app. Android refuses to update an installed APK signed with a different key. Register its SHA-1 in Firebase for Google Sign-In.

## Verify
```bash
npm run typecheck     # tsc --noEmit (strict)
npm run doctor        # expo-doctor
npx expo export --platform android   # bundles the JS exactly as a release build would
```

Builds and Play Store steps are in `../../docs/07-DEPLOYMENT.md` §4. Environment variables are in `../../docs/03-ENVIRONMENT.md` §6.
