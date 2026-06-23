import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:installed_apps/app_info.dart';
import 'package:installed_apps/installed_apps.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_background_service_android/flutter_background_service_android.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:http/http.dart' as http;
import 'cloud_sync.dart';

final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();
const platformBlocker = MethodChannel('com.example.env_guardian/blocker');

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await flutterLocalNotificationsPlugin.initialize(const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')));
  final prefs = await SharedPreferences.getInstance();
  final bool isSealed = prefs.getBool('is_sealed') ?? false;
  await initializeGhost(isSealed);
  await CloudSync.syncSettings();
  runApp(EnvGuardianApp(isSealed: isSealed));
}

Future<void> initializeGhost(bool isSealed) async {
  final service = FlutterBackgroundService();
  await flutterLocalNotificationsPlugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.createNotificationChannel(const AndroidNotificationChannel('guardian_ghost', 'Sentinel Heartbeat', description: 'Active Perimeter Monitoring', importance: Importance.low));
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
      }
    } catch (_) {}

    // THE IRON FILE FIX: Direct read to bypass Flutter's buggy cache
    bool enforcerAlive = false;
    try {
      final file = File('/data/user/0/com.example.env_guardian/files/iron_pulse.txt');
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
        }
        
        await prefs.setBool('in_restricted_zone', insideGeofence); 
        await prefs.setDouble('current_lat', cLat); 
        await prefs.setDouble('current_lng', cLng);
      } else { 
        await prefs.setBool('in_restricted_zone', false); 
        await prefs.setBool('is_physically_verified', false);
      }
    } catch (e) { 
      cLat = prefs.getDouble('current_lat') ?? 0;
      cLng = prefs.getDouble('current_lng') ?? 0;
      insideGeofence = prefs.getBool('in_restricted_zone') ?? false;
      if (!insideGeofence) await prefs.setBool('is_physically_verified', false);
    }

    bool isPhysicallyVerified = prefs.getBool('is_physically_verified') ?? false;

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
      await platformBlocker.invokeMethod('updateWhitelistedApps', {"apps": mergedWhitelist.toList()});
    } catch (e) { debugPrint("Blocker Error: $e"); }

    String currentNotif = ""; 

    if (isLocked) { currentNotif = "⛔ DEVICE FROZEN. Action Required."; } 
    else if (!isCompliant) { currentNotif = "⚠️ COMPLIANCE FAILED."; } 
    else if (insideGeofence && !isPhysicallyVerified) { currentNotif = "🔴 IN ZONE - Scan QR to Authenticate"; } 
    else if (insideGeofence && isPhysicallyVerified) { currentNotif = "🔴 SECURE ZONE ACTIVE"; } 
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
    service.invoke('update', {"lat": cLat, "lng": cLng, "inside": insideGeofence});
  });
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

class EnvGuardianApp extends StatelessWidget {
  final bool isSealed; const EnvGuardianApp({super.key, required this.isSealed});
  @override Widget build(BuildContext context) => MaterialApp(debugShowCheckedModeBanner: false, theme: ThemeData.dark().copyWith(scaffoldBackgroundColor: const Color(0xFF121212), primaryColor: Colors.blueAccent), home: isSealed ? const CommandCenterScreen() : const AdminSetupScreen());
}

class AdminSetupScreen extends StatefulWidget { const AdminSetupScreen({super.key}); @override State<AdminSetupScreen> createState() => _AdminSetupScreenState(); }
class _AdminSetupScreenState extends State<AdminSetupScreen> {
  bool _nOk = false, _fOk = false, _bOk = false, _oOk = false, _cOk = false, _aOk = false;
  final TextEditingController _nameCtrl = TextEditingController(), _empIdCtrl = TextEditingController(); Timer? _setupTimer;

