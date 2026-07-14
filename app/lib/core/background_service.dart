import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:installed_apps/installed_apps.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_background_service_android/flutter_background_service_android.dart';
import '../cloud_sync.dart';
import 'platform.dart';

/// The local-notifications plugin instance, shared by app startup and the
/// background "ghost" service.
final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();

/// Configures the always-on foreground service ("the Ghost") that monitors the
/// perimeter even when the UI is closed.
Future<void> initializeGhost(bool isSealed) async {
  final service = FlutterBackgroundService();
  final androidNotif = flutterLocalNotificationsPlugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
  await androidNotif?.createNotificationChannel(const AndroidNotificationChannel('guardian_ghost', 'Sentinel Heartbeat', description: 'Active Perimeter Monitoring', importance: Importance.low));
  // High-importance channel for alerts + the "entered the zone" full-screen prompt.
  await androidNotif?.createNotificationChannel(const AndroidNotificationChannel('guardian_alerts', 'Compliance Alerts', description: 'Zone entry and enforcement alerts', importance: Importance.max));
  await service.configure(
    androidConfiguration: AndroidConfiguration(onStart: onStart, autoStart: isSealed, isForegroundMode: true, notificationChannelId: 'guardian_ghost', initialNotificationTitle: 'Env Guardian', initialNotificationContent: 'System Active', foregroundServiceNotificationId: 888),
    iosConfiguration: IosConfiguration(autoStart: false),
  );
}

