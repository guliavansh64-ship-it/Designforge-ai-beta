package expo.modules.designopower

import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads the REAL state of the battery / background settings, so the permissions screen only shows a
 * tick when the setting is actually enabled (not just because the user tapped the button).
 */
class DesignoPowerModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context not available")

  private fun start(i: Intent): Boolean = try {
    val a = appContext.currentActivity
    if (a != null) a.startActivity(i) else ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
  } catch (e: Exception) { false }

  override fun definition() = ModuleDefinition {
    Name("DesignoPower")

    /** true when Android battery optimisation is OFF for this app ("Unrestricted" / "Don't optimise"). */
    Function("isIgnoringBatteryOptimizations") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function true
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    /** true when the user restricted background activity for this app (Android 9+). */
    Function("isBackgroundRestricted") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return@Function false
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      am.isBackgroundRestricted
    }

    /** Shows the system "Allow app to always run in background?" dialog (falls back to the list). */
    Function("requestIgnoreBatteryOptimizations") {
      start(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.packageName)))
        || start(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    Function("openAppDetails") {
      start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName)))
    }

    /** Opens the phone maker's Autostart / background-launch screen when one exists. */
    Function("openAutostartSettings") {
      val candidates = listOf(
        "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
        "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
        "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
        "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
        "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
        "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
        "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
        "com.oneplus.security" to "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity",
        "com.samsung.android.lool" to "com.samsung.android.sm.ui.battery.BatteryActivity",
      )
      for ((pkg, cls) in candidates) {
        if (start(Intent().setComponent(ComponentName(pkg, cls)))) return@Function true
      }
      start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName)))
    }
  }
}