  @override void initState() { 
    super.initState(); 
    _reqN(); 
    _setupTimer = Timer.periodic(const Duration(seconds: 2), (_) => _checkAccessibility()); 
    _nameCtrl.addListener(() => setState(() {})); 
    _empIdCtrl.addListener(() => setState(() {})); 
  }
  
  Future<void> _checkAccessibility() async { 
    try {
      final bool isAlive = await platformBlocker.invokeMethod('checkEnforcerStatus');
      if (mounted) setState(() => _aOk = isAlive);
    } catch (e) {
      debugPrint("Live wire check failed: $e");
    }
  }

  Future<void> _reqN() async { final s = await Permission.notification.request(); setState(() => _nOk = s.isGranted); }
  Future<void> _reqF() async { final s = await Permission.location.request(); setState(() => _fOk = s.isGranted); }
  Future<void> _reqB() async { if (!_fOk) return; final s = await Permission.locationAlways.request(); if (s.isGranted) await Permission.ignoreBatteryOptimizations.request(); setState(() => _bOk = s.isGranted); }
  Future<void> _reqO() async { final s = await Permission.systemAlertWindow.request(); setState(() => _oOk = s.isGranted); }
  Future<void> _reqC() async { final s = await Permission.camera.request(); setState(() => _cOk = s.isGranted); }

  @override Widget build(BuildContext context) {
    bool canSeal = _nOk && _fOk && _bOk && _oOk && _cOk && _aOk && _nameCtrl.text.trim().isNotEmpty && _empIdCtrl.text.trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: const Text("Sentinel Initiation"), centerTitle: true),
      body: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(30), child: Column(children: [
        const Icon(Icons.security, size: 80, color: Colors.blueAccent), const SizedBox(height: 30),
        TextField(controller: _nameCtrl, decoration: InputDecoration(labelText: "Employee Name", prefixIcon: const Icon(Icons.person), filled: true, fillColor: Colors.grey[900], border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)))), const SizedBox(height: 15),
        TextField(controller: _empIdCtrl, decoration: InputDecoration(labelText: "Employee ID", prefixIcon: const Icon(Icons.badge), filled: true, fillColor: Colors.grey[900], border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)))), const SizedBox(height: 30),
        _permTile("0. Notifications", _nOk, _reqN), _permTile("1. Location", _fOk, _reqF), _permTile("2. Background & Battery", _bOk, _reqB), _permTile("3. System Overlay", _oOk, _reqO), _permTile("4. Camera", _cOk, _reqC),
        ListTile(title: const Text("5. Accessibility Enforcer"), trailing: Icon(_aOk ? Icons.check_circle : Icons.open_in_new, color: _aOk ? Colors.green : Colors.orangeAccent), onTap: () => platformBlocker.invokeMethod('openAccessibilitySettings')), const SizedBox(height: 50),
        if (canSeal) ElevatedButton(style: ElevatedButton.styleFrom(backgroundColor: Colors.green, minimumSize: const Size(double.infinity, 50)), onPressed: () async {
          final p = await SharedPreferences.getInstance(); final deviceInfo = DeviceInfoPlugin(); String dId = "Unknown ID", dModel = "Unknown Model";
          if (Platform.isAndroid) { AndroidDeviceInfo androidInfo = await deviceInfo.androidInfo; dId = androidInfo.id; dModel = "${androidInfo.manufacturer} ${androidInfo.model}"; }
          int now = DateTime.now().millisecondsSinceEpoch; String eName = _nameCtrl.text.trim(), eId = _empIdCtrl.text.trim();
          try { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Forging identity...")));
            final response = await http.post(Uri.parse("https://envguardian-server.onrender.com/api/register"), headers: {"Content-Type": "application/json", "x-api-key": "FoldedSteelSecret2026"}, body: json.encode({"empName": eName, "empId": eId, "deviceId": dId, "deviceModel": dModel, "registeredAt": now}));
            if (response.statusCode == 201) { await p.setString('emp_name', eName); await p.setString('emp_id', eId); await p.setString('device_id', dId); await p.setString('device_model', dModel); await p.setInt('registration_time', now); await p.setInt('last_ghost_footprint', DateTime.now().millisecondsSinceEpoch); await p.setBool('is_sealed', true); await FlutterBackgroundService().startService(); if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const CommandCenterScreen())); } 
            else { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("SERVER REJECTED: ${json.decode(response.body)['message']}"), backgroundColor: Colors.red)); }
          } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("FATAL: Could not connect to Server."), backgroundColor: Colors.red)); }
        }, child: const Text("SEAL DEVICE & REGISTER", style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white)))
      ]))),
    );
  }
  Widget _permTile(String t, bool ok, VoidCallback tap) => ListTile(title: Text(t), trailing: Icon(ok ? Icons.check_circle : Icons.circle_outlined, color: ok ? Colors.green : Colors.red), onTap: ok ? null : tap);
  @override void dispose() { _setupTimer?.cancel(); _nameCtrl.dispose(); _empIdCtrl.dispose(); super.dispose(); }
}

