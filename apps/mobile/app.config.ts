import type { ExpoConfig } from 'expo/config';
import fs from 'node:fs';

// google-services.json is optional for preview builds (push notifications need it; sign-in uses the web client ID).
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? (fs.existsSync('./google-services.json') ? './google-services.json' : undefined);

// All values here are public identifiers. Secrets (Stitch/Gemini keys, Razorpay secret,
// Firebase service account) live ONLY on the backend and are never bundled into the APK.
const config: ExpoConfig = {
  name: 'DesignForge AI',
  slug: 'designforge-ai',
  scheme: 'designforge',
  version: process.env.EXPO_PUBLIC_ALLOW_API_OVERRIDE === '1' ? '1.0.0-test' : '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  splash: { image: './assets/icon.png', resizeMode: 'contain', backgroundColor: '#0a0a0f' },
  android: {
    package: process.env.ANDROID_PACKAGE ?? 'app.designforge.ai',
    versionCode: 1,
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#0a0a0f' },
    ...(googleServicesFile && { googleServicesFile }),
    permissions: ['POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'VIBRATE', 'WAKE_LOCK'],
    // Least privilege: strip permissions that libraries/templates add but this app never uses.
    // (Document picker uses the Storage Access Framework; sharing uses content URIs; no biometrics/overlay/phone state.)
    blockedPermissions: [
      'android.permission.RECORD_AUDIO', 'android.permission.READ_CONTACTS',
      'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_PHONE_STATE', 'android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT',
    ],
    allowBackup: false,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    '@react-native-google-signin/google-signin',
    // Monochrome status-bar icon + default channel, so pushes shown by Android while the app is CLOSED look right.
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#7c5cff', defaultChannel: 'default' }],
    './plugins/withReleaseSigning',
    './plugins/withTestCleartext',
  ],
  experiments: { typedRoutes: false },
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID } },
};
export default config;
