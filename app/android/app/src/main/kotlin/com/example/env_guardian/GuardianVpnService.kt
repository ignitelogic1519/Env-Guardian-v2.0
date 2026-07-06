package com.example.env_guardian

import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log

/**
 * Local "black-hole" VPN (feature B). When active, all traffic is routed into a
 * tunnel that we never forward — so apps lose internet. Whitelisted apps (and
 * ourselves) are added as *disallowed* so they BYPASS the tunnel and keep normal
 * connectivity. Net effect: non-whitelisted apps have no internet while active.
 *
 * No root required. The user grants VPN consent once (VpnService.prepare).
 * BYOD reality: the user can disable the VPN in Settings — onRevoke() records a
 * tamper flag the app can read and report.
 *
 * TEARDOWN GUARANTEE: the live tunnel descriptor is held STATICALLY (companion)
 * so it can be closed from anywhere (the native reconciler, the method channel),
 * regardless of what state the service instance's lifecycle is in. An Android
 * VPN session exists exactly as long as its fd is open — closing it here is a
 * teardown the OS cannot ignore, and the status-bar key icon drops with it.
 */
class GuardianVpnService : VpnService() {

    companion object {
        const val TAG = "EnvGuardianVPN"
        const val ACTION_START = "com.example.env_guardian.VPN_START"
        const val ACTION_STOP = "com.example.env_guardian.VPN_STOP"
        const val EXTRA_WHITELIST = "whitelist"
        @Volatile var running = false
        @Volatile private var tunnel: ParcelFileDescriptor? = null

        // Closes the live tunnel fd directly. Safe to call from any thread/place;
        // a no-op when nothing is up. Returns true if a tunnel was actually closed.
        fun closeTunnel(reason: String): Boolean {
            val t = tunnel
            tunnel = null
            running = false
            if (t == null) return false
            try { t.close() } catch (e: Exception) { Log.w(TAG, "closeTunnel error: ${e.message}") }
            Log.i(TAG, "Tunnel CLOSED — $reason")
            return true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Only EVER establish on an explicit ACTION_START. A null intent (the system
        // redelivering a killed service) or an ACTION_STOP must tear down and NOT
        // resurrect a tunnel. Combined with START_NOT_STICKY, this guarantees the
        // VPN cannot come back on by itself after the app is killed.
        if (intent == null || intent.action != ACTION_START) {
            Log.i(TAG, "onStartCommand action=${intent?.action ?: "null(system restart)"} → tearing down")
            closeTunnel("non-start intent")
            stopSelf()
            return START_NOT_STICKY
        }
        val wl = intent.getStringArrayListExtra(EXTRA_WHITELIST) ?: arrayListOf()
        startVpn(wl)
        return START_NOT_STICKY
    }

    private fun startVpn(whitelist: List<String>) {
        try {
            closeTunnel("re-establish with fresh whitelist")
            val b = Builder()
            b.setSession("Env Guardian")
            b.addAddress("10.111.0.2", 32)
            b.addDnsServer("10.111.0.1")
            b.addRoute("0.0.0.0", 0)
            try { b.addRoute("::", 0) } catch (e: Exception) { /* no IPv6 */ }
            // Whitelisted apps + ourselves bypass the tunnel (keep internet).
            try { b.addDisallowedApplication(packageName) } catch (e: Exception) {}
            for (pkg in whitelist) {
                try { b.addDisallowedApplication(pkg) } catch (e: Exception) { /* not installed */ }
            }
            tunnel = b.establish()
            running = tunnel != null
            Log.i(TAG, "Tunnel ESTABLISH result=${running} (bypass=${whitelist.size} apps)")
            // A successful (re)establish means the tunnel is active again, so clear any
            // stale tamper flag left by a previous manual disable (onRevoke set it).
            if (running) {
                try {
                    getSharedPreferences("FlutterSharedPreferences", MODE_PRIVATE)
                        .edit().putBoolean("flutter.vpn_revoked", false).commit()
                } catch (e: Exception) {}
            }
            // No reader thread: packets routed here are simply dropped → no internet
            // for non-whitelisted apps until the tunnel is closed.
        } catch (e: Exception) {
            Log.e(TAG, "startVpn failed: ${e.message}")
            running = false
        }
    }

    override fun onRevoke() {
        closeTunnel("revoked (user disabled VPN in system settings, or another VPN took over)")
        try {
            getSharedPreferences("FlutterSharedPreferences", MODE_PRIVATE)
                .edit().putBoolean("flutter.vpn_revoked", true).commit()
        } catch (e: Exception) {}
        super.onRevoke()
    }

    override fun onDestroy() {
        closeTunnel("service destroyed")
        super.onDestroy()
    }
}
