package expo.modules.designopower

import android.app.ActivityManager
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import java.io.File
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

    /**
     * Saves a file from the app cache into the phone's public Downloads/Designo folder (a real download,
     * no share sheet). Android 10+ uses MediaStore, which needs no storage permission.
     * Returns the content:// URI of the saved file. Throws on Android 9 and older (the app then falls back
     * to the share sheet).
     */
    AsyncFunction("saveToDownloads") { srcPath: String, fileName: String, mime: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw IllegalStateException("Direct downloads need Android 10 or newer")
      val src = File(Uri.parse(srcPath).path ?: srcPath)
      if (!src.exists()) throw IllegalStateException("Downloaded file is missing")
      val resolver = ctx.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Designo")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IllegalStateException("Could not create the file in Downloads")
      try {
        val out = resolver.openOutputStream(uri) ?: throw IllegalStateException("Could not write to Downloads")
        out.use { o -> src.inputStream().use { i -> i.copyTo(o) } }
        val done = ContentValues()
        done.put(MediaStore.MediaColumns.IS_PENDING, 0)
        resolver.update(uri, done, null, null)
      } catch (e: Exception) {
        resolver.delete(uri, null, null)
        throw e
      }
      uri.toString()
    }

    /** Opens a saved download (content:// URI) in a viewer app. */
    Function("openFile") { uri: String, mime: String ->
      val i = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      start(Intent.createChooser(i, "Open with").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }

    /** Opens the system Downloads app. */
    Function("openDownloads") {
      start(Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS))
    }

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