class CommandCenterScreen extends StatefulWidget { const CommandCenterScreen({super.key}); @override State<CommandCenterScreen> createState() => _CommandCenterScreenState(); }
class _CommandCenterScreenState extends State<CommandCenterScreen> {
  int _tabIndex = 0; double _lat = 0, _lng = 0;
  bool _insideGeofence = false, _isPhysicallyVerified = false, _enforcerAlive = false, _isInitializing = true, _autoLock = false, _adminLock = false;
  bool _nOk = true, _fOk = true, _bOk = true, _oOk = true, _cOk = true, _gpsEnabled = true;
  List<Offset> _poly = []; Timer? _t; final TextEditingController _unlockPassCtrl = TextEditingController();
  String _empName = "", _empId = "", _deviceId = "", _deviceModel = "";

  @override void initState() { 
    super.initState(); 
    _loadData(); 
    
    platformBlocker.setMethodCallHandler((c) async { 
      if (c.method == "showBlockAlert" && mounted) { 
        setState(() => _tabIndex = 3); 
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Application Blocked by Zero Trust.", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)), backgroundColor: Colors.redAccent, behavior: SnackBarBehavior.floating)); 
      } 
    }); 
    
    _sync(); 
    _t = Timer.periodic(const Duration(seconds: 5), (_) => _sync()); 
    Future.delayed(const Duration(seconds: 7), () { if (mounted) setState(() => _isInitializing = false); }); 
  }
  
  Future<void> _loadData() async { final p = await SharedPreferences.getInstance(); if (mounted) setState(() { _empName = p.getString('emp_name') ?? ""; _empId = p.getString('emp_id') ?? ""; _deviceId = p.getString('device_id') ?? ""; _deviceModel = p.getString('device_model') ?? ""; _poly = (json.decode(p.getString('geofence_polygon') ?? '[]') as List).map((p) => Offset((p['lat'] as num).toDouble(), (p['lng'] as num).toDouble())).toList(); }); }

  Future<void> _reqN() async { await Permission.notification.request(); _sync(); }
  Future<void> _reqF() async { await Permission.location.request(); _sync(); }
  Future<void> _reqB() async { await Permission.locationAlways.request(); await Permission.ignoreBatteryOptimizations.request(); _sync(); }
  Future<void> _reqO() async { await Permission.systemAlertWindow.request(); _sync(); }
  Future<void> _reqC() async { await Permission.camera.request(); _sync(); }
  Future<void> _reqGps() async { await Geolocator.openLocationSettings(); _sync(); }
  Future<void> _reqAccess() async { await platformBlocker.invokeMethod('openAccessibilitySettings'); _sync(); }

