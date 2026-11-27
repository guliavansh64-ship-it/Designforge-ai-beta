const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODULE_KT = `package app.designforge.ai

import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SystemPermissionsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SystemPermissions"

    @ReactMethod
    fun areNotificationsEnabled(promise: Promise) {
        try {
            val enabled = NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled()
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun isBatteryOptimizationIgnored(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val powerManager = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                val isIgnoring = powerManager?.isIgnoringBatteryOptimizations(reactApplicationContext.packageName) ?: false
                promise.resolve(isIgnoring)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            val packageName = reactApplicationContext.packageName
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            // Fallback to IGNORE_BATTERY_OPTIMIZATION_SETTINGS
            try {
                val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(fallback)
                promise.resolve(true)
            } catch (err: Exception) {
                try {
                    val appSettings = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:\${reactApplicationContext.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    reactApplicationContext.startActivity(appSettings)
                    promise.resolve(true)
                } catch (e3: Exception) {
                    promise.reject("BATTERY_ERROR", e3.message)
                }
            }
        }
    }

    @ReactMethod
    fun isBackgroundRestricted(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val am = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                val restricted = am?.isBackgroundRestricted ?: false
                promise.resolve(restricted)
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openAutostartSettings(promise: Promise) {
        val packageName = reactApplicationContext.packageName
        val pm = reactApplicationContext.packageManager
        val manufacturer = (Build.MANUFACTURER ?: "").lowercase()
        val brand = (Build.BRAND ?: "").lowercase()

        val candidateIntents = mutableListOf<Intent>()

        // Vivo / iQOO
        if (manufacturer.contains("vivo") || manufacturer.contains("iqoo") || brand.contains("vivo") || brand.contains("iqoo")) {
            candidateIntents.add(Intent().setComponent(ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")))
            candidateIntents.add(Intent().setComponent(ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager")))
            candidateIntents.add(Intent().setComponent(ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")))
            candidateIntents.add(Intent().setComponent(ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.PurviewTabActivity")))
        }

        // Xiaomi / Redmi / Poco
        if (manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco")) {
            candidateIntents.add(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
        }

        // Oppo / Realme / OnePlus
        if (manufacturer.contains("oppo") || manufacturer.contains("realme") || manufacturer.contains("oneplus")) {
            candidateIntents.add(Intent().setComponent(ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")))
            candidateIntents.add(Intent().setComponent(ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")))
            candidateIntents.add(Intent().setComponent(ComponentName("com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity")))
        }

        // Huawei / Honor
        if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
            candidateIntents.add(Intent().setComponent(ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")))
            candidateIntents.add(Intent().setComponent(ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")))
        }

        // Fallback: App info details
        candidateIntents.add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:$packageName")
        })

        var launched = false
        for (intent in candidateIntents) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (intent.resolveActivity(pm) != null) {
                    reactApplicationContext.startActivity(intent)
                    launched = true
                    break
                }
            } catch (ignored: Exception) {
            }
        }

        if (!launched) {
            try {
                val appSettings = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(appSettings)
                launched = true
            } catch (ignored: Exception) {
            }
        }

        promise.resolve(launched)
    }
}
`;

const PACKAGE_KT = `package app.designforge.ai

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class SystemPermissionsPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(SystemPermissionsModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
`;

module.exports = function withSystemPermissions(config) {
  // 1. Ensure REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is in AndroidManifest
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const hasPerm = manifest['uses-permission'].some(
      (p) => p.$ && p.$['android:name'] === 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
    );
    if (!hasPerm) {
      manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS' }
      });
    }
    return cfg;
  });

  // 2. Ensure Kotlin files and MainApplication registration survive prebuild
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const targetDir = path.join(
        projectRoot,
        'android/app/src/main/java/app/designforge/ai'
      );
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Write Kotlin files if they don't exist
      const modulePath = path.join(targetDir, 'SystemPermissionsModule.kt');
      if (!fs.existsSync(modulePath)) {
        fs.writeFileSync(modulePath, MODULE_KT, 'utf8');
      }

      const packagePath = path.join(targetDir, 'SystemPermissionsPackage.kt');
      if (!fs.existsSync(packagePath)) {
        fs.writeFileSync(packagePath, PACKAGE_KT, 'utf8');
      }

      // MainApplication.kt update
      const mainAppPath = path.join(targetDir, 'MainApplication.kt');
      if (fs.existsSync(mainAppPath)) {
        let content = fs.readFileSync(mainAppPath, 'utf8');
        if (!content.includes('SystemPermissionsPackage()')) {
          content = content.replace(
            /val packages = PackageList\(this\)\.packages/,
            'val packages = PackageList(this).packages.toMutableList()\n            packages.add(SystemPermissionsPackage())'
          );
          fs.writeFileSync(mainAppPath, content, 'utf8');
        }
      }

      return cfg;
    }
  ]);

  return config;
};
