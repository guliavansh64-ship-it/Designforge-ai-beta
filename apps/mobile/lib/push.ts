import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let current: string | null = null;
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
  await Notifications.setNotificationChannelAsync('default', { name: 'General', importance: Notifications.AndroidImportance.HIGH, lightColor: '#7c5cff', sound: 'default' });
  await Notifications.setNotificationChannelAsync('jobs', { name: 'Design generation', importance: Notifications.AndroidImportance.HIGH, sound: 'default' });
  const { status: existing } = await Notifications.getPermissionsAsync();
  const status = existing === 'granted' || !opts.prompt ? existing : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const { data } = await Notifications.getDevicePushTokenAsync();
  const token = typeof data === 'string' ? data : String(data ?? '');
  await save(token);
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
