import { Linking, NativeModules, Platform } from 'react-native';

const { SystemPermissions } = NativeModules;

/**
 * Checks whether battery optimization is disabled ("Don't optimise / Allow" / Unrestricted) for this app.
 * Returns true if the app is exempt from battery optimizations.
 */
export async function isBatteryOptimizationIgnored(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (SystemPermissions?.isBatteryOptimizationIgnored) {
    try {
      const ignored = await SystemPermissions.isBatteryOptimizationIgnored();
      return Boolean(ignored);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Requests the system dialog to ignore battery optimizations directly,
 * or opens the battery optimization settings if the direct dialog is unavailable.
 */
export async function requestIgnoreBatteryOptimizations(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (SystemPermissions?.requestIgnoreBatteryOptimizations) {
    try {
      await SystemPermissions.requestIgnoreBatteryOptimizations();
      return;
    } catch {
      // Fall through to Linking fallback
    }
  }
  try {
    await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
  } catch {
    Linking.openSettings();
  }
}

/**
 * Checks whether background execution is restricted by the user.
 * Returns true if background activity IS restricted, false if background activity is allowed.
 */
export async function isBackgroundRestricted(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (SystemPermissions?.isBackgroundRestricted) {
    try {
      const restricted = await SystemPermissions.isBackgroundRestricted();
      return Boolean(restricted);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Opens OEM autostart management (Vivo, Xiaomi, Oppo, etc.) or App Info settings.
 */
export async function openAutostartSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (SystemPermissions?.openAutostartSettings) {
    try {
      await SystemPermissions.openAutostartSettings();
      return;
    } catch {
      // Fall through to Linking
    }
  }
  Linking.openSettings();
}
