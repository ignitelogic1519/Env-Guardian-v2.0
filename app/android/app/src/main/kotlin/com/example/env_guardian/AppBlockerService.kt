package com.example.env_guardian

import android.accessibilityservice.AccessibilityService
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.view.accessibility.AccessibilityEvent
import android.os.Handler
import android.os.Looper
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

class AppBlockerService : AccessibilityService() {

    companion object {
        var isAlive = false
        val ironLedger = mutableListOf<Map<String, Any>>()
        var logListener: ((String, Boolean, String) -> Unit)? = null
        // Last whitelist signature we handed the VPN, so we only re-establish the
        // tunnel when the effective allow-list actually changes.
        private var lastVpnWlSig: String? = null
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

                    // 3a. Accumulate per-app usage that happened WHILE INSIDE THE ZONE
                    //     (not whole-day usage). Computed natively so it works with the
                    //     UI closed; persisted to eg_inzone_usage for enforcement +
                    //     server reporting.
                    val inZoneUsage = computeInZoneUsage(prefs)

                    // 3b. Recompute the effective whitelist (base minus time-exhausted
                    //     apps) natively, so whitelist changes AND per-app time limits
                    //     take effect even when the Flutter UI is closed. Time limits are
                    //     measured against IN-ZONE usage only.
                    reconcileWhitelist(prefs, inZoneUsage)

                    // 4. Network Guard reconciliation. Done natively (not via a Flutter
                    //    method channel) so it works even when the UI is closed — this
                    //    is what turns the VPN OFF the moment the device leaves the zone.
                    reconcileVpn(prefs)

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

    // Recomputes the effective app whitelist ENTIRELY on the native side and stores
    // it in native_whitelist (read by both this blocker and the VPN reconciler). This
    // is what makes whitelist changes AND per-app time limits take effect even when
    // the Flutter UI is closed — the Dart background isolate can't reach the app's
    // method channel, but this accessibility pulse (main process) reads prefs +
    // UsageStats directly.
    //
    // The base list (global ∪ custom, + emergency apps when locked/non-compliant) is
    // written by Dart as a plain JSON string 'eg_base_whitelist'. We subtract any
    // policy app that is disabled or has spent its daily budget (usage read natively),
    // then persist the result. If the base hasn't been written yet we leave the last
    // known whitelist untouched (never blanket-block).
    private fun reconcileWhitelist(prefs: android.content.SharedPreferences, usage: Map<String, Long>) {
        try {
            val baseJson = prefs.getString("flutter.eg_base_whitelist", null) ?: return
            val effective = HashSet<String>()
            val arr = JSONArray(baseJson)
            for (i in 0 until arr.length()) effective.add(arr.getString(i))

            // Per-app time limits — only if the feature is enabled for this user.
            val flagsStr = prefs.getString("flutter.feature_flags", "{}") ?: "{}"
            val timeLimitsOn = try { JSONObject(flagsStr).optBoolean("app_time_limits", false) } catch (e: Exception) { false }
            if (timeLimitsOn) {
                val policiesStr = prefs.getString("flutter.app_policies", "[]") ?: "[]"
                val policies = try { JSONArray(policiesStr) } catch (e: Exception) { JSONArray() }
                if (policies.length() > 0) {
                    for (i in 0 until policies.length()) {
                        val pol = policies.optJSONObject(i) ?: continue
                        val pkg = pol.optString("package", "")
                        if (pkg.isEmpty()) continue
                        val enabled = pol.optBoolean("enabled", true)
                        val limit = pol.optLong("daily_limit_ms", 0L)
                        val used = usage[pkg] ?: 0L
                        // Disabled app, or spent its daily budget → drop it from the
                        // whitelist (blocked at the foreground AND cut off by the VPN).
                        if (!enabled || (limit > 0 && used >= limit)) effective.remove(pkg)
                    }
                }
            }

            prefs.edit().putStringSet("native_whitelist", effective).commit()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // Today's per-app foreground time (ms), read directly from UsageStatsManager.
    // Returns an empty map if Usage Access isn't granted (→ no extra blocks).
    private fun getTodayUsageNative(): Map<String, Long> {
        val out = HashMap<String, Long>()
        try {
            val usm = applicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val cal = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            }
            val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, cal.timeInMillis, System.currentTimeMillis()) ?: return out
            for (u in stats) {
                if (u.totalTimeInForeground > 0) out[u.packageName] = (out[u.packageName] ?: 0L) + u.totalTimeInForeground
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return out
    }

    // Accumulates per-app foreground time that accrued WHILE THE DEVICE IS INSIDE THE
    // RESTRICTED ZONE (today only), rather than whole-day usage. This is what per-app
    // time limits are measured against and what gets reported to the server.
    //
    // How it works: UsageStatsManager only gives cumulative day totals, so each pulse
    // we diff the current totals against the previous snapshot and add the positive
    // delta to the in-zone accumulator ONLY when the device is currently in the zone.
    // Everything is keyed by the local date and resets at midnight. Persisted to
    // 'flutter.eg_inzone_usage' (read by Dart for reporting) and 'eg_usage_snapshot'
    // (native-only bookkeeping).
    private fun computeInZoneUsage(prefs: android.content.SharedPreferences): Map<String, Long> {
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val current = getTodayUsageNative()
        val inzone = HashMap<String, Long>()

        // Load the persisted in-zone accumulator (reset if it's from another day).
        try {
            val s = prefs.getString("flutter.eg_inzone_usage", null)
            if (s != null) {
                val o = JSONObject(s)
                if (o.optString("date", today) == today) {
                    val u = o.optJSONObject("usage") ?: JSONObject()
                    val it = u.keys()
                    while (it.hasNext()) { val k = it.next(); inzone[k] = u.optLong(k, 0L) }
                }
            }
        } catch (e: Exception) { /* start fresh */ }

        // Load the previous full-day snapshot for delta computation.
        val snap = HashMap<String, Long>()
        var snapDate = ""
        try {
            val s = prefs.getString("eg_usage_snapshot", null)
            if (s != null) {
                val o = JSONObject(s)
                snapDate = o.optString("date", "")
                val u = o.optJSONObject("snap") ?: JSONObject()
                val it = u.keys()
                while (it.hasNext()) { val k = it.next(); snap[k] = u.optLong(k, 0L) }
            }
        } catch (e: Exception) { /* no snapshot yet */ }

        val inZone = prefs.getBoolean("flutter.in_restricted_zone", false)

        // Add deltas only while in the zone AND when we have a same-day snapshot to
        // diff against (so we never retro-count usage from before entry / from before
        // midnight). A package not in the previous snapshot contributes nothing this
        // pulse (prev defaults to its current total).
        if (inZone && snapDate == today) {
            for ((pkg, cur) in current) {
                val prev = snap[pkg] ?: cur
                val delta = cur - prev
                if (delta > 0) inzone[pkg] = (inzone[pkg] ?: 0L) + delta
            }
        }

        // Persist the accumulator (Dart-readable) and refresh the snapshot.
        try {
            val io = JSONObject(); val iu = JSONObject()
            for ((k, v) in inzone) iu.put(k, v)
            io.put("date", today); io.put("usage", iu)

            val so = JSONObject(); val su = JSONObject()
            for ((k, v) in current) su.put(k, v)
            so.put("date", today); so.put("snap", su)

            prefs.edit()
                .putString("flutter.eg_inzone_usage", io.toString())
                .putString("eg_usage_snapshot", so.toString())
                .commit()
        } catch (e: Exception) { e.printStackTrace() }

        return inzone
    }

    // Keeps the Network Guard VPN in sync with the desired state, entirely on the
    // native side. Runs every ~5s from the always-alive accessibility pulse, so it
    // works whether the Flutter UI is open or closed (the background isolate can't
    // reliably reach the VPN method channel — this is the reliable path).
    //
    //   should run = vpn_enabled (granted at setup) AND currently inside the zone
    //
    // Starts the tunnel on zone entry, RE-establishes it when the effective
    // whitelist changes (e.g. an app hits its time limit), and — the fix for the
    // reported bug — STOPS it the moment the device leaves the zone.
    private fun reconcileVpn(prefs: android.content.SharedPreferences) {
        try {
            val vpnEnabled = prefs.getBoolean("flutter.vpn_enabled", false)
            val inZone = prefs.getBoolean("flutter.in_restricted_zone", false)
            val shouldRun = vpnEnabled && inZone
            val running = GuardianVpnService.running

            // Every-pulse trace so `adb logcat -s EnvGuardianVPN` shows exactly what
            // this decision sees, on-device, while you reproduce the bug.
            android.util.Log.d(GuardianVpnService.TAG,
                "reconcile: enabled=$vpnEnabled inZone=$inZone running=$running shouldRun=$shouldRun")

            if (shouldRun) {
                val wl = (prefs.getStringSet("native_whitelist", emptySet()) ?: emptySet()).sorted()
                val sig = wl.joinToString(",")
                if (!running || sig != lastVpnWlSig) {
                    val i = Intent(applicationContext, GuardianVpnService::class.java)
                        .setAction(GuardianVpnService.ACTION_START)
                        .putStringArrayListExtra(GuardianVpnService.EXTRA_WHITELIST, ArrayList(wl))
                    applicationContext.startService(i)
                    if (lastVpnWlSig == null) vpnLog("VPN ▶ connect — inside restricted zone (${wl.size} bypass apps)")
                    else vpnLog("VPN ↻ re-establish — whitelist changed (${wl.size} bypass apps)")
                    lastVpnWlSig = sig
                }
            } else {
                // Outside the zone (or the guard is off): tear the tunnel down
                // UNCONDITIONALLY every pulse — never gated on the in-memory `running`
                // flag, which a process kill can desync while a tunnel is still up.
                // closeTunnel() shuts the fd DIRECTLY (the OS cannot ignore a closed
                // fd — the key icon drops with it); stopService is the normal service
                // teardown on top. Both are cheap no-ops when nothing is running.
                val closed = GuardianVpnService.closeTunnel("outside restricted zone")
                applicationContext.stopService(
                    Intent(applicationContext, GuardianVpnService::class.java)
                )
                if (closed) vpnLog("VPN ⛔ disconnected — outside restricted zone")
                lastVpnWlSig = null
            }
        } catch (e: Exception) {
            android.util.Log.e(GuardianVpnService.TAG, "reconcileVpn error: ${e.message}")
            e.printStackTrace()
        }
    }

    // Writes a VPN lifecycle event to logcat AND to the in-app Logs tab (iron
    // ledger), so VPN behaviour can be debugged on-device without a computer.
    private fun vpnLog(msg: String) {
        android.util.Log.i(GuardianVpnService.TAG, msg)
        try {
            val time = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
            ironLedger.add(0, mapOf("package" to msg, "blocked" to false, "time" to time))
            if (ironLedger.size > 200) ironLedger.removeLast()
            Handler(Looper.getMainLooper()).post { logListener?.invoke(msg, false, time) }
            persistLog(msg, false, time, "vpn")
        } catch (e: Exception) { /* logging must never break enforcement */ }
    }

    // Appends an enforcement event to a persistent buffer (SharedPreferences) that
    // the Dart layer flushes to the server, so the dashboard can show these logs in
    // real time. Same-process with the UI/background isolate, so the shared prefs
    // file is a reliable hand-off (matches the existing native_whitelist pattern).
    // Capped so a long session can't grow it without bound.
    private fun persistLog(pkg: String, blocked: Boolean, time: String, kind: String) {
        try {
            val prefs = applicationContext.getSharedPreferences("FlutterSharedPreferences", MODE_PRIVATE)
            val cur = prefs.getString("flutter.eg_pending_logs", "[]") ?: "[]"
            val arr = try { JSONArray(cur) } catch (e: Exception) { JSONArray() }
            val o = JSONObject()
            o.put("package", pkg)
            o.put("blocked", blocked)
            o.put("time", time)
            o.put("ts", System.currentTimeMillis())
            o.put("kind", kind)
            arr.put(o)
            // Keep only the most recent 300 (drop from the front if over).
            val out = if (arr.length() > 300) {
                val t = JSONArray()
                for (i in (arr.length() - 300) until arr.length()) t.put(arr.get(i))
                t
            } else arr
            prefs.edit().putString("flutter.eg_pending_logs", out.toString()).commit()
        } catch (e: Exception) { /* logging must never break enforcement */ }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString() ?: return

        // 0. Settings grace window. When the user taps a compliance tile that opens a
        // system settings screen (accessibility, usage access, notification access,
        // OEM auto-start, app details…), the app writes a short-lived timestamp. While
        // it's active we stand down completely — so the enforcer doesn't yank the user
        // out of the very screen they were sent to enable a REQUIRED setting.
        val grace = applicationContext
            .getSharedPreferences("FlutterSharedPreferences", MODE_PRIVATE)
            .getLong("flutter.enforcement_grace_until", 0L)
        if (System.currentTimeMillis() < grace) return

        // 1. Anti-Tamper Dagger Shield — blocks force-stop / disable / UNINSTALL of
        // this app. Previously it only watched stock Settings + SystemUI, so on
        // ColorOS/Realme (and Oppo/OnePlus) the user could still uninstall: those
        // skins show the uninstall confirmation in a package-installer package
        // (com.*.packageinstaller) — and a launcher long-press → Uninstall goes
        // straight there, never touching com.android.settings. We now also inspect
        // those shells and match the "Uninstall" action, not just "Force stop".
        if (isTamperShell(packageName)) {
            val rootNode = rootInActiveWindow
            if (rootNode != null) {
                // Only act when THIS app is the target on screen (its label is shown
                // on the app-details page and in the uninstall dialog). Uninstalling
                // OTHER apps never shows "Env Guardian", so it's unaffected.
                val mentionsUs = !rootNode.findAccessibilityNodeInfosByText("Env Guardian").isNullOrEmpty()
                if (mentionsUs) {
                    val tamperActions = listOf(
                        "Uninstall", "Uninstall app", "Force stop", "Force-stop",
                        "Stop", "Disable", "Active in background"
                    )
                    val tampering = tamperActions.any {
                        !rootNode.findAccessibilityNodeInfosByText(it).isNullOrEmpty()
                    }
                    if (tampering) {
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
                persistLog(packageName, isBlocked, timeString, if (isBlocked) "block" else "allow")

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
        if (pkg == applicationContext.packageName) return false // never block ourselves
        if (isCoreSystemApp(pkg)) return false
        if (whitelist.contains(pkg)) return false
        return true
    }

    // Packages whose screens can be used to force-stop / disable / uninstall this
    // app, so the anti-tamper shield must inspect them. Covers stock Settings +
    // SystemUI, every OEM package-installer variant (ColorOS/Realme, Oppo, OnePlus,
    // MIUI, Google, stock — matched by the shared "packageinstaller" substring), and
    // the ColorOS/Oppo security-center + settings packages.
    private fun isTamperShell(pkg: String): Boolean {
        if (pkg == "com.android.settings" || pkg == "com.android.systemui") return true
        if (pkg.contains("packageinstaller")) return true
        val oemShells = setOf(
            "com.coloros.safecenter",
            "com.oplus.safecenter",
            "com.coloros.settings",
            "com.oplus.settings",
            "com.oppo.settings",
            "com.miui.securitycenter"
        )
        return oemShells.contains(pkg)
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