  Future<void> _sync() async {
    final p = await SharedPreferences.getInstance(); await p.reload();
    try { final inv = (await InstalledApps.getInstalledApps(excludeSystemApps: true)).map((a) => a.packageName).toList(); await p.setStringList('cached_inventory', inv); } catch (_) {}
    
    if ((DateTime.now().millisecondsSinceEpoch - (p.getInt('last_ghost_footprint') ?? DateTime.now().millisecondsSinceEpoch)) ~/ 1000 > 30 && (p.getBool('in_restricted_zone') ?? false)) await p.setBool('auto_lock', true);
    
    if (_empId.isNotEmpty) { 
      final aData = await CloudSync.fetchAgentData(_empId); 
      if (aData['success'] == true) {
        await p.setBool('admin_lock', aData['admin_lock'] ?? false); 
        await p.setStringList('custom_whitelist', (aData['custom_whitelist'] as List<dynamic>?)?.map((e)=>e.toString()).toList() ?? []); 
      }
    }
    
    bool n = await Permission.notification.isGranted, f = await Permission.locationAlways.isGranted || await Permission.location.isGranted, g = await Geolocator.isLocationServiceEnabled();
    bool b = await Permission.ignoreBatteryOptimizations.isGranted, o = await Permission.systemAlertWindow.isGranted, c = await Permission.camera.isGranted;
    
    bool a = false;
    try {
      a = await platformBlocker.invokeMethod('checkEnforcerStatus');
    } catch (_) {
      a = (DateTime.now().millisecondsSinceEpoch - (int.tryParse(p.getString('enforcer_last_pulse') ?? '0') ?? 0)) < 90000;
    }
    
    List<Offset> poly = (json.decode(p.getString('geofence_polygon') ?? '[]') as List).map((e) => Offset((e['lat'] as num).toDouble(), (e['lng'] as num).toDouble())).toList();
    
    Set<String> merged = {
      ...(p.getStringList('global_whitelist') ?? []), 
      ...(p.getStringList('custom_whitelist') ?? [])
    };
    bool aL = p.getBool('auto_lock') ?? false, adL = p.getBool('admin_lock') ?? false;
    bool comp = n && f && g && b && o && c && a;

    if (aL || adL || !comp) merged.addAll(["com.android.settings", "com.google.android.permissioncontroller", "com.android.permissioncontroller", "com.miui.securitycenter", "com.coloros.safecenter"]);
    await platformBlocker.invokeMethod('updateWhitelistedApps', {"apps": merged.toList()});

    if (mounted) setState(() { _poly = poly; _insideGeofence = p.getBool('in_restricted_zone') ?? false; _isPhysicallyVerified = p.getBool('is_physically_verified') ?? false; _lat = p.getDouble('current_lat') ?? 0; _lng = p.getDouble('current_lng') ?? 0; _enforcerAlive = a; _autoLock = aL; _adminLock = adL; _nOk = n; _fOk = f; _gpsEnabled = g; _bOk = b; _oOk = o; _cOk = c; });
  }

