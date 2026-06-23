package com.example.env_guardian

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.pm.PackageManager
import android.view.accessibility.AccessibilityEvent
import android.os.Handler
import android.os.Looper
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.io.File

class AppBlockerService : AccessibilityService() {

    companion object {
        var isAlive = false
        val ironLedger = mutableListOf<Map<String, Any>>()
        var logListener: ((String, Boolean, String) -> Unit)? = null
    }

    private var pulseHandler: Handler? = null
    private var pulseRunnable: Runnable? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        isAlive = true

        // THE FIX: The Heartbeat is restored!
        pulseHandler = Handler(Looper.getMainLooper())
        pulseRunnable = object : Runnable {
            override fun run() {
                try {
                    val currentTime = System.currentTimeMillis().toString()
                    
                    // 1. Standard SharedPreferences Sync
                    val prefs = applicationContext.getSharedPreferences("FlutterSharedPreferences", MODE_PRIVATE)
                    prefs.edit().putString("flutter.enforcer_last_pulse", currentTime).commit()

                    // 2. The Iron File (Bypasses Flutter Cache completely)
                    try {
                        val file = File(applicationContext.filesDir, "iron_pulse.txt")
                        file.writeText(currentTime)
                    } catch (e: Exception) {}

                    pulseHandler?.postDelayed(this, 5000)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
        pulseHandler?.post(pulseRunnable!!)
    }

    override fun onUnbind(intent: Intent?): Boolean {
        isAlive = false
        pulseRunnable?.let { pulseHandler?.removeCallbacks(it) }
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        super.onDestroy()
        isAlive = false  
        pulseRunnable?.let { pulseHandler?.removeCallbacks(it) }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString() ?: return

        // 1. Anti-Tamper Dagger Shield
        if (packageName == "com.android.settings" || packageName == "com.android.systemui") {
            val rootNode = rootInActiveWindow
            if (rootNode != null) {
                val foundApp = rootNode.findAccessibilityNodeInfosByText("Env Guardian")
                if (!foundApp.isNullOrEmpty()) {
                    val foundStop = rootNode.findAccessibilityNodeInfosByText("Stop")
                    val foundForce = rootNode.findAccessibilityNodeInfosByText("Force stop")
                    val foundActive = rootNode.findAccessibilityNodeInfosByText("Active in background")

                    if (!foundStop.isNullOrEmpty() || !foundForce.isNullOrEmpty() || !foundActive.isNullOrEmpty()) {
                        performGlobalAction(GLOBAL_ACTION_HOME)
                        return
                    }
                }
            }
        }

        // 2. ZERO TRUST Restricted Zone Strike
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val prefs = applicationContext.getSharedPreferences("FlutterSharedPreferences", MODE_PRIVATE)
            val inZone = prefs.getBoolean("flutter.in_restricted_zone", false)
            val whitelist = prefs.getStringSet("native_whitelist", setOf()) ?: setOf()

            if (inZone) {
                val isBlocked = shouldBlock(packageName, whitelist)

                val timeString = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
                val logEntry = mapOf("package" to packageName, "blocked" to isBlocked, "time" to timeString)

                ironLedger.add(0, logEntry)
                if (ironLedger.size > 200) ironLedger.removeLast()
                Handler(Looper.getMainLooper()).post { logListener?.invoke(packageName, isBlocked, timeString) }

                if (isBlocked) {
                    performGlobalAction(GLOBAL_ACTION_HOME)

                    Handler(Looper.getMainLooper()).postDelayed({
                        val launchIntent = Intent(this@AppBlockerService, MainActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                            putExtra("was_blocked", true)
                        }
                        startActivity(launchIntent)
                    }, 300)
                }
            }
        }
    }

    private fun shouldBlock(pkg: String, whitelist: Set<String>): Boolean {
        if (pkg == "com.example.env_guardian") return false
        if (isCoreSystemApp(pkg)) return false
        if (whitelist.contains(pkg)) return false
        return true
    }

    private fun isCoreSystemApp(pkg: String): Boolean {
        if (pkg == "com.android.systemui" || pkg == "com.android.settings") return true

        val invisibleGhosts = setOf(
            "com.google.android.googlequicksearchbox", 
            "com.samsung.android.app.cocktailbarservice", 
            "com.samsung.android.bixby.agent", 
            "com.google.android.gms", 
            "com.android.vending" 
        )
        if (invisibleGhosts.contains(pkg)) return true

        val knownKeyboards = setOf(
            "com.google.android.inputmethod.latin",
            "com.sec.android.inputmethod",
            "com.samsung.android.honeyboard"
        )
        if (knownKeyboards.contains(pkg)) return true

        val homeIntent = Intent(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_HOME) }
        val homeApp = packageManager.resolveActivity(homeIntent, PackageManager.MATCH_DEFAULT_ONLY)
        if (homeApp?.activityInfo?.packageName == pkg) return true

        val dialIntent = Intent(Intent.ACTION_DIAL)
        val dialApp = packageManager.resolveActivity(dialIntent, PackageManager.MATCH_DEFAULT_ONLY)
        if (dialApp?.activityInfo?.packageName == pkg) return true

        return false
    }

    override fun onInterrupt() {}
}