import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class CloudSync {
  static const String baseUrl = "https://envguardian-server-j8yv.onrender.com";
  static const String settingsUrl = "$baseUrl/api/settings";
  static const String heartbeatUrl = "$baseUrl/api/heartbeat";
  static const String statusUrl = "$baseUrl/api/agent-status";
  static const String clearAutoLockUrl = "$baseUrl/api/clear-auto-lock"; 
  static const String updateWhitelistUrl = "$baseUrl/api/update-whitelist"; // <-- NEW ROUTE

  static const String apiKey = "c6a725cf024ed9560e57a26d8b661700e10400f7c1ea1eaf";

  // Feature F: device request headers = shared API key + this device's token
  // (issued at registration). The server enforces the token when
  // ENFORCE_DEVICE_TOKEN=true; until then it's accepted but not required.
  static Future<Map<String, String>> _authHeaders({bool jsonBody = false}) async {
    final p = await SharedPreferences.getInstance();
    final h = <String, String>{"x-api-key": apiKey};
    final t = p.getString('device_token');
    if (t != null && t.isNotEmpty) h["x-device-token"] = t;
    if (jsonBody) h["Content-Type"] = "application/json";
    return h;
  }

  static Future<void> syncSettings() async {
    final p = await SharedPreferences.getInstance();
    try {
      final response = await http.get(Uri.parse(settingsUrl), headers: {"x-api-key": apiKey}).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final settings = data['settings'];

        await p.setString('admin_password', settings['admin_password'] ?? '123456');
        List<dynamic> poly = settings['geofence_polygon'] ?? [];
        await p.setString('geofence_polygon', json.encode(poly));

        var rawGlobal = settings['whitelisted_apps'];
        List<dynamic> gList = [];
        if (rawGlobal is String) {
          try { gList = json.decode(rawGlobal); } catch (_) {}
        } else if (rawGlobal is List) {
          gList = rawGlobal;
        }
        List<String> globalWhitelist = gList.map((e) => e.toString()).toList();
        await p.setStringList('global_whitelist', globalWhitelist); 

        await p.setString('qr_secret', settings['qr_secret'] ?? 'FoldedSteelSecret2026');
        await p.setString('qr_mode', (settings['qr_mode'] ?? 'static').toString());

        // Shift window (per-app time budgets reset on this cadence) + alert
        // tuning, all set by the admin on the dashboard. The native enforcer
        // reads shift_start / shift_hours straight from these prefs.
        int asInt(dynamic v, int fallback) => v is num ? v.toInt() : (int.tryParse('$v') ?? fallback);
        await p.setString('shift_start', (settings['shift_start'] ?? '08:00').toString());
        await p.setInt('shift_hours', asInt(settings['shift_hours'], 12));
        await p.setInt('qr_reminder_minutes', asInt(settings['qr_reminder_minutes'], 5));
        await p.setInt('battery_alert_pct', asInt(settings['battery_alert_pct'], 15));
        await p.setInt('battery_notify_step', asInt(settings['battery_notify_step'], 2));
      }
    } catch (e) {
      // Offline fallback
    }
  }

  // Rotating-QR (feature G). When qr_mode == 'totp', a scanned value is valid if
  // it matches the time-based code for the current 30s window (±1 for clock skew);
  // otherwise it must equal the static qr_secret. Mirrors the server's algorithm.
  static const int qrPeriodSec = 30;
  static String _qrCodeForStep(String secret, int step) {
    final mac = Hmac(sha256, utf8.encode(secret)).convert(utf8.encode(step.toString()));
    return mac.toString().substring(0, 12).toUpperCase();
  }

  static Future<bool> validateScannedQr(String scanned) async {
    final p = await SharedPreferences.getInstance();
    final secret = p.getString('qr_secret') ?? 'ENV_GUARDIAN_SECURE_ZONE';
    final mode = p.getString('qr_mode') ?? 'static';
    if (mode != 'totp') return scanned == secret;
    final step = (DateTime.now().millisecondsSinceEpoch ~/ 1000) ~/ qrPeriodSec;
    for (final s in [step, step - 1, step + 1]) {
      if (scanned == _qrCodeForStep(secret, s)) return true;
    }
    return false;
  }

  static Future<String> getAdminPassword() async {
    final p = await SharedPreferences.getInstance();
    return p.getString('admin_password') ?? 'FoldedSteel2026';
  }

  static Future<List<dynamic>> getGeofencePolygon() async {
    final p = await SharedPreferences.getInstance();
    String? polyString = p.getString('geofence_polygon');
    if (polyString != null) return json.decode(polyString);
    return []; 
  }

  static Future<Map<String, dynamic>> fetchAgentData(String empId) async {
    try {
      final response = await http.get(Uri.parse('$statusUrl/$empId'), headers: await _authHeaders()).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        
        var rawCustom = data['custom_whitelist'];
        List<dynamic> cList = [];
        if (rawCustom is String) {
          try { cList = json.decode(rawCustom); } catch (_) {}
        } else if (rawCustom is List) {
          cList = rawCustom;
        }
        List<String> customWhitelist = cList.map((e) => e.toString()).toList();

        // Per-app time-limit policy + per-user feature key (v2).
        var rawPolicies = data['app_policies'];
        List<dynamic> policies = (rawPolicies is List) ? rawPolicies : [];
        var flags = data['feature_flags'];
        Map<String, dynamic> featureFlags = (flags is Map) ? Map<String, dynamic>.from(flags) : {};

        return {
          "success": true,
          "admin_lock": data['admin_lock'] ?? false,
          "custom_whitelist": customWhitelist,
          "app_policies": policies,
          "feature_flags": featureFlags,
        };
      }
      return {"success": false};
    } catch (e) {
      return {"success": false};
    }
  }

  // Reports per-app in-zone usage for the current shift window to the server
  // (feeds the dashboard and the app_usage history). usage = { package: totalMs
  // within the window }; windowStart = epoch-ms start of the shift window the
  // totals belong to (the row's date is derived from it, so an overnight shift
  // stays attributed to the day it started).
  static Future<void> sendAppUsage(String empId, Map<String, int> usage, {int windowStart = 0}) async {
    if (usage.isEmpty) return;
    try {
      final dt = windowStart > 0 ? DateTime.fromMillisecondsSinceEpoch(windowStart) : DateTime.now();
      final date = dt.toIso8601String().substring(0, 10); // YYYY-MM-DD
      final list = usage.entries
          .where((e) => e.value > 0)
          .map((e) => {"package": e.key, "totalTimeMs": e.value, "lastUsed": 0})
          .toList();
      if (list.isEmpty) return;
      await http.post(
        Uri.parse("$baseUrl/api/app-usage"),
        headers: {"Content-Type": "application/json", "x-api-key": apiKey},
        body: json.encode({"empId": empId, "date": date, "windowStart": windowStart, "usage": list}),
      ).timeout(const Duration(seconds: 5));
    } catch (e) {
      // Offline fallback
    }
  }

  // ── Real-time device logs ──────────────────────────────────────────────────
  // The native enforcer (AppBlockerService) appends every allow/block/VPN event
  // to a pending buffer in SharedPreferences ('eg_pending_logs'). This flushes
  // that buffer to the server so the dashboard can show a live per-device feed.
  // Sent events are removed from the FRONT (oldest) of the buffer; the native
  // side only ever appends to the end, so this is race-safe.
  static Future<bool> _postDeviceLogs(String empId, List<dynamic> logs) async {
    try {
      final res = await http.post(
        Uri.parse("$baseUrl/api/device-logs"),
        headers: {"Content-Type": "application/json", "x-api-key": apiKey},
        body: json.encode({"empId": empId, "logs": logs}),
      ).timeout(const Duration(seconds: 5));
      return res.statusCode >= 200 && res.statusCode < 300;
    } catch (e) {
      return false; // offline — keep the buffer for the next flush
    }
  }

  static Future<void> flushPendingLogs(String empId) async {
    if (empId.isEmpty) return;
    final p = await SharedPreferences.getInstance();
    final raw = p.getString('eg_pending_logs');
    if (raw == null || raw.isEmpty || raw == '[]') return;

    List<dynamic> list;
    try { list = json.decode(raw) as List<dynamic>; }
    catch (_) { await p.remove('eg_pending_logs'); return; }
    if (list.isEmpty) return;

    // Send at most 200 per flush to keep requests small.
    final batch = list.length > 200 ? list.sublist(0, 200) : list;
    final ok = await _postDeviceLogs(empId, batch);
    if (!ok) return; // leave the buffer intact; retry next tick

    // Re-read (the native side may have appended more) and drop the sent prefix.
    await p.reload();
    final rawNow = p.getString('eg_pending_logs') ?? '[]';
    List<dynamic> cur;
    try { cur = json.decode(rawNow) as List<dynamic>; } catch (_) { cur = []; }
    final remaining = cur.length > batch.length ? cur.sublist(batch.length) : <dynamic>[];
    await p.setString('eg_pending_logs', json.encode(remaining));
  }

  static Future<void> executeAmnesiaProtocol(String empId) async {
    try {
      await http.post(Uri.parse(clearAutoLockUrl), headers: {"Content-Type": "application/json", "x-api-key": apiKey}, body: json.encode({"empId": empId})).timeout(const Duration(seconds: 5));
    } catch (e) {
      // Offline fallback
    }
  }

  static Future<void> sendPulse(String empId, double lat, double lng, bool inZone, bool enforcerActive, List<String> installedApps, bool autoLock, Map<String, bool> compliance, {int? batteryLevel, bool? batteryCharging}) async {
    try {
      final p = await SharedPreferences.getInstance();
      await http.post(
        Uri.parse(heartbeatUrl),
        headers: await _authHeaders(jsonBody: true),
        body: json.encode({
          "empId": empId, "lat": lat, "lng": lng, "inZone": inZone, "enforcerActive": enforcerActive,
          "timestamp": DateTime.now().millisecondsSinceEpoch, "installedApps": installedApps,
          "autoLock": autoLock, "compliance": compliance,
          "androidVersion": p.getString('android_version'), "sdkInt": p.getInt('sdk_int'),
          "batteryLevel": batteryLevel, "batteryCharging": batteryCharging,
        }),
      ).timeout(const Duration(seconds: 5));
    } catch (e) {
      // Offline fallback
    }
  }

  // --> NEW: TWO-WAY SYNC PUSH TO DATABASE
  static Future<void> updateWhitelist(String empId, List<String> whitelist) async {
    try {
      await http.post(
        Uri.parse(updateWhitelistUrl),
        headers: {"Content-Type": "application/json", "x-api-key": apiKey},
        body: json.encode({
          "empId": empId,
          "custom_whitelist": whitelist
        }),
      ).timeout(const Duration(seconds: 5));
    } catch (e) {
      // Offline fallback
    }
  }
}