  Future<void> _unfreezeDevice() async {
    if (_unlockPassCtrl.text == await CloudSync.getAdminPassword()) {
      final p = await SharedPreferences.getInstance(); await p.setBool('auto_lock', false); await p.setInt('last_ghost_footprint', DateTime.now().millisecondsSinceEpoch); await CloudSync.executeAmnesiaProtocol(_empId);
      setState(() { _autoLock = false; _unlockPassCtrl.clear(); }); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Auto-Lock Cleared."), backgroundColor: Colors.green));
    } else { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Incorrect Admin Password"), backgroundColor: Colors.red)); }
  }

  @override Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Command Center", style: TextStyle(fontWeight: FontWeight.bold)), backgroundColor: (_autoLock || _adminLock) ? Colors.red[900] : Colors.black, actions: [IconButton(icon: const Icon(Icons.account_circle, color: Colors.blueAccent, size: 30), onPressed: () => showModalBottomSheet(context: context, backgroundColor: Colors.transparent, builder: (c) => Container(padding: const EdgeInsets.all(30), decoration: BoxDecoration(color: const Color(0xFF1E1E1E), borderRadius: const BorderRadius.vertical(top: Radius.circular(30))), child: Column(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.badge, size: 60, color: Colors.blueAccent), Text(_empName, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: Colors.white)), Text("ID: $_empId", style: const TextStyle(color: Colors.blueAccent, fontWeight: FontWeight.bold)), const Divider(color: Colors.white24), Row(children: [const Icon(Icons.phone_android, color: Colors.white54), const SizedBox(width: 15), const Text("Model:"), const Spacer(), Text(_deviceModel)]), Row(children: [const Icon(Icons.fingerprint, color: Colors.white54), const SizedBox(width: 15), const Text("Device ID:"), const Spacer(), Text(_deviceId)])])))), const SizedBox(width: 10)]),
      body: [_buildStatusTab(), const ArmoryTab(), const LogTab(), MapTab(currentLat: _lat, currentLng: _lng, polygonPoints: _poly)][_tabIndex],
      bottomNavigationBar: BottomNavigationBar(currentIndex: _tabIndex, onTap: (i) => setState(() => _tabIndex = i), type: BottomNavigationBarType.fixed, backgroundColor: Colors.black, selectedItemColor: Colors.blueAccent, unselectedItemColor: Colors.white38, items: const [BottomNavigationBarItem(icon: Icon(Icons.radar), label: "Status"), BottomNavigationBarItem(icon: Icon(Icons.security), label: "Armory"), BottomNavigationBarItem(icon: Icon(Icons.terminal), label: "Logs"), BottomNavigationBarItem(icon: Icon(Icons.map), label: "Map")]),
    );
  }

  Widget _buildStatusTab() {
    if (_isInitializing) return const Center(child: CircularProgressIndicator());
    if (_adminLock) return _buildFrozenScreen(true); if (_autoLock) return _buildFrozenScreen(false);
    if (!(_nOk && _fOk && _gpsEnabled && _bOk && _oOk && _cOk && _enforcerAlive)) return Center(child: Padding(padding: const EdgeInsets.all(20), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [const Icon(Icons.gpp_maybe, size: 80, color: Colors.orangeAccent), const Text("COMPLIANCE REQUIRED", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.orangeAccent)), Card(color: Colors.grey[900], child: Column(children: [_shieldTile("Location", _fOk, _reqF), _shieldTile("GPS", _gpsEnabled, _reqGps), _shieldTile("Camera", _cOk, _reqC), _shieldTile("Enforcer", _enforcerAlive, _reqAccess), _shieldTile("Notifications", _nOk, _reqN), _shieldTile("Battery", _bOk, _reqB), _shieldTile("Overlay", _oOk, _reqO)]))])));
    
    if (!_insideGeofence) return const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.shield, size: 100, color: Colors.greenAccent), Text("SAFE ZONE", style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.greenAccent)), Text("Move to Restricted Zone to authorize.")]));
    
    if (_insideGeofence && _isPhysicallyVerified) return const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.verified_user, size: 100, color: Colors.blueAccent), Text("SECURE ZONE ACTIVE", style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.blueAccent)), Text("Zero Trust Perimeter Engaged.", style: TextStyle(color: Colors.white70))]));
    
    return Column(children: [const Padding(padding: EdgeInsets.all(20), child: Text("SCAN TO AUTHENTICATE", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.greenAccent))), Expanded(child: Container(margin: const EdgeInsets.all(20), decoration: BoxDecoration(border: Border.all(color: Colors.greenAccent, width: 4), borderRadius: BorderRadius.circular(20)), child: ClipRRect(borderRadius: BorderRadius.circular(16), child: MobileScanner(onDetect: (cap) async { 
      for (final b in cap.barcodes) { 
        if (b.rawValue == null) continue; 
        final p = await SharedPreferences.getInstance(); 
        String expectedSecret = p.getString('qr_secret') ?? 'ENV_GUARDIAN_SECURE_ZONE'; 
        
        if (b.rawValue == expectedSecret) { 
          await p.setBool('is_physically_verified', true); 
          setState(() { _isPhysicallyVerified = true; }); 
          break; 
        } 
      } 
    })))) , const Padding(padding: EdgeInsets.only(bottom: 30), child: Text("Position Static QR code inside frame.", style: TextStyle(color: Colors.white54)))]);
  }

  Widget _buildFrozenScreen(bool isAdmin) => Center(child: Padding(padding: const EdgeInsets.all(30), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [const Icon(Icons.lock_person, size: 100, color: Colors.redAccent), Text(isAdmin ? "ADMIN LOCK" : "AUTO-LOCK", style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.redAccent)), Text(isAdmin ? "Banishment Decree issued by Server." : "Time Anomaly Detected.", style: const TextStyle(color: Colors.white70)), const SizedBox(height: 40), if (!isAdmin) ...[TextField(controller: _unlockPassCtrl, obscureText: true, decoration: InputDecoration(labelText: "Admin Unfreeze Password", filled: true, fillColor: Colors.grey[900])), const SizedBox(height: 20), ElevatedButton.icon(style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent, foregroundColor: Colors.white, minimumSize: const Size(double.infinity, 60)), icon: const Icon(Icons.key), label: const Text("UNFREEZE"), onPressed: _unfreezeDevice)] else const Icon(Icons.cloud_off, size: 50, color: Colors.white30), const SizedBox(height: 30), ElevatedButton(style: ElevatedButton.styleFrom(backgroundColor: Colors.grey[800], foregroundColor: Colors.white), onPressed: () => platformBlocker.invokeMethod('openAccessibilitySettings'), child: const Text("Open Phone Settings"))])));
  Widget _shieldTile(String t, bool ok, VoidCallback tap) => ListTile(dense: true, title: Text(t, style: const TextStyle(color: Colors.white)), trailing: Icon(ok ? Icons.check_circle : Icons.open_in_new, color: ok ? Colors.green : Colors.orangeAccent), onTap: ok ? null : tap);
  @override void dispose() { _t?.cancel(); _unlockPassCtrl.dispose(); super.dispose(); }
}

