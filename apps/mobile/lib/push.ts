import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let current: string | null = null;

/** Registers an Expo push token with OUR backend (POST /api/me/push-token). Requires a physical device. */
export async function registerForPush() {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'General', importance: Notifications.AndroidImportance.DEFAULT, lightColor: '#7c5cff' });
    await Notifications.setNotificationChannelAsync('jobs', { name: 'Design generation', importance: Notifications.AndroidImportance.HIGH });
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  const status = existing === 'granted' ? existing : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  if (data !== current) { await api.post('/me/push-token', { token: data }); current = data; }
  return data;
}
export async function unregisterPush() {
  if (current) { await api.del('/me/push-token', { token: current }); current = null; }
}
