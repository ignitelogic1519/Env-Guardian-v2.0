import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:http/http.dart' as http;
import '../../cloud_sync.dart';
import '../../core/platform.dart';
import '../../core/permissions_ux.dart';
import '../../core/theme/glass.dart';
import '../command_center/command_center_screen.dart';

/// First-run screen ("Sentinel Initiation"): collects identity, walks the user
/// through every required permission, then registers + seals the device.
class AdminSetupScreen extends StatefulWidget { const AdminSetupScreen({super.key}); @override State<AdminSetupScreen> createState() => _AdminSetupScreenState(); }
class _AdminSetupScreenState extends State<AdminSetupScreen> {
  bool _nOk = false, _fOk = false, _bOk = false, _oOk = false, _cOk = false, _aOk = false, _vpnOk = false;
  bool _usageOk = false, _notifOk = false, _autoStartAck = false; // now-mandatory special-access grants
  bool _accessAttempted = false; // first tap opens settings; a failed retry opens the restricted-settings help
  final TextEditingController _nameCtrl = TextEditingController(), _empIdCtrl = TextEditingController(); Timer? _setupTimer;

  @override void initState() {
    super.initState();
    _reqN();
    _setupTimer = Timer.periodic(const Duration(seconds: 2), (_) => _checkNativeGates());
    _nameCtrl.addListener(() => setState(() {}));
    _empIdCtrl.addListener(() => setState(() {}));
  }

  // Polls the two native gates that can't be observed via permission_handler:
  // the accessibility enforcer's liveness, and whether the one-time VPN consent
  // has been granted. Once VPN consent exists we mark the Network Guard as
  // permanently enabled so it auto-activates in the zone on every session.
  Future<void> _checkNativeGates() async {
    try {
      final bool isAlive = await platformBlocker.invokeMethod('checkEnforcerStatus');
      if (mounted) setState(() => _aOk = isAlive);
    } catch (e) {
      debugPrint("Live wire check failed: $e");
    }
    try {
      final bool vpn = await platformBlocker.invokeMethod('hasVpnConsent');
      if (vpn) {
        final p = await SharedPreferences.getInstance();
        await p.setBool('vpn_enabled', true); // always-on from here; no later prompt
      }
      if (mounted) setState(() => _vpnOk = vpn);
    } catch (e) {
      debugPrint("VPN consent check failed: $e");
    }
    // Usage Access + Notification Access are now mandatory. Poll + persist so the
    // rest of the app (incl. the background loop) sees the granted state.
    try {
      final bool ua = await platformBlocker.invokeMethod('hasUsageAccess');
      final bool na = await platformBlocker.invokeMethod('hasNotificationAccess');
      final p = await SharedPreferences.getInstance();
      await p.setBool('usage_ok', ua);
      await p.setBool('notif_access_ok', na);
      if (mounted) setState(() { _usageOk = ua; _notifOk = na; });
    } catch (e) {
      debugPrint("Special-access check failed: $e");
    }
  }

  // One-time VPN consent. Launches the system dialog; the periodic gate check
  // above picks up the grant and flips _vpnOk + enables the always-on guard.
  Future<void> _reqVpn() async {
    try { await platformBlocker.invokeMethod('prepareVpn'); } catch (_) {}
    _checkNativeGates();
  }

