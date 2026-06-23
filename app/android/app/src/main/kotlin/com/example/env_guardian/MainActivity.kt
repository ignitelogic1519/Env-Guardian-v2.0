package com.example.env_guardian

import android.content.Context
import android.content.Intent
import android.provider.Settings
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
}