@pragma('vm:entry-point')
void onStart(ServiceInstance service) async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();

  bool lastAlertState = false;
  bool lastInside = false; // tracks zone-entry transitions for the auto-foreground prompt
  int lastBatteryNotifiedPct = 999; // 999 = no low-battery notification shown yet
  String lastPipBlock = ""; // last pip_manual_block payload we notified about
  String lastNotifState = "";

  if (service is AndroidServiceInstance) service.setAsForegroundService();

  Timer.periodic(const Duration(seconds: 10), (timer) async {
    await prefs.reload();
    if (!(prefs.getBool('is_sealed') ?? false)) return;

    await prefs.setInt('last_ghost_footprint', DateTime.now().millisecondsSinceEpoch);
    String empId = prefs.getString('emp_id') ?? '';
    if (empId.isEmpty) return;

    try {
      await CloudSync.syncSettings().timeout(const Duration(seconds: 5));
      final agentData = await CloudSync.fetchAgentData(empId).timeout(const Duration(seconds: 5));
      if (agentData['success'] == true) {
        await prefs.setBool('admin_lock', agentData['admin_lock'] ?? false);
        await prefs.setStringList('custom_whitelist', (agentData['custom_whitelist'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? []);
        await prefs.setString('app_policies', json.encode(agentData['app_policies'] ?? []));
        await prefs.setString('feature_flags', json.encode(agentData['feature_flags'] ?? {}));
      }
    } catch (_) {}

    // THE IRON FILE FIX: Direct read to bypass Flutter's buggy cache
    bool enforcerAlive = false;
    try {
      final file = File('/data/user/0/com.envguardian.mdm/files/iron_pulse.txt');
      if (file.existsSync()) {
        final text = file.readAsStringSync();
        enforcerAlive = (DateTime.now().millisecondsSinceEpoch - (int.tryParse(text) ?? 0)) < 90000;
      }
    } catch (_) {}

    // Standard SharedPreferences fallback
    if (!enforcerAlive) {
      enforcerAlive = (DateTime.now().millisecondsSinceEpoch - (int.tryParse(prefs.getString('enforcer_last_pulse') ?? '0') ?? 0)) < 90000;
    }

    if ((DateTime.now().millisecondsSinceEpoch - (prefs.getInt('last_ghost_footprint') ?? DateTime.now().millisecondsSinceEpoch)) ~/ 1000 > 30 && (prefs.getBool('in_restricted_zone') ?? false)) await prefs.setBool('auto_lock', true);

    bool autoLock = prefs.getBool('auto_lock') ?? false;
    bool adminLock = prefs.getBool('admin_lock') ?? false;
    bool isLocked = autoLock || adminLock;

    bool nOk = await Permission.notification.isGranted;
    bool lOk = await Permission.locationAlways.isGranted || await Permission.location.isGranted;
    bool gpsEnabled = await Geolocator.isLocationServiceEnabled();
    bool bOk = await Permission.ignoreBatteryOptimizations.isGranted;
    bool oOk = await Permission.systemAlertWindow.isGranted;
    bool cOk = await Permission.camera.isGranted;

    // Usage Access, Notification Access and the OEM Auto-start acknowledgement are
    // mandatory too. Read from the values the foreground persists (the native
    // status channels aren't reliably reachable from this background isolate).
    bool usageOk = prefs.getBool('usage_ok') ?? false;
    bool notifAccessOk = prefs.getBool('notif_access_ok') ?? false;
    bool autostartAck = prefs.getBool('autostart_ack') ?? false;

    bool isCompliant = nOk && lOk && gpsEnabled && bOk && oOk && cOk && enforcerAlive && usageOk && notifAccessOk && autostartAck;

    double cLat = 0, cLng = 0; bool insideGeofence = false;
    try {
      if (lOk && gpsEnabled) {
        // Get a FRESH fix first — getLastKnownPosition() returns a cached location
        // that can still read "inside the zone" long after you've actually left (and
        // it ignores a changed mock location), which left the VPN stuck on. Only fall
        // back to the cached fix if a fresh read isn't available in time.
        Position? pos;
        try {
          pos = await Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high).timeout(const Duration(seconds: 4));
        } catch (_) {
          pos = await Geolocator.getLastKnownPosition();
        }
        if (pos == null) throw Exception('no location fix');

        cLat = pos.latitude; cLng = pos.longitude;
        List<Offset> poly = (await CloudSync.getGeofencePolygon()).map((p) => Offset((p['lat'] as num).toDouble(), (p['lng'] as num).toDouble())).toList();

        insideGeofence = _isPointInPolygon(pos, poly);

        if (!insideGeofence) {
          await prefs.setBool('is_physically_verified', false);
          await prefs.remove('verified_since');
        }

        await prefs.setBool('in_restricted_zone', insideGeofence);
        await prefs.setDouble('current_lat', cLat);
        await prefs.setDouble('current_lng', cLng);
      } else {
        await prefs.setBool('in_restricted_zone', false);
        await prefs.setBool('is_physically_verified', false);
        await prefs.remove('verified_since');
      }
    } catch (e) {
      cLat = prefs.getDouble('current_lat') ?? 0;
      cLng = prefs.getDouble('current_lng') ?? 0;
      insideGeofence = prefs.getBool('in_restricted_zone') ?? false;
      if (!insideGeofence) { await prefs.setBool('is_physically_verified', false); await prefs.remove('verified_since'); }
    }

    bool isPhysicallyVerified = prefs.getBool('is_physically_verified') ?? false;

    // Zone timer: when the user is verified, ensure a start timestamp exists,
    // then compute the elapsed time-in-zone for display in the notification.
    int verifiedSince = prefs.getInt('verified_since') ?? 0;
    if (isPhysicallyVerified && verifiedSince == 0) {
      verifiedSince = DateTime.now().millisecondsSinceEpoch;
      await prefs.setInt('verified_since', verifiedSince);
    }
    String zoneClock = (isPhysicallyVerified && verifiedSince > 0) ? fmtDuration(DateTime.now().millisecondsSinceEpoch - verifiedSince) : "";

    List<String> inventory = [];
    if (insideGeofence) {
      try {
        inventory = (await InstalledApps.getInstalledApps(excludeSystemApps: true).timeout(const Duration(seconds: 3))).map((a) => a.packageName).toList();
        await prefs.setStringList('cached_inventory', inventory);
      } catch (_) {
        inventory = prefs.getStringList('cached_inventory') ?? [];
      }
    }

    Map<String, bool> compMatrix = {
      "notif": nOk, "loc": lOk, "gps": gpsEnabled, "batt": bOk,
      "overlay": oOk, "cam": cOk, "access": enforcerAlive,
      "usage": usageOk, "notif_access": notifAccessOk, "autostart": autostartAck,
      "qr_verified": isPhysicallyVerified,
      // Feature B tamper signal: true if the user turned the Network Guard VPN off
      // on the device while it was meant to be enforcing (set by onRevoke()).
      "vpn_revoked": (prefs.getBool('vpn_enabled') ?? false) && (prefs.getBool('vpn_revoked') ?? false)
    };

    // ── Dynamic launcher icon state ──────────────────────────────────────────
    // Consumed natively by DynamicIconManager (enforcer pulse / app resume) —
    // this isolate can't reach the activity's method channel, so prefs are the
    // hand-off. RED ("alert") is reserved for device-level tamper/enforcement
    // problems only (device frozen, VPN killed, accessibility enforcer dead
    // in-zone); everything the user can fix by flipping a setting is amber
    // ("attention"), so the red icon never publicly brands someone
    // non-compliant over a fixable hiccup.
    final bool vpnRevoked = compMatrix['vpn_revoked'] == true;
    String iconState;
    if (isLocked || vpnRevoked || (!enforcerAlive && insideGeofence)) {
      iconState = 'alert';
    } else if (!isCompliant) {
      iconState = 'attention';
    } else if (insideGeofence) {
      iconState = 'onsite';
    } else {
      iconState = 'safe';
    }
    await prefs.setString('eg_icon_state', iconState);
    await prefs.setInt('eg_icon_state_ts', DateTime.now().millisecondsSinceEpoch);

    // The icon itself is an ambient, debounced signal — states that need the
    // user to act also get a real notification, once per transition.
    final String prevIconState = prefs.getString('eg_icon_state_prev') ?? '';
    if (iconState != prevIconState) {
      await prefs.setString('eg_icon_state_prev', iconState);
      try {
        if (iconState == 'alert') {
          await flutterLocalNotificationsPlugin.show(
            1002,
            "🛑 Action required",
            "Env Guardian enforcement is blocked on this device. Open the app to resolve.",
            const NotificationDetails(android: AndroidNotificationDetails('guardian_alerts', 'Compliance Alerts', importance: Importance.max, priority: Priority.high, color: Colors.red, icon: '@mipmap/ic_launcher')),
          );
        } else if (iconState == 'attention') {
          await flutterLocalNotificationsPlugin.show(
            1002,
            "⚠️ Guardian needs attention",
            "Monitoring is degraded — check permissions, GPS and sync in the app.",
            const NotificationDetails(android: AndroidNotificationDetails('guardian_alerts', 'Compliance Alerts', importance: Importance.max, priority: Priority.high, color: Colors.orange, icon: '@mipmap/ic_launcher')),
          );
        } else {
          await flutterLocalNotificationsPlugin.cancel(1002);
        }
      } catch (_) {}
    }

    // Battery telemetry — written to prefs by the native enforcer pulse
    // (AppBlockerService.writeBatteryStatus). Reported to the dashboard, and used
    // for the low-battery notification below.
    int? batteryLevel = prefs.getInt('battery_level');
    bool batteryCharging = prefs.getBool('battery_charging') ?? false;

    try {
      await CloudSync.sendPulse(empId, cLat, cLng, insideGeofence, enforcerAlive, inventory, autoLock, compMatrix, batteryLevel: batteryLevel, batteryCharging: batteryCharging).timeout(const Duration(seconds: 5));
    } catch (_) {}

    // Low-battery warning to the user. Fires when the level first drops to the
    // admin-set threshold (default 15%), then AGAIN on every further step-%
    // drop (default 2%: 15 → 13 → 11 → …). Threshold + step come from the
    // dashboard admin settings (battery_alert_pct / battery_notify_step).
    final int battAlertPct = prefs.getInt('battery_alert_pct') ?? 15;
    final int battStep = (prefs.getInt('battery_notify_step') ?? 2).clamp(1, 20).toInt();
    if (batteryLevel != null && batteryLevel <= battAlertPct && !batteryCharging) {
      if (lastBatteryNotifiedPct == 999 || batteryLevel <= lastBatteryNotifiedPct - battStep) {
        try {
          await flutterLocalNotificationsPlugin.show(
            998,
            "🔋 Battery low ($batteryLevel%)",
            "Env Guardian stops protecting this device once it powers off. Please charge your phone now.",
            const NotificationDetails(android: AndroidNotificationDetails('guardian_alerts', 'Compliance Alerts', importance: Importance.max, priority: Priority.high, color: Colors.orange, icon: '@mipmap/ic_launcher')),
          );
        } catch (_) {}
        lastBatteryNotifiedPct = batteryLevel;
      }
    } else if (batteryCharging || (batteryLevel != null && batteryLevel >= battAlertPct + 5)) {
      // Recovered / on charge → reset so the next low episode notifies again.
      if (lastBatteryNotifiedPct != 999) { try { await flutterLocalNotificationsPlugin.cancel(998); } catch (_) {} lastBatteryNotifiedPct = 999; }
    }

    // Android-16 PiP fallback: the native enforcer gave up auto-closing a
    // floating mini-window (2 failed attempts) and published the offending
    // packages. Alert the user to close it manually — the Command Center also
    // blocks QR scanning until the native scan sees the window gone.
    final String pipBlock = prefs.getString('pip_manual_block') ?? "";
    if (pipBlock.isNotEmpty && pipBlock != "[]") {
      if (pipBlock != lastPipBlock) {
        String names = "";
        try { names = (json.decode(pipBlock) as List).map((e) => e.toString().split('.').last).join(", "); } catch (_) {}
        try {
          await flutterLocalNotificationsPlugin.show(
            1004,
            "⛔ Close the mini window",
            "A floating mini-player${names.isEmpty ? "" : " ($names)"} could not be closed automatically. Close it manually — QR scanning is blocked until you do.",
            const NotificationDetails(android: AndroidNotificationDetails('guardian_alerts', 'Compliance Alerts', importance: Importance.max, priority: Priority.high, color: Colors.red, icon: '@mipmap/ic_launcher')),
          );
        } catch (_) {}
        lastPipBlock = pipBlock;
      }
    } else if (lastPipBlock.isNotEmpty) {
      try { await flutterLocalNotificationsPlugin.cancel(1004); } catch (_) {}
      lastPipBlock = "";
    }

    // Push any buffered native enforcement logs to the server so the dashboard's
    // live feed updates even while the UI is closed.
    try { await CloudSync.flushPendingLogs(empId).timeout(const Duration(seconds: 6)); } catch (_) {}

    try {
      Set<String> mergedWhitelist = {
        ...(prefs.getStringList('global_whitelist') ?? []),
        ...(prefs.getStringList('custom_whitelist') ?? [])
      };
      if (isLocked || !isCompliant) mergedWhitelist.addAll(["com.android.settings", "com.google.android.permissioncontroller", "com.android.permissioncontroller", "com.miui.securitycenter", "com.coloros.safecenter"]);

      // Publish the RAW base whitelist as a plain JSON string. The native enforcer
      // (AppBlockerService) reads this + today's usage to compute the effective
      // whitelist and apply per-app time limits itself — which is the ONLY way it
      // works while the UI is closed (the method channel below is unreachable from
      // this background isolate, so it's just a best-effort fast path for when the
      // UI is open).
      await prefs.setString('eg_base_whitelist', json.encode(mergedWhitelist.toList()));

      // ── Per-app time limits (foreground fast path + usage reporting) ─────────
      // When the app is in the foreground this trims the set + reports usage to the
      // server. In the background isolate the underlying channel call no-ops, which
      // is fine: the native reconciler above is the source of truth for enforcement.
      // Called regardless of zone so the dashboard keeps receiving the window's
      // usage (and the final totals still land after the device steps out).
      await enforceTimeLimits(prefs, empId, mergedWhitelist);

      await platformBlocker.invokeMethod('updateWhitelistedApps', {"apps": mergedWhitelist.toList()});
      // The Network Guard VPN + effective whitelist are reconciled natively
      // (AppBlockerService), off in_restricted_zone + eg_base_whitelist which this
      // loop keeps fresh — so enforcement and the VPN work even when the UI is closed.
    } catch (e) { debugPrint("Blocker Error: $e"); }

    String currentNotif = "";

    if (isLocked) { currentNotif = "⛔ DEVICE FROZEN. Action Required."; }
    else if (!isCompliant) { currentNotif = "⚠️ COMPLIANCE FAILED."; }
    else if (insideGeofence && !isPhysicallyVerified) { currentNotif = "🔴 IN ZONE - Scan QR to Authenticate"; }
    else if (insideGeofence && isPhysicallyVerified) { currentNotif = "🔴 SECURE ZONE ACTIVE  •  ⏱ $zoneClock"; }
    else { currentNotif = "Status: 🟢 SAFE ZONE"; }

    if (lastNotifState != currentNotif) {
      if (service is AndroidServiceInstance) service.setForegroundNotificationInfo(title: "Env Guardian", content: currentNotif);
      lastNotifState = currentNotif;
    }

    if (!enforcerAlive && !isLocked && insideGeofence) {
      if (!lastAlertState) { await flutterLocalNotificationsPlugin.show(999, "Enforcer Offline", "Accessibility must be repaired.", const NotificationDetails(android: AndroidNotificationDetails('guardian_alerts', 'Compliance Alerts', importance: Importance.max, priority: Priority.high, ongoing: true, autoCancel: false, color: Colors.red, icon: '@mipmap/ic_launcher'))); lastAlertState = true; }
    } else {
      if (lastAlertState) { flutterLocalNotificationsPlugin.cancel(999); lastAlertState = false; }
    }
    // Feature C: when the device NEWLY enters the zone and isn't verified yet,
    // pop a full-screen prompt that brings the app forward to authenticate.
    if (insideGeofence && !lastInside && !isPhysicallyVerified && !isLocked) {
      try {
        await flutterLocalNotificationsPlugin.show(
          1001,
          "Restricted Zone Entered",
          "Open Env Guardian and scan the QR to authenticate.",
          const NotificationDetails(android: AndroidNotificationDetails('guardian_alerts', 'Compliance Alerts', importance: Importance.max, priority: Priority.high, fullScreenIntent: true, icon: '@mipmap/ic_launcher')),
        );
      } catch (_) {}
    }
    if (!insideGeofence && lastInside) {
      try { await flutterLocalNotificationsPlugin.cancel(1001); } catch (_) {}
    }

    // Recurring QR reminder: while inside the zone and still unverified, nudge
    // the user every qr_reminder_minutes (admin-set, default 5) until they scan.
    final int nowMs = DateTime.now().millisecondsSinceEpoch;
    if (insideGeofence && !lastInside) {
      await prefs.setInt('qr_reminder_anchor', nowMs); // reminder clock starts at entry
    }
    if (insideGeofence && !isPhysicallyVerified && !isLocked) {
      final int reminderMin = (prefs.getInt('qr_reminder_minutes') ?? 5).clamp(1, 240).toInt();
      final int anchor = prefs.getInt('qr_reminder_anchor') ?? nowMs;
      if (nowMs - anchor >= reminderMin * 60000) {
        try {
          await flutterLocalNotificationsPlugin.show(
            1003,
            "🔴 Scan the zone QR code",
            "You are inside the restricted zone but haven't authenticated yet. Open Env Guardian and scan the entrance QR.",
            const NotificationDetails(android: AndroidNotificationDetails('guardian_alerts', 'Compliance Alerts', importance: Importance.max, priority: Priority.high, color: Colors.red, icon: '@mipmap/ic_launcher')),
          );
        } catch (_) {}
        await prefs.setInt('qr_reminder_anchor', nowMs); // next reminder in reminderMin
      }
    } else {
      // Verified, locked, or out of the zone → stop reminding.
      try { await flutterLocalNotificationsPlugin.cancel(1003); } catch (_) {}
    }
    lastInside = insideGeofence;

    service.invoke('update', {"lat": cLat, "lng": cLng, "inside": insideGeofence});
  });
}

