import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Power } from '../modules/designo-power';

/**
 * Mandatory permissions. Every value is READ FROM ANDROID — a tick is only shown when the setting is
 * really enabled, never just because the user tapped a button.
 */
export interface PermState { notifications: boolean; battery: boolean; background: boolean }

export async function readPermissions(): Promise<PermState> {
  const notifications = (await Notifications.getPermissionsAsync().catch(() => ({ status: 'denied' }))).status === 'granted';
  if (Platform.OS !== 'android' || !Power) return { notifications, battery: true, background: true };
  let battery = false; let background = false;
  try { battery = Power.isIgnoringBatteryOptimizations(); } catch { battery = false; }
  try { background = !Power.isBackgroundRestricted(); } catch { background = false; }
  return { notifications, battery, background };
}
export const allGranted = (p: PermState) => p.notifications && p.battery && p.background;
