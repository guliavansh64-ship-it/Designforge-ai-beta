/**
 * TEST BUILDS ONLY: when EXPO_PUBLIC_ALLOW_API_OVERRIDE=1, allow http:// so a tester can point the app
 * at an API running on their PC over local Wi-Fi (e.g. http://192.168.1.20:8080).
 * Production builds (variable unset) keep Android's default: HTTPS only.
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withTestCleartext(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    if (process.env.EXPO_PUBLIC_ALLOW_API_OVERRIDE === '1') app.$['android:usesCleartextTraffic'] = 'true';
    else delete app.$['android:usesCleartextTraffic'];
    return cfg;
  });
};