// Start (epoch ms) of the current shift window. Per-app time budgets accrue
// within one window and reset only when it rolls over — never on zone
// exit/re-entry. Windows repeat every shift_hours (default 12h), anchored at
// shift_start local time (default 08:00); both are admin-set on the dashboard.
// MUST stay in lock-step with AppBlockerService.shiftWindowStart (Kotlin).
int currentWindowStart(SharedPreferences prefs, [DateTime? at]) {
  final now = at ?? DateTime.now();
  int startMin = 8 * 60;
  final s = prefs.getString('shift_start');
  if (s != null && s.contains(':')) {
    final parts = s.split(':');
    final h = int.tryParse(parts[0].trim()) ?? -1;
    final m = int.tryParse(parts.length > 1 ? parts[1].trim() : '') ?? -1;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) startMin = h * 60 + m;
  }
  int hours = prefs.getInt('shift_hours') ?? 12;
  if (hours < 1 || hours > 24) hours = 12;
  final int period = hours * 3600000;
  final int nowMs = now.millisecondsSinceEpoch;
  int anchor = DateTime(now.year, now.month, now.day, startMin ~/ 60, startMin % 60).millisecondsSinceEpoch;
  if (anchor > nowMs) anchor -= 86400000;
  return anchor + ((nowMs - anchor) ~/ period) * period;
}

