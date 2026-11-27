#!/usr/bin/env bash
# Build a signed release APK locally (no EAS account needed).
# Needs: JDK 17, Android SDK (ANDROID_HOME) with platform 35, build-tools 35, NDK 26.1.10909125, CMake 3.22.1.
# Config: apps/mobile/.env (EXPO_PUBLIC_*), optional ./google-services.json.
# Signing: DF_KEYSTORE_PATH / DF_KEYSTORE_PASSWORD / DF_KEY_ALIAS / DF_KEY_PASSWORD (else debug-signed).
# Optional: DF_ABIS="arm64-v8a" (faster, modern phones only), DF_LOW_MEMORY=1 (for <4 GB RAM machines).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:?Set ANDROID_HOME to your Android SDK}"
export CI=1 EXPO_NO_TELEMETRY=1 NODE_ENV=production
npx expo prebuild --platform android --clean --no-install
# EXPO_PUBLIC_* values are inlined at transform time; a stale Metro cache would ship OLD config.
rm -rf "${TMPDIR:-/tmp}"/metro-* "${TMPDIR:-/tmp}"/haste-map-* node_modules/.cache android/app/build/generated/assets/createBundleReleaseJsAndAssets
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
(cd android && ./gradlew assembleRelease --no-daemon --console=plain)
VERSION=$(node -p "require('./package.json').version")
mkdir -p dist-apk
cp android/app/build/outputs/apk/release/app-release.apk "dist-apk/Designo-${VERSION}.apk"
echo "APK: $(pwd)/dist-apk/Designo-${VERSION}.apk"
