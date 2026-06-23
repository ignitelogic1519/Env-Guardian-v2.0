package com.example.env_guardian

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
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
                "updateWhitelistedApps" -> {
                    val apps = call.argument<List<String>>("apps") ?: listOf()
                    val prefs = getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
                    prefs.edit().putStringSet("native_whitelist", apps.toSet()).apply()
                    result.success(true)
                }
                "getIronLedger" -> {
                    result.success(AppBlockerService.ironLedger)
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