import { requireOptionalNativeModule } from 'expo-modules-core';

interface DesignoPower {
  isIgnoringBatteryOptimizations(): boolean;
  isBackgroundRestricted(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
  openAppDetails(): boolean;
  openAutostartSettings(): boolean;
}
/** null on iOS / web or in builds without the native module. */
export const Power = requireOptionalNativeModule<DesignoPower>('DesignoPower');