// Reads the IN-ZONE per-app usage accumulator that the native enforcer
// (AppBlockerService.computeInZoneUsage) maintains — usage counted only while
// the device was inside the restricted zone during the CURRENT SHIFT WINDOW,
// keyed by package. Returns {} if it hasn't been populated yet or belongs to a
// previous window (→ fail open, no extra blocks).
Map<String, int> readInZoneUsage(SharedPreferences prefs) {
  try {
    final s = prefs.getString('eg_inzone_usage');
    if (s == null || s.isEmpty) return {};
    final o = json.decode(s) as Map<String, dynamic>;
    final window = currentWindowStart(prefs).toString();
    if (o['window']?.toString() != window || o['usage'] is! Map) return {};
    final Map<String, int> out = {};
    (o['usage'] as Map).forEach((k, v) { out[k.toString()] = (v as num).toInt(); });
    return out;
  } catch (_) {
    return {};
  }
}

// Applies per-app time limits set by the admin, measured against IN-ZONE usage
// within the current shift window (not whole-day). Removes from [whitelist] any
// app that is policy-disabled or has exhausted its in-zone budget, so the
// native blocker will block it. Also reports the in-zone usage upstream.
Future<void> enforceTimeLimits(SharedPreferences prefs, String empId, Set<String> whitelist) async {
  try {
    final Map<String, dynamic> flags = json.decode(prefs.getString('feature_flags') ?? '{}') as Map<String, dynamic>;

    // In-zone usage is reported regardless of the time-limit feature so the
    // dashboard's usage table always reflects real in-zone activity.
    final Map<String, int> usage = readInZoneUsage(prefs);
    if (empId.isNotEmpty && usage.isNotEmpty) {
      await CloudSync.sendAppUsage(empId, usage, windowStart: currentWindowStart(prefs));
    }

    if (flags['app_time_limits'] != true) return; // feature not unlocked for this user

    final List<dynamic> policies = json.decode(prefs.getString('app_policies') ?? '[]') as List<dynamic>;
    if (policies.isEmpty) return;

    for (final pol in policies) {
      final String pkg = (pol['package'] ?? '').toString();
      if (pkg.isEmpty) continue;
      final bool enabled = pol['enabled'] ?? true;
      final int limit = (pol['daily_limit_ms'] as num?)?.toInt() ?? 0;
      final int used = usage[pkg] ?? 0;
      // Disabled app, or used up its in-zone daily budget → block it.
      if (!enabled || (limit > 0 && used >= limit)) {
        whitelist.remove(pkg);
      }
    }
  } catch (_) {
    // Usage access not granted yet, or a parse error — fail open (no extra blocks).
  }
}

// Formats a millisecond duration as HH:MM:SS for the zone timer.
String fmtDuration(int ms) {
  if (ms < 0) ms = 0;
  final d = Duration(milliseconds: ms);
  final h = d.inHours.toString().padLeft(2, '0');
  final m = (d.inMinutes % 60).toString().padLeft(2, '0');
  final s = (d.inSeconds % 60).toString().padLeft(2, '0');
  return "$h:$m:$s";
}

bool _isPointInPolygon(Position pt, List<Offset> poly) {
  if (poly.isEmpty) return false; int i, j = poly.length - 1; bool inZone = false;
  for (i = 0; i < poly.length; i++) {
    if ((poly[i].dy < pt.longitude && poly[j].dy >= pt.longitude || poly[j].dy < pt.longitude && poly[i].dy >= pt.longitude) && (poly[i].dx <= pt.latitude || poly[j].dx <= pt.latitude)) {
      if (poly[i].dx + (pt.longitude - poly[i].dy) / (poly[j].dy - poly[i].dy) * (poly[j].dx - poly[i].dx) < pt.latitude) inZone = !inZone;
    }
    j = i;
  }
  return inZone;
}
