package com.example.env_guardian

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/**
 * State-driven launcher icon (the Duolingo technique).
 *
 * The visible icon is whichever launcher activity-alias (AndroidManifest) is
 * enabled; this manager enables exactly one at a time. The desired state is
 * computed by the Dart heartbeat (background_service.dart) and persisted to
 * FlutterSharedPreferences; this class is invoked from contexts that stay
 * alive with the UI closed (the AppBlockerService pulse) and from
 * MainActivity.onResume as a fallback when the enforcer is down.
 *
 * Deliberate UX guards (do not "simplify" these away):
 *  - HYSTERESIS: the desired state must hold for [STABLE_MS] before the icon
 *    switches, and switches are at least [MIN_SWITCH_INTERVAL_MS] apart —
 *    otherwise a user working near the geofence boundary would watch their
 *    icon flap all day, and every switch risks a launcher redraw glitch.
 *  - The icon is an AMBIENT signal only. Urgent transitions additionally fire
 *    notifications from the Dart side; nothing here is the primary alert.
 *  - The home-screen widget (GuardianStatusWidget) is updated on every tick
 *    WITHOUT hysteresis — it is the live view, the icon is the debounced one.
 */
object DynamicIconManager {

    // States — names shared with background_service.dart and generate_icons.py.
    const val STATE_DEFAULT = "default"     // not enrolled yet → brand icon
    const val STATE_ONSITE = "onsite"       // compliant, inside restricted zone
    const val STATE_SAFE = "safe"           // compliant, outside restricted zone
    const val STATE_ATTENTION = "attention" // degraded: permissions/GPS/sync
    const val STATE_ALERT = "alert"         // device-level tamper / enforcement issue
    const val STATE_PAUSED = "paused"       // enrolled but monitoring not active

    private const val STABLE_MS = 2 * 60 * 1000L             // state must hold this long
    private const val MIN_SWITCH_INTERVAL_MS = 10 * 60 * 1000L // max ~6 switches/hour
    private const val DART_STATE_FRESH_MS = 90_000L          // heartbeat writes every 10s

    // Alias classes are resolved against the manifest NAMESPACE
    // (com.example.env_guardian), not the applicationId.
    private const val ALIAS_PKG = "com.example.env_guardian"
    private val ALIASES = mapOf(
        STATE_DEFAULT to "$ALIAS_PKG.LauncherDefault",
        STATE_ONSITE to "$ALIAS_PKG.LauncherOnsite",
        STATE_SAFE to "$ALIAS_PKG.LauncherSafe",
        STATE_ATTENTION to "$ALIAS_PKG.LauncherAttention",
        STATE_ALERT to "$ALIAS_PKG.LauncherAlert",
        STATE_PAUSED to "$ALIAS_PKG.LauncherPaused"
    )

    /** The state the icon SHOULD show right now (before hysteresis). */
    fun desiredState(context: Context): String {
        return try {
            val fp = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            val sealed = fp.getBoolean("flutter.is_sealed", false)
            val enrolled = !fp.getString("flutter.emp_id", "").isNullOrEmpty()
            if (!sealed) return if (enrolled) STATE_PAUSED else STATE_DEFAULT

            val state = fp.getString("flutter.eg_icon_state", null)
            val ts = fp.getLong("flutter.eg_icon_state_ts", 0L)
            if (state != null && ALIASES.containsKey(state) &&
                System.currentTimeMillis() - ts < DART_STATE_FRESH_MS
            ) {
                state
            } else {
                // Sealed but the Dart heartbeat isn't reporting → monitoring is
                // degraded. Amber, not red: that's a health problem, not tamper.
                STATE_ATTENTION
            }
        } catch (e: Exception) {
            STATE_DEFAULT
        }
    }

    /**
     * Reconcile the launcher icon against the desired state. Cheap; safe to
     * call from any periodic native context (enforcer pulse, activity resume).
     */
    fun tick(context: Context) {
        try {
            val desired = desiredState(context)

            // The widget mirrors the state instantly — no hysteresis there.
            GuardianStatusWidget.push(context, desired)

            val mgr = context.getSharedPreferences("eg_icon_manager", Context.MODE_PRIVATE)
            val applied = mgr.getString("applied", STATE_DEFAULT) ?: STATE_DEFAULT
            val now = System.currentTimeMillis()

            if (desired == applied) {
                if (mgr.contains("pending")) mgr.edit().remove("pending").remove("pending_since").apply()
                return
            }

            val pending = mgr.getString("pending", null)
            if (pending != desired) {
                mgr.edit().putString("pending", desired).putLong("pending_since", now).apply()
                return
            }

            val pendingSince = mgr.getLong("pending_since", now)
            val lastSwitch = mgr.getLong("last_switch", 0L)
            if (now - pendingSince < STABLE_MS) return
            if (now - lastSwitch < MIN_SWITCH_INTERVAL_MS) return

            applyAlias(context, desired)
            mgr.edit()
                .putString("applied", desired)
                .putLong("last_switch", now)
                .remove("pending").remove("pending_since")
                .apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // Enable the new alias FIRST, then disable the others, so the app never
    // has zero launcher entries (that's what makes icons vanish mid-switch).
    private fun applyAlias(context: Context, state: String) {
        val pm = context.packageManager
        val target = ALIASES[state] ?: return
        pm.setComponentEnabledSetting(
            ComponentName(context.packageName, target),
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            PackageManager.DONT_KILL_APP
        )
        for ((_, alias) in ALIASES) {
            if (alias == target) continue
            pm.setComponentEnabledSetting(
                ComponentName(context.packageName, alias),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            )
        }
    }
}
