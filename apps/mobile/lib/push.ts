import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let current: string | null = null;

/**
 * Android notification channels. Created at app start (no permission needed) so that pushes which
 * Android displays by itself while the app is CLOSED always land in a high-importance channel.
 */
export async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', { name: 'General', importance: Notifications.AndroidImportance.HIGH, lightColor: '#7c5cff', sound: 'default', vibrationPattern: [0, 250, 150, 250], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, showBadge: true });
  await Notifications.setNotificationChannelAsync('jobs', { name: 'Design ready / failed', importance: Notifications.AndroidImportance.HIGH, sound: 'default', vibrationPattern: [0, 250, 150, 250], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, showBadge: true });
}

export async function notificationPermission() {
  return (await Notifications.getPermissionsAsync()).status;
}
let listening = false;

async function save(token: string) {
  if (!token || token === current) return;
  await api.post('/me/push-token', { token, kind: 'fcm' });
  current = token;
}

/**
 * Registers this device's native FCM token with OUR backend (POST /api/me/push-token).
 * The server sends pushes with firebase-admin (no Expo/EAS account needed). Physical devices only.
 */
export async function registerForPush(opts: { prompt?: boolean } = { prompt: true }) {
  if (!Device.isDevice || Platform.OS !== 'android') return null;
  await ensureChannels();
  const { status: existing } = await Notifications.getPermissionsAsync();
  const status = existing === 'granted' || !opts.prompt ? existing : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const { data } = await Notifications.getDevicePushTokenAsync();
  const token = typeof data === 'string' ? data : String(data ?? '');
  // The free server may be waking up (~30-50 s) — retry so the token is never silently lost,
  // otherwise this phone would receive no pushes at all (closed or open).
  for (let i = 0; ; i++) {
    try { await save(token); break; } catch (e) { if (i >= 4) throw e; await new Promise((r) => setTimeout(r, 4000 * (i + 1))); }
  }
  if (!listening) {
    listening = true;
    // FCM rotates tokens occasionally — keep the server in sync.
    Notifications.addPushTokenListener((t) => { save(String(t.data)).catch(() => undefined); });
  }
  return token;
}
export async function unregisterPush() {
  if (current) { await api.del('/me/push-token', { token: current }).catch(() => undefined); current = null; }
}