  // Arms a short grace window so the enforcer stands down while the user is on a
  // system settings screen (otherwise the anti-tamper shield can bounce them out).
  Future<void> _armSettingsGrace() async { final p = await SharedPreferences.getInstance(); await p.setInt('enforcement_grace_until', DateTime.now().millisecondsSinceEpoch + 45000); }
  // First tap goes straight to the Accessibility screen. If the user comes back
  // with the enforcer still dead (toggle blocked by Android 13+ "Restricted
  // settings" on sideloaded installs, or reverted by the OEM battery manager),
  // the next tap opens the step-by-step recovery guide instead.
  Future<void> _openAccessibility() async {
    await _armSettingsGrace();
    if (_accessAttempted && !_aOk && mounted) { await showAccessibilityHelp(context); return; }
    _accessAttempted = true;
    await platformBlocker.invokeMethod('openAccessibilitySettings');
  }
  Future<void> _reqUsage() async { await _armSettingsGrace(); try { await platformBlocker.invokeMethod('openUsageAccessSettings'); } catch (_) {} _checkNativeGates(); }
  Future<void> _reqNotifAccess() async { await _armSettingsGrace(); try { await platformBlocker.invokeMethod('openNotificationAccessSettings'); } catch (_) {} _checkNativeGates(); }
  // Auto-start has no queryable state; tapping records an acknowledgement.
  Future<void> _reqAutostart() async { await _armSettingsGrace(); final p = await SharedPreferences.getInstance(); await p.setBool('autostart_ack', true); if (mounted) setState(() => _autoStartAck = true); try { await platformBlocker.invokeMethod('openAutoStartSettings'); } catch (_) {} }

  Future<void> _reqN() async { final s = await Permission.notification.request(); setState(() => _nOk = s.isGranted); }
  Future<void> _reqF() async { final s = await Permission.location.request(); setState(() => _fOk = s.isGranted); }
  // Play policy: the prominent disclosure MUST be shown and accepted before the
  // system background-location prompt fires.
  Future<void> _reqB() async { if (!_fOk) return; if (!mounted || !await showBackgroundLocationDisclosure(context)) return; final s = await Permission.locationAlways.request(); if (s.isGranted) await Permission.ignoreBatteryOptimizations.request(); setState(() => _bOk = s.isGranted); }
  Future<void> _reqO() async { final s = await Permission.systemAlertWindow.request(); setState(() => _oOk = s.isGranted); }
  Future<void> _reqC() async { final s = await Permission.camera.request(); setState(() => _cOk = s.isGranted); }

