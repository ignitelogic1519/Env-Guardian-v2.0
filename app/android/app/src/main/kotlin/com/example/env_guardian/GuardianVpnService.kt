package com.example.env_guardian

import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor

/**
 * Local "black-hole" VPN (feature B). When active, all traffic is routed into a
 * tunnel that we never forward — so apps lose internet. Whitelisted apps (and
 * ourselves) are added as *disallowed* so they BYPASS the tunnel and keep normal
 * connectivity. Net effect: non-whitelisted apps have no internet while active.
 *
 * No root required. The user grants VPN consent once (VpnService.prepare).
 * BYOD reality: the user can disable the VPN in Settings — onRevoke() records a
 * tamper flag the app can read and report.
 */
class GuardianVpnService : VpnService() {
    private var iface: ParcelFileDescriptor? = null

    companion object {
        const val ACTION_START = "com.example.env_guardian.VPN_START"
        const val ACTION_STOP = "com.example.env_guardian.VPN_STOP"
        const val EXTRA_WHITELIST = "whitelist"
        @Volatile var running = false
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopVpn()
            stopSelf()
            return START_NOT_STICKY
        }
        val wl = intent?.getStringArrayListExtra(EXTRA_WHITELIST) ?: arrayListOf()
        startVpn(wl)
        return START_STICKY
    }

    private fun startVpn(whitelist: List<String>) {
        try {
            stopVpn()
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
            iface = b.establish()
            running = iface != null
            // No reader thread: packets routed here are simply dropped → no internet
            // for non-whitelisted apps until stopVpn().
        } catch (e: Exception) {
            e.printStackTrace()
            running = false
        }
    }

    private fun stopVpn() {
        try { iface?.close() } catch (e: Exception) {}
        iface = null
        running = false
    }

    override fun onRevoke() {
        running = false
        try {
            getSharedPreferences("FlutterSharedPreferences", MODE_PRIVATE)
                .edit().putBoolean("flutter.vpn_revoked", true).commit()
        } catch (e: Exception) {}
        super.onRevoke()
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }
}
