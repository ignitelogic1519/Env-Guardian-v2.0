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

    bool isCompliant = nOk && lOk && gpsEnabled && bOk && oOk && cOk && enforcerAlive;

    double cLat = 0, cLng = 0; bool insideGeofence = false;
    try {
      if (lOk && gpsEnabled) {
        Position? pos = await Geolocator.getLastKnownPosition();
        pos ??= await Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.medium).timeout(const Duration(seconds: 3));

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
      "qr_verified": isPhysicallyVerified
    };

    try {
      await CloudSync.sendPulse(empId, cLat, cLng, insideGeofence, enforcerAlive, inventory, autoLock, compMatrix).timeout(const Duration(seconds: 5));
    } catch (_) {}

    try {
      Set<String> mergedWhitelist = {
        ...(prefs.getStringList('global_whitelist') ?? []),
        ...(prefs.getStringList('custom_whitelist') ?? [])
      };
      if (isLocked || !isCompliant) mergedWhitelist.addAll(["com.android.settings", "com.google.android.permissioncontroller", "com.android.permissioncontroller", "com.miui.securitycenter", "com.coloros.safecenter"]);

      // ── Per-app time limits ──────────────────────────────────────────────
      // When the admin has enabled this feature for the user, read today's
      // per-app usage and block any allowed app that is disabled or has used
      // up its daily budget. Also report usage so the dashboard can show it.
      if (insideGeofence) {
        await enforceTimeLimits(prefs, empId, mergedWhitelist);
      }

      await platformBlocker.invokeMethod('updateWhitelistedApps', {"apps": mergedWhitelist.toList()});
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
    lastInside = insideGeofence;

    service.invoke('update', {"lat": cLat, "lng": cLng, "inside": insideGeofence});
  });
}

// Applies per-app daily time limits set by the admin.
// Removes from [whitelist] any app that is policy-disabled or has exhausted its
// daily budget, so the native blocker will block it. Also reports usage upstream.
Future<void> enforceTimeLimits(SharedPreferences prefs, String empId, Set<String> whitelist) async {
  try {
    final Map<String, dynamic> flags = json.decode(prefs.getString('feature_flags') ?? '{}') as Map<String, dynamic>;
    if (flags['app_time_limits'] != true) return; // feature not unlocked for this user

    final List<dynamic> policies = json.decode(prefs.getString('app_policies') ?? '[]') as List<dynamic>;
    if (policies.isEmpty) return;

    // Today's per-app foreground time (ms), from the native UsageStatsManager.
    final Map<dynamic, dynamic> raw = await platformBlocker.invokeMethod('getTodayUsage') ?? {};
    final Map<String, int> usage = raw.map((k, v) => MapEntry(k.toString(), (v as num).toInt()));

    for (final pol in policies) {
      final String pkg = (pol['package'] ?? '').toString();
      if (pkg.isEmpty) continue;
      final bool enabled = pol['enabled'] ?? true;
      final int limit = (pol['daily_limit_ms'] as num?)?.toInt() ?? 0;
      final int used = usage[pkg] ?? 0;
      // Disabled app, or used up its daily budget → block it (drop from whitelist).
      if (!enabled || (limit > 0 && used >= limit)) {
        whitelist.remove(pkg);
      }
    }

    // Report usage to the server (powers the dashboard's usage history).
    if (empId.isNotEmpty) await CloudSync.sendAppUsage(empId, usage);
  } catch (_) {
    // Usage access not granted yet, or platform error — fail open (no extra blocks).
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