  @override Widget build(BuildContext context) {
    bool canSeal = _nOk && _fOk && _bOk && _oOk && _cOk && _aOk && _vpnOk && _usageOk && _notifOk && _autoStartAck && _nameCtrl.text.trim().isNotEmpty && _empIdCtrl.text.trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: const Text("Sentinel Initiation"), centerTitle: true),
      body: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: FadeInUp(child: GlassCard(padding: const EdgeInsets.all(24), child: Column(children: [
        const Icon(Icons.security, size: 80, color: Colors.blueAccent), const SizedBox(height: 30),
        TextField(controller: _nameCtrl, decoration: InputDecoration(labelText: "Employee Name", prefixIcon: const Icon(Icons.person), filled: true, fillColor: Colors.grey[900], border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)))), const SizedBox(height: 15),
        TextField(controller: _empIdCtrl, decoration: InputDecoration(labelText: "Employee ID", prefixIcon: const Icon(Icons.badge), filled: true, fillColor: Colors.grey[900], border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)))), const SizedBox(height: 30),
        _permTile("0. Notifications", _nOk, _reqN), _permTile("1. Location", _fOk, _reqF), _permTile("2. Background & Battery", _bOk, _reqB), _permTile("3. System Overlay", _oOk, _reqO), _permTile("4. Camera", _cOk, _reqC),
        ListTile(title: const Text("5. Accessibility Enforcer"), trailing: Icon(_aOk ? Icons.check_circle : Icons.open_in_new, color: _aOk ? Colors.green : Colors.orangeAccent), onTap: _openAccessibility),
        ListTile(title: const Text("6. Network Guard (VPN)"), subtitle: const Text("One-time consent — auto-activates in the zone, always on", style: TextStyle(fontSize: 11, color: Colors.white54)), trailing: Icon(_vpnOk ? Icons.check_circle : Icons.open_in_new, color: _vpnOk ? Colors.green : Colors.orangeAccent), onTap: _vpnOk ? null : _reqVpn),
        ListTile(title: const Text("7. Usage Access"), subtitle: const Text("Per-app time limits", style: TextStyle(fontSize: 11, color: Colors.white54)), trailing: Icon(_usageOk ? Icons.check_circle : Icons.open_in_new, color: _usageOk ? Colors.green : Colors.orangeAccent), onTap: _usageOk ? null : _reqUsage),
        ListTile(title: const Text("8. Notification Access"), subtitle: const Text("Pre-scan app-close gate", style: TextStyle(fontSize: 11, color: Colors.white54)), trailing: Icon(_notifOk ? Icons.check_circle : Icons.open_in_new, color: _notifOk ? Colors.green : Colors.orangeAccent), onTap: _notifOk ? null : _reqNotifAccess),
        ListTile(title: const Text("9. Auto-start (OEM)"), subtitle: const Text("Keep the monitor alive on aggressive skins", style: TextStyle(fontSize: 11, color: Colors.white54)), trailing: Icon(_autoStartAck ? Icons.check_circle : Icons.open_in_new, color: _autoStartAck ? Colors.green : Colors.orangeAccent), onTap: _autoStartAck ? null : _reqAutostart), const SizedBox(height: 50),
        if (canSeal) ElevatedButton(style: ElevatedButton.styleFrom(backgroundColor: Colors.green, minimumSize: const Size(double.infinity, 50)), onPressed: () async {
          final p = await SharedPreferences.getInstance(); final deviceInfo = DeviceInfoPlugin(); String dId = "Unknown ID", dModel = "Unknown Model", androidVersion = "Unknown"; int sdkInt = 0;
          if (Platform.isAndroid) { AndroidDeviceInfo androidInfo = await deviceInfo.androidInfo; dId = androidInfo.id; dModel = "${androidInfo.manufacturer} ${androidInfo.model}"; androidVersion = androidInfo.version.release; sdkInt = androidInfo.version.sdkInt; }
          int now = DateTime.now().millisecondsSinceEpoch; String eName = _nameCtrl.text.trim(), eId = _empIdCtrl.text.trim();
          try { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Forging identity...")));
            final response = await http.post(Uri.parse("${CloudSync.baseUrl}/api/register"), headers: {"Content-Type": "application/json", "x-api-key": CloudSync.apiKey}, body: json.encode({"empName": eName, "empId": eId, "deviceId": dId, "deviceModel": dModel, "androidVersion": androidVersion, "sdkInt": sdkInt, "registeredAt": now}));
            if (response.statusCode == 201) { final agentJson = (json.decode(response.body)['agent'] ?? {}) as Map<String, dynamic>; await p.setString('device_token', (agentJson['device_token'] ?? '').toString()); await p.setString('emp_name', eName); await p.setString('emp_id', eId); await p.setString('device_id', dId); await p.setString('device_model', dModel); await p.setString('android_version', androidVersion); await p.setInt('sdk_int', sdkInt); await p.setInt('registration_time', now); await p.setInt('last_ghost_footprint', DateTime.now().millisecondsSinceEpoch); await p.setBool('vpn_enabled', true); await p.setBool('is_sealed', true); await FlutterBackgroundService().startService(); if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const CommandCenterScreen())); }
            else { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("SERVER REJECTED: ${json.decode(response.body)['message']}"), backgroundColor: Colors.red)); }
          } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("FATAL: Could not connect to Server."), backgroundColor: Colors.red)); }
        }, child: const Text("SEAL DEVICE & REGISTER", style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white)))
      ]))))),
    );
  }
  Widget _permTile(String t, bool ok, VoidCallback tap) => ListTile(title: Text(t), trailing: Icon(ok ? Icons.check_circle : Icons.circle_outlined, color: ok ? Colors.green : Colors.red), onTap: ok ? null : tap);
  @override void dispose() { _setupTimer?.cancel(); _nameCtrl.dispose(); _empIdCtrl.dispose(); super.dispose(); }
}
