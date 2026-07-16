package com.example.env_guardian

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.Process
import android.provider.Settings
import java.util.Calendar
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.EventChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.example.env_guardian/blocker"
    private val EVENT_CHANNEL = "com.example.env_guardian/logs"
    private var methodChannel: MethodChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        methodChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)

        methodChannel?.setMethodCallHandler { call, result ->
            when (call.method) {
                "openAccessibilitySettings" -> {
                    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                    startActivity(intent)
                    result.success(true)
                }
                // Opens THIS app's App-info page. Needed for sideloaded installs on
                // Android 13+: the Accessibility toggle is blocked by "Restricted
                // settings" until the user taps ⋮ → "Allow restricted settings" on
                // this page. Play/adb installs never hit that wall, so testers over
                // `flutter install` don't see what direct-APK users see.
                "openAppInfoSettings" -> {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:$packageName")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    })
                    result.success(true)
                }
                "updateWhitelistedApps" -> {
                    val apps = call.argument<List<String>>("apps") ?: listOf()
                    val prefs = getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
                    prefs.edit().putStringSet("native_whitelist", apps.toSet()).apply()
                    result.success(true)
                }
                "getIronLedger" -> {
                    result.success(AppBlockerService.ironLedger)
                }
                // --- DEVICE IDENTITY (registration) ---
                // ANDROID_ID is unique per device (per app-signing key since
                // Android 8) and survives reinstalls. Build.ID — what the
                // device_info plugin's `id` field exposes — is the firmware
                // build number, identical on every unit of the same model, so
                // it cannot distinguish two same-model devices.
                "getAndroidId" -> {
                    result.success(Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID))
                }
                // --- THE LIVE WIRE FIX ---
                // Flutter asks Kotlin memory directly, bypassing the file system cache
                "checkEnforcerStatus" -> {
                    result.success(AppBlockerService.isAlive)
                }
                // --- USAGE ACCESS (for per-app time limits) ---
                "hasUsageAccess" -> {
                    result.success(hasUsageAccess())
                }
                "openUsageAccessSettings" -> {
                    startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    })
                    result.success(true)
                }
                "getTodayUsage" -> {
                    result.success(getTodayUsage())
                }
                // --- OEM BACKGROUND RELIABILITY (feature E) ---
                // Opens the manufacturer's Auto-start / background-allow screen so the
                // user can keep the monitor alive on aggressive OEM skins (MIUI, ColorOS,
                // FuntouchOS, OneUI, EMUI…). Falls back to the app's details page.
                "openAutoStartSettings" -> {
                    result.success(openAutoStartSettings())
                }
                // --- NOTIFICATION ACCESS (feature A: detect running background apps) ---
                "hasNotificationAccess" -> {
                    val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: ""
                    result.success(flat.contains(packageName))
                }
                "openNotificationAccessSettings" -> {
                    startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    result.success(true)
                }
                "getActiveNotificationPackages" -> {
                    result.success(GuardianNotifListener.snapshot())
                }
                // --- NETWORK GUARD VPN (feature B) ---
                "prepareVpn" -> {
                    val intent = VpnService.prepare(this)
                    if (intent == null) {
                        result.success(true) // consent already granted
                    } else {
                        startActivityForResult(intent, 9911) // shows the one-time consent dialog
                        result.success(false)
                    }
                }
                // True if the one-time VPN consent has already been granted (prepare
                // returns null). Lets the setup screen show a granted/not-granted tile
                // WITHOUT popping the system dialog.
                "hasVpnConsent" -> {
                    result.success(VpnService.prepare(this) == null)
                }
                "startVpn" -> {
                    val wl = call.argument<List<String>>("whitelist") ?: listOf()
                    val i = Intent(this, GuardianVpnService::class.java)
                        .setAction(GuardianVpnService.ACTION_START)
                        .putStringArrayListExtra(GuardianVpnService.EXTRA_WHITELIST, ArrayList(wl))
                    startService(i)
                    result.success(true)
                }
                "stopVpn" -> {
                    startService(Intent(this, GuardianVpnService::class.java).setAction(GuardianVpnService.ACTION_STOP))
                    result.success(true)
                }
                "isVpnRunning" -> {
                    result.success(GuardianVpnService.running)
                }
                // Manual teardown (safety valve): closes the tunnel fd DIRECTLY and
                // stops the service. Returns true if a live tunnel was actually closed.
                "forceStopVpn" -> {
                    val closed = GuardianVpnService.closeTunnel("manual disconnect from app")
                    stopService(Intent(this, GuardianVpnService::class.java))
                    result.success(closed)
                }
                else -> result.notImplemented()
            }
        }

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, EVENT_CHANNEL).setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    AppBlockerService.logListener = { pkg, blocked, time ->
                        runOnUiThread {
                            events?.success(mapOf("package" to pkg, "blocked" to blocked, "time" to time))
                        }
                    }
                }
                override fun onCancel(arguments: Any?) {
                    AppBlockerService.logListener = null
                }
            }
        )
    }

    override fun onResume() {
        super.onResume()
        // Fallback reconciliation for the dynamic icon + widget: the enforcer
        // pulse is the primary driver, but if accessibility is disabled that
        // pulse is dead — opening the app still brings the icon up to date.
        DynamicIconManager.tick(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra("was_blocked", false)) {
            methodChannel?.invokeMethod("showBlockAlert", null)
        }
    }

    // True if the user has granted "Usage access" to this app (a special permission
    // that cannot be requested inline — only via the system settings screen).
    private fun hasUsageAccess(): Boolean {
        return try {
            val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
            } else {
                @Suppress("DEPRECATION")
                appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
            }
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) {
            false
        }
    }

    // Opens the OEM "auto-start / background allow" settings page. There is no
    // public API for this, so we try known per-manufacturer activities in turn and
    // fall back to this app's details page if none resolve.
    private fun openAutoStartSettings(): Boolean {
        val candidates = listOf(
            ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            ComponentName("com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"),
            ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
            ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
            ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
            ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
            ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
            ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
            ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"),
            ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")
        )
        for (cn in candidates) {
            try {
                val intent = Intent().setComponent(cn).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null) {
                    startActivity(intent)
                    return true
                }
            } catch (e: Exception) { /* try next */ }
        }
        // Fallback: this app's details page (battery / autostart toggles live nearby).
        return try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            true
        } catch (e: Exception) {
            false
        }
    }

    // Per-app foreground time (ms) used SO FAR TODAY, keyed by package name.
    // Works on Android 5.0+ (UsageStatsManager) and degrades to an empty map
    // if access hasn't been granted yet.
    private fun getTodayUsage(): Map<String, Long> {
        val out = HashMap<String, Long>()
        try {
            if (!hasUsageAccess()) return out
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val cal = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            }
            val start = cal.timeInMillis
            val end = System.currentTimeMillis()
            val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end) ?: return out
            for (u in stats) {
                if (u.totalTimeInForeground > 0) {
                    out[u.packageName] = (out[u.packageName] ?: 0L) + u.totalTimeInForeground
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return out
    }
}