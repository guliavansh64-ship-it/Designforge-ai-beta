import { requireOptionalNativeModule } from 'expo-modules-core';

interface DesignoPower {
  isIgnoringBatteryOptimizations(): boolean;
  isBackgroundRestricted(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
  openAppDetails(): boolean;
  openAutostartSettings(): boolean;
  /** Android 10+: copies a cache file into Downloads/Designo; resolves to its content:// URI. */
  saveToDownloads?(srcPath: string, fileName: string, mime: string): Promise<string>;
  openFile?(uri: string, mime: string): boolean;
  openDownloads?(): boolean;
}
/** null on iOS / web or in builds without the native module. */
export const Power = requireOptionalNativeModule<DesignoPower>('DesignoPower');