class ArmoryTab extends StatefulWidget { const ArmoryTab({super.key}); @override State<ArmoryTab> createState() => _ArmoryTabState(); }
class _ArmoryTabState extends State<ArmoryTab> {
  List<AppInfo> _apps = []; Set<String> _whitelist = {}; bool _loading = true, _unlocked = false; final TextEditingController _pass = TextEditingController();
  
  @override void initState() { super.initState(); _load(); }
  
  Future<void> _load() async { 
    final p = await SharedPreferences.getInstance(); 
    _whitelist = {
      ...(p.getStringList('global_whitelist') ?? []), 
      ...(p.getStringList('custom_whitelist') ?? [])
    }; 
    List<AppInfo> installed = await InstalledApps.getInstalledApps(excludeSystemApps: false, withIcon: true); installed.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase())); if (mounted) setState(() { _apps = installed; _loading = false; }); 
  }
  
  @override Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (!_unlocked) return Padding(padding: const EdgeInsets.all(40), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [const Icon(Icons.lock, size: 60), const Text("ZERO TRUST VAULT", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)), TextField(controller: _pass, obscureText: true, decoration: const InputDecoration(labelText: "Admin Vault Key")), const SizedBox(height: 20), ElevatedButton(onPressed: () async { if (_pass.text == await CloudSync.getAdminPassword()) setState(() => _unlocked = true); else ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Incorrect Key"), backgroundColor: Colors.red)); }, child: const Text("UNLOCK"))]));
    
    return ListView.builder(itemCount: _apps.length, itemBuilder: (c, i) { 
      final a = _apps[i]; if (a.packageName == "com.example.env_guardian") return const SizedBox.shrink(); 
      bool isAllowed = _whitelist.contains(a.packageName); 
      
      return ListTile(leading: a.icon != null ? Image.memory(a.icon!, width: 40) : const Icon(Icons.android), title: Text(a.name), subtitle: Text(isAllowed ? "VIP Allowed" : "Blocked by Zero Trust", style: TextStyle(color: isAllowed ? Colors.green : Colors.red, fontSize: 12)), trailing: Switch(value: isAllowed, activeColor: Colors.green, inactiveThumbColor: Colors.red, onChanged: (v) async { 
        setState(() { if (v) _whitelist.add(a.packageName); else _whitelist.remove(a.packageName); }); 
        final p = await SharedPreferences.getInstance(); 
        
        List<String> cList = p.getStringList('custom_whitelist') ?? []; 
        if (v) {
          if (!cList.contains(a.packageName)) cList.add(a.packageName);
        } else {
          cList.remove(a.packageName);
        }
        await p.setStringList('custom_whitelist', cList); 
        
        String empId = p.getString('emp_id') ?? '';
        if (empId.isNotEmpty) {
          await CloudSync.updateWhitelist(empId, cList);
        }
        
        await platformBlocker.invokeMethod('updateWhitelistedApps', {"apps": _whitelist.toList()}); 
      })); 
    });
  }
}

class MapTab extends StatelessWidget {
  final double currentLat, currentLng; final List<Offset> polygonPoints; const MapTab({super.key, required this.currentLat, required this.currentLng, required this.polygonPoints});
  @override Widget build(BuildContext context) { if (currentLat == 0) return const Center(child: CircularProgressIndicator()); return FlutterMap(options: MapOptions(initialCenter: LatLng(currentLat, currentLng), initialZoom: 16), children: [TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'com.sumit.env_guardian'), PolygonLayer(polygons: [Polygon(points: polygonPoints.map((p) => LatLng(p.dx, p.dy)).toList(), color: Colors.red.withOpacity(0.3), borderColor: Colors.red, borderStrokeWidth: 4, isFilled: true)]), MarkerLayer(markers: [Marker(point: LatLng(currentLat, currentLng), child: const Icon(Icons.my_location, color: Colors.blue, size: 30))])]); }
}

