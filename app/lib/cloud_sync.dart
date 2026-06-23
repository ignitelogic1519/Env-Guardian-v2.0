import 'dart:convert';
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

  static Future<void> syncSettings() async {
    final p = await SharedPreferences.getInstance();
    try {
      final response = await http.get(Uri.parse(settingsUrl)).timeout(const Duration(seconds: 5));
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
      }
    } catch (e) {
      // Offline fallback
    }
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
      final response = await http.get(Uri.parse('$statusUrl/$empId'), headers: {"x-api-key": apiKey}).timeout(const Duration(seconds: 5));
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

        return {
          "success": true,  
          "admin_lock": data['admin_lock'] ?? false,
          "custom_whitelist": customWhitelist
        };
      }
      return {"success": false}; 
    } catch (e) {
      return {"success": false}; 
    }
  }

  static Future<void> executeAmnesiaProtocol(String empId) async {
    try {
      await http.post(Uri.parse(clearAutoLockUrl), headers: {"Content-Type": "application/json", "x-api-key": apiKey}, body: json.encode({"empId": empId})).timeout(const Duration(seconds: 5));
    } catch (e) {
      // Offline fallback
    }
  }

  static Future<void> sendPulse(String empId, double lat, double lng, bool inZone, bool enforcerActive, List<String> installedApps, bool autoLock, Map<String, bool> compliance) async {
    try {
      await http.post(
        Uri.parse(heartbeatUrl),
        headers: {"Content-Type": "application/json", "x-api-key": apiKey},
        body: json.encode({
          "empId": empId, "lat": lat, "lng": lng, "inZone": inZone, "enforcerActive": enforcerActive,
          "timestamp": DateTime.now().millisecondsSinceEpoch, "installedApps": installedApps,
          "autoLock": autoLock, "compliance": compliance    
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