class LogTab extends StatefulWidget { const LogTab({super.key}); @override State<LogTab> createState() => _LogTabState(); }
class _LogTabState extends State<LogTab> {
  static const eventChannel = EventChannel('com.example.env_guardian/logs'); StreamSubscription? _sub; List<Map<String, dynamic>> _logs = [];
  @override void initState() { super.initState(); _fetch(); _sub = eventChannel.receiveBroadcastStream().listen((e) { if (mounted) setState(() => _logs.insert(0, Map<String, dynamic>.from(e))); }); }
  Future<void> _fetch() async { final List h = await platformBlocker.invokeMethod('getIronLedger'); if (mounted) setState(() => _logs = h.map((e) => Map<String, dynamic>.from(e)).toList()); }
  @override Widget build(BuildContext context) => Container(color: Colors.black, padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text("root@guardian-sentinel:~# tail -f /var/log/perimeter.log", style: TextStyle(color: Colors.grey, fontFamily: 'monospace', fontSize: 12)), const Divider(color: Colors.grey), Expanded(child: ListView.builder(itemCount: _logs.length, itemBuilder: (c, i) { final isBlocked = _logs[i]['blocked']; return Padding(padding: const EdgeInsets.symmetric(vertical: 4.0), child: Text("${_logs[i]['time']} ${isBlocked ? '[BLOCKED]' : '[ALLOWED]'} > ${_logs[i]['package']}", style: TextStyle(color: isBlocked ? Colors.redAccent : Colors.greenAccent, fontFamily: 'monospace', fontSize: 13))); }))]));
  @override void dispose() { _sub?.cancel(); super.dispose(); }
}