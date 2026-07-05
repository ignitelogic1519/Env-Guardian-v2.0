import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:installed_apps/installed_apps.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../cloud_sync.dart';
import '../../core/platform.dart';
import '../../core/background_service.dart';
import '../../core/theme/neumorphic.dart';
import '../../core/theme/glass.dart';
import '../armory/armory_tab.dart';
import '../map/map_tab.dart';
import '../logs/log_tab.dart';

/// The main post-setup screen: tabbed status / armory / logs / map, plus the
/// QR authentication flow, the live zone timer, and the frozen-device screens.
class CommandCenterScreen extends StatefulWidget { const CommandCenterScreen({super.key}); @override State<CommandCenterScreen> createState() => _CommandCenterScreenState(); }
class _CommandCenterScreenState extends State<CommandCenterScreen> {
  int _tabIndex = 0; double _lat = 0, _lng = 0;
  bool _insideGeofence = false, _isPhysicallyVerified = false, _enforcerAlive = false, _isInitializing = true, _autoLock = false, _adminLock = false;
  bool _nOk = true, _fOk = true, _bOk = true, _oOk = true, _cOk = true, _gpsEnabled = true, _usageOk = false;
  bool _notifAccessOk = false; List<String> _runningOffenders = []; // feature A: pre-scan gate
  bool _autostartAck = false; // OEM auto-start can't be read back — track that the user visited it
  bool _vpnEnabled = false, _vpnRevoked = false; // feature B: network guard + tamper flag
  List<Offset> _poly = []; Timer? _t; Timer? _clock; int _verifiedSince = 0; final TextEditingController _unlockPassCtrl = TextEditingController();
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
    // Ticks once per second to refresh the live "time in zone" clock on screen.
    _clock = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted && _insideGeofence && _isPhysicallyVerified) setState(() {}); });
    Future.delayed(const Duration(seconds: 7), () { if (mounted) setState(() => _isInitializing = false); });
  }

  Future<void> _loadData() async { final p = await SharedPreferences.getInstance(); if (mounted) setState(() { _empName = p.getString('emp_name') ?? ""; _empId = p.getString('emp_id') ?? ""; _deviceId = p.getString('device_id') ?? ""; _deviceModel = p.getString('device_model') ?? ""; _poly = (json.decode(p.getString('geofence_polygon') ?? '[]') as List).map((p) => Offset((p['lat'] as num).toDouble(), (p['lng'] as num).toDouble())).toList(); }); }

  Future<void> _reqN() async { await Permission.notification.request(); _sync(); }
  Future<void> _reqF() async { await Permission.location.request(); _sync(); }
  Future<void> _reqB() async { await Permission.locationAlways.request(); await Permission.ignoreBatteryOptimizations.request(); _sync(); }
  Future<void> _reqO() async { await Permission.systemAlertWindow.request(); _sync(); }
  Future<void> _reqC() async { await Permission.camera.request(); _sync(); }
  Future<void> _reqGps() async { await Geolocator.openLocationSettings(); _sync(); }
  // Opens a system settings screen. The enforcer's anti-tamper shield would otherwise
  // kick the user straight back out of settings (esp. the app-details / OEM security
  // pages), so we arm a short grace window first that tells the native service to
  // stand down while the user toggles the required setting.
  Future<void> _armSettingsGrace() async { final p = await SharedPreferences.getInstance(); await p.setInt('enforcement_grace_until', DateTime.now().millisecondsSinceEpoch + 45000); }
  Future<void> _reqAccess() async { await _armSettingsGrace(); await platformBlocker.invokeMethod('openAccessibilitySettings'); _sync(); }
  Future<void> _reqUsage() async { await _armSettingsGrace(); try { await platformBlocker.invokeMethod('openUsageAccessSettings'); } catch (_) {} _sync(); }
  // Auto-start state can't be queried on Android, so tapping it records an
  // acknowledgement (the user has visited the OEM screen) which counts for compliance.
  Future<void> _reqAutostart() async { await _armSettingsGrace(); final p = await SharedPreferences.getInstance(); await p.setBool('autostart_ack', true); if (mounted) setState(() => _autostartAck = true); try { await platformBlocker.invokeMethod('openAutoStartSettings'); } catch (_) {} }
  Future<void> _reqNotifAccess() async { await _armSettingsGrace(); try { await platformBlocker.invokeMethod('openNotificationAccessSettings'); } catch (_) {} _refreshRunning(); }
  // Feature B: Network Guard is ALWAYS-ON by policy (granted once at setup) — there
  // is deliberately no in-app "off". This only (re)requests the one-time VPN consent
  // when it was never granted or the user revoked it on the device. The native
  // AppBlockerService reconciler then keeps it active in the zone every session.
  Future<void> _grantVpn() async {
    try { await platformBlocker.invokeMethod('prepareVpn'); } catch (_) {}
    final p = await SharedPreferences.getInstance();
    await p.setBool('vpn_enabled', true);
    await p.setBool('vpn_revoked', false);
    if (mounted) setState(() { _vpnEnabled = true; _vpnRevoked = false; });
    _sync();
  }

  // Feature A: figure out which non-whitelisted apps are currently running in the
  // background (apps with an active notification), so the QR scan can be gated.
  bool _isSystemish(String pkg) =>
      pkg.startsWith('com.android.') || pkg.startsWith('android') || pkg.contains('inputmethod') ||
      pkg.contains('systemui') || pkg.startsWith('com.google.android.gms') ||
      pkg.startsWith('com.samsung.android') || pkg.startsWith('com.miui') ||
      pkg.startsWith('com.coloros') || pkg.startsWith('com.oppo') || pkg.startsWith('com.vivo') ||
      pkg.startsWith('com.heytap') || pkg == 'com.envguardian.mdm';

  Future<void> _refreshRunning() async {
    bool ok = false; List<String> active = [];
    try { ok = await platformBlocker.invokeMethod('hasNotificationAccess'); } catch (_) {}
    if (ok) {
      try { final List r = await platformBlocker.invokeMethod('getActiveNotificationPackages'); active = r.map((e) => e.toString()).toList(); } catch (_) {}
    }
    final p = await SharedPreferences.getInstance();
    final wl = {...(p.getStringList('global_whitelist') ?? []), ...(p.getStringList('custom_whitelist') ?? [])};
    final offenders = active.where((pkg) => !wl.contains(pkg) && !_isSystemish(pkg)).toSet().toList()..sort();
    if (mounted) setState(() { _notifAccessOk = ok; _runningOffenders = offenders; });
  }

  Future<void> _sync() async {
    final p = await SharedPreferences.getInstance(); await p.reload();
    try { final inv = (await InstalledApps.getInstalledApps(excludeSystemApps: true)).map((a) => a.packageName).toList(); await p.setStringList('cached_inventory', inv); } catch (_) {}

    if ((DateTime.now().millisecondsSinceEpoch - (p.getInt('last_ghost_footprint') ?? DateTime.now().millisecondsSinceEpoch)) ~/ 1000 > 30 && (p.getBool('in_restricted_zone') ?? false)) await p.setBool('auto_lock', true);

    if (_empId.isNotEmpty) {
      final aData = await CloudSync.fetchAgentData(_empId);
      if (aData['success'] == true) {
        await p.setBool('admin_lock', aData['admin_lock'] ?? false);
        await p.setStringList('custom_whitelist', (aData['custom_whitelist'] as List<dynamic>?)?.map((e)=>e.toString()).toList() ?? []);
        await p.setString('app_policies', json.encode(aData['app_policies'] ?? []));
        await p.setString('feature_flags', json.encode(aData['feature_flags'] ?? {}));
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

    bool ua = false;
    try { ua = await platformBlocker.invokeMethod('hasUsageAccess'); } catch (_) {}
    bool na = false;
    try { na = await platformBlocker.invokeMethod('hasNotificationAccess'); } catch (_) {}
    bool asAck = p.getBool('autostart_ack') ?? false;
    // Persist so the background loop (which can't reliably reach these native
    // channels) can read the last-known state for its own compliance check.
    await p.setBool('usage_ok', ua);
    await p.setBool('notif_access_ok', na);

    List<Offset> poly = (json.decode(p.getString('geofence_polygon') ?? '[]') as List).map((e) => Offset((e['lat'] as num).toDouble(), (e['lng'] as num).toDouble())).toList();

    Set<String> merged = {
      ...(p.getStringList('global_whitelist') ?? []),
      ...(p.getStringList('custom_whitelist') ?? [])
    };
    bool aL = p.getBool('auto_lock') ?? false, adL = p.getBool('admin_lock') ?? false;
    // Usage Access, Notification Access and the OEM Auto-start acknowledgement are
    // now MANDATORY parts of compliance (alongside the runtime permissions + enforcer).
    bool comp = n && f && g && b && o && c && a && ua && na && asAck;
    final bool inZoneNow = p.getBool('in_restricted_zone') ?? false;

    if (aL || adL || !comp) merged.addAll(["com.android.settings", "com.google.android.permissioncontroller", "com.android.permissioncontroller", "com.miui.securitycenter", "com.coloros.safecenter"]);

    // Apply per-app time limits here too (not just in the background loop), so a
    // disabled / over-budget app drops out of BOTH the accessibility whitelist and
    // the VPN bypass list — losing its internet the moment its budget is spent.
    if (inZoneNow) { try { await enforceTimeLimits(p, _empId, merged); } catch (_) {} }

    await platformBlocker.invokeMethod('updateWhitelistedApps', {"apps": merged.toList()});

    // Feature B: the Network Guard VPN is reconciled NATIVELY (in AppBlockerService,
    // off in_restricted_zone + vpn_enabled + the native whitelist) so it reliably
    // starts on zone entry, refreshes on whitelist change, and — importantly —
    // STOPS on zone exit even when the UI is closed. Pushing the fresh whitelist
    // above is all the UI needs to do; no Flutter-side VPN calls here.

    if (mounted) setState(() { _poly = poly; _insideGeofence = p.getBool('in_restricted_zone') ?? false; _isPhysicallyVerified = p.getBool('is_physically_verified') ?? false; _lat = p.getDouble('current_lat') ?? 0; _lng = p.getDouble('current_lng') ?? 0; _enforcerAlive = a; _autoLock = aL; _adminLock = adL; _nOk = n; _fOk = f; _gpsEnabled = g; _bOk = b; _oOk = o; _cOk = c; _usageOk = ua; _notifAccessOk = na; _autostartAck = asAck; _vpnEnabled = p.getBool('vpn_enabled') ?? false; _vpnRevoked = p.getBool('vpn_revoked') ?? false; _verifiedSince = p.getInt('verified_since') ?? 0; });
    _refreshRunning();
  }

  Future<void> _unfreezeDevice() async {
    if (_unlockPassCtrl.text == await CloudSync.getAdminPassword()) {
      final p = await SharedPreferences.getInstance(); await p.setBool('auto_lock', false); await p.setInt('last_ghost_footprint', DateTime.now().millisecondsSinceEpoch); await CloudSync.executeAmnesiaProtocol(_empId);
      setState(() { _autoLock = false; _unlockPassCtrl.clear(); }); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Auto-Lock Cleared."), backgroundColor: Colors.green));
    } else { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Incorrect Admin Password"), backgroundColor: Colors.red)); }
  }

  @override Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: false,
      appBar: AppBar(title: const Text("Command Center", style: TextStyle(fontWeight: FontWeight.bold)), backgroundColor: (_autoLock || _adminLock) ? Colors.red.withOpacity(0.28) : Colors.transparent, actions: [IconButton(tooltip: "Security Features", icon: Icon(_vpnRevoked ? Icons.gpp_bad : Icons.tune, color: _vpnRevoked ? Colors.orangeAccent : Colors.blueAccent, size: 28), onPressed: _openSecuritySheet), IconButton(icon: const Icon(Icons.account_circle, color: Colors.blueAccent, size: 30), onPressed: () => showModalBottomSheet(context: context, backgroundColor: Colors.transparent, builder: (c) => GlassCard(radius: 30, margin: const EdgeInsets.all(10), padding: const EdgeInsets.all(30), child: Column(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.badge, size: 60, color: Colors.blueAccent), Text(_empName, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: Colors.white)), Text("ID: $_empId", style: const TextStyle(color: Colors.blueAccent, fontWeight: FontWeight.bold)), const Divider(color: Colors.white24), Row(children: [const Icon(Icons.phone_android, color: Colors.white54), const SizedBox(width: 15), const Text("Model:"), const Spacer(), Text(_deviceModel)]), Row(children: [const Icon(Icons.fingerprint, color: Colors.white54), const SizedBox(width: 15), const Text("Device ID:"), const Spacer(), Text(_deviceId)])])))), const SizedBox(width: 10)]),
      body: AnimatedSwitcher(
        duration: const Duration(milliseconds: 350),
        transitionBuilder: (child, anim) => FadeTransition(opacity: anim, child: child),
        child: KeyedSubtree(
          key: ValueKey(_tabIndex),
          child: [_buildStatusTab(), const ArmoryTab(), const LogTab(), MapTab(currentLat: _lat, currentLng: _lng, polygonPoints: _poly)][_tabIndex],
        ),
      ),
      bottomNavigationBar: BottomNavigationBar(currentIndex: _tabIndex, onTap: (i) => setState(() => _tabIndex = i), type: BottomNavigationBarType.fixed, backgroundColor: Colors.black.withOpacity(0.30), elevation: 0, selectedItemColor: Colors.blueAccent, unselectedItemColor: Colors.white38, items: const [BottomNavigationBarItem(icon: Icon(Icons.radar), label: "Status"), BottomNavigationBarItem(icon: Icon(Icons.security), label: "Armory"), BottomNavigationBarItem(icon: Icon(Icons.terminal), label: "Logs"), BottomNavigationBarItem(icon: Icon(Icons.map), label: "Map")]),
    );
  }

  Widget _buildStatusTab() {
    if (_isInitializing) return const Center(child: CircularProgressIndicator());
    if (_adminLock) return _buildFrozenScreen(true); if (_autoLock) return _buildFrozenScreen(false);
    if (!(_nOk && _fOk && _gpsEnabled && _bOk && _oOk && _cOk && _enforcerAlive && _usageOk && _notifAccessOk && _autostartAck)) return Center(child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [const Icon(Icons.gpp_maybe, size: 80, color: Colors.orangeAccent), const SizedBox(height: 10), const Text("COMPLIANCE REQUIRED", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.orangeAccent)), const SizedBox(height: 6), const Text("All items below are mandatory.", style: TextStyle(color: Colors.white54, fontSize: 12)), const SizedBox(height: 16), GlassCard(padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8), child: Column(children: [_shieldTile("Location", _fOk, _reqF), _shieldTile("GPS", _gpsEnabled, _reqGps), _shieldTile("Camera", _cOk, _reqC), _shieldTile("Enforcer", _enforcerAlive, _reqAccess), _shieldTile("Notifications", _nOk, _reqN), _shieldTile("Battery", _bOk, _reqB), _shieldTile("Overlay", _oOk, _reqO), _shieldTile("Usage Access (time limits)", _usageOk, _reqUsage), _shieldTile("Notification Access (app-close gate)", _notifAccessOk, _reqNotifAccess), _shieldTile("Auto-start / keep alive (OEM)", _autostartAck, _reqAutostart)]))])));

    if (!_insideGeofence) return const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.shield, size: 100, color: Colors.greenAccent), Text("SAFE ZONE", style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.greenAccent)), Text("Move to Restricted Zone to authorize.")]));

    if (_insideGeofence && _isPhysicallyVerified) {
      final String elapsed = _verifiedSince > 0 ? fmtDuration(DateTime.now().millisecondsSinceEpoch - _verifiedSince) : "00:00:00";
      return Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        const Icon(Icons.verified_user, size: 100, color: Colors.blueAccent),
        const Text("SECURE ZONE ACTIVE", style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.blueAccent)),
        const Text("Zero Trust Perimeter Engaged.", style: TextStyle(color: Colors.white70)),
        const SizedBox(height: 36),
        FadeInUp(child: GlassCard(padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 24), child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text("TIME IN ZONE", style: TextStyle(color: NeuColors.textMuted, fontSize: 14, letterSpacing: 3)),
          const SizedBox(height: 6),
          Text(elapsed, style: const TextStyle(fontSize: 46, fontWeight: FontWeight.bold, color: Colors.greenAccent)),
        ]))),
      ]));
    }

    // Feature A: gate the scanner until non-whitelisted background apps are closed.
    if (_notifAccessOk && _runningOffenders.isNotEmpty) return _buildCloseAppsGate();

    return Column(children: [const Padding(padding: EdgeInsets.all(20), child: Text("SCAN TO AUTHENTICATE", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.greenAccent))), Expanded(child: Container(margin: const EdgeInsets.all(20), decoration: BoxDecoration(border: Border.all(color: Colors.greenAccent, width: 4), borderRadius: BorderRadius.circular(20)), child: ClipRRect(borderRadius: BorderRadius.circular(16), child: MobileScanner(onDetect: (cap) async {
      for (final b in cap.barcodes) {
        if (b.rawValue == null) continue;
        // Validates against the static secret OR the rotating (TOTP) code per qr_mode.
        if (await CloudSync.validateScannedQr(b.rawValue!)) {
          final p = await SharedPreferences.getInstance();
          final int nowMs = DateTime.now().millisecondsSinceEpoch;
          await p.setBool('is_physically_verified', true);
          await p.setInt('verified_since', nowMs);
          setState(() { _isPhysicallyVerified = true; _verifiedSince = nowMs; });
          break;
        }
      }
    })))) , const Padding(padding: EdgeInsets.only(bottom: 30), child: Text("Position Static QR code inside frame.", style: TextStyle(color: Colors.white54)))]);
  }

  Widget _buildFrozenScreen(bool isAdmin) => Center(child: Padding(padding: const EdgeInsets.all(30), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [const Icon(Icons.lock_person, size: 100, color: Colors.redAccent), Text(isAdmin ? "ADMIN LOCK" : "AUTO-LOCK", style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.redAccent)), Text(isAdmin ? "Banishment Decree issued by Server." : "Time Anomaly Detected.", style: const TextStyle(color: Colors.white70)), const SizedBox(height: 40), if (!isAdmin) ...[TextField(controller: _unlockPassCtrl, obscureText: true, decoration: InputDecoration(labelText: "Admin Unfreeze Password", filled: true, fillColor: Colors.grey[900])), const SizedBox(height: 20), ElevatedButton.icon(style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent, foregroundColor: Colors.white, minimumSize: const Size(double.infinity, 60)), icon: const Icon(Icons.key), label: const Text("UNFREEZE"), onPressed: _unfreezeDevice)] else const Icon(Icons.cloud_off, size: 50, color: Colors.white30), const SizedBox(height: 30), ElevatedButton(style: ElevatedButton.styleFrom(backgroundColor: Colors.grey[800], foregroundColor: Colors.white), onPressed: () => platformBlocker.invokeMethod('openAccessibilitySettings'), child: const Text("Open Phone Settings"))])));
  Widget _shieldTile(String t, bool ok, VoidCallback tap) => ListTile(dense: true, title: Text(t, style: const TextStyle(color: Colors.white)), trailing: Icon(ok ? Icons.check_circle : Icons.open_in_new, color: ok ? Colors.green : Colors.orangeAccent), onTap: ok ? null : tap);

  // Always-available panel reachable from the app bar at any time. The three
  // special-access protections (Usage / Notification Access / OEM Auto-start) are
  // now MANDATORY and live on the Compliance screen; they're mirrored here for a
  // quick re-check. Network Guard is the always-on VPN (re-grant only).
  void _openSecuritySheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSheet) {
        Future<void> refresh() async { await _sync(); if (mounted) setSheet(() {}); }
        return GlassCard(radius: 30, margin: const EdgeInsets.all(10), padding: const EdgeInsets.all(20), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Row(children: [Icon(Icons.tune, color: Colors.blueAccent), SizedBox(width: 10), Text("Security Features", style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white))]),
          const SizedBox(height: 4),
          const Text("Mandatory protections (also on the Compliance screen) plus the always-on Network Guard. Re-check or re-grant here any time.", style: TextStyle(color: Colors.white54, fontSize: 12)),
          const Divider(color: Colors.white24, height: 24),
          _shieldTile("Usage Access (per-app time limits)", _usageOk, () async { await _reqUsage(); await refresh(); }),
          _shieldTile("Notification Access (pre-scan app-close gate)", _notifAccessOk, () async { await _reqNotifAccess(); await refresh(); }),
          _shieldTile("Auto-start / keep alive (OEM)", _autostartAck, () async { await _reqAutostart(); await refresh(); }),
          ListTile(
            dense: true,
            leading: Icon((_vpnEnabled && !_vpnRevoked) ? Icons.vpn_lock : Icons.gpp_bad, color: (_vpnEnabled && !_vpnRevoked) ? Colors.green : Colors.orangeAccent),
            title: const Text("Network Guard (always-on in-zone)", style: TextStyle(color: Colors.white)),
            subtitle: Text(
              _vpnRevoked
                  ? "⚠ Turned off on the device — re-enables automatically in-zone (tamper reported)"
                  : (_vpnEnabled
                      ? "Active — auto-enables in the restricted zone; cannot be turned off in-app"
                      : "Not granted — tap Enable to give the one-time consent"),
              style: TextStyle(color: _vpnRevoked ? Colors.orangeAccent : Colors.white38, fontSize: 11),
            ),
            trailing: (_vpnEnabled && !_vpnRevoked)
                ? const Icon(Icons.lock, color: Colors.white38, size: 18)
                : TextButton(onPressed: () async { await _grantVpn(); await refresh(); }, child: const Text("Enable")),
          ),
          const SizedBox(height: 8),
        ]));
      }),
    );
  }

  // Feature A: shown instead of the scanner while non-whitelisted apps are running.
  Widget _buildCloseAppsGate() => Center(child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: FadeInUp(child: GlassCard(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.do_not_disturb_on, size: 70, color: Colors.orangeAccent),
        const SizedBox(height: 12),
        const Text("CLOSE THESE APPS", style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.orangeAccent)),
        const SizedBox(height: 6),
        const Text("These apps are running in the background. Close them (swipe away from Recents), then re-check to unlock scanning.", textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, fontSize: 13)),
        const SizedBox(height: 16),
        ..._runningOffenders.take(15).map((pkg) => ListTile(dense: true, leading: const Icon(Icons.warning_amber_rounded, color: Colors.redAccent, size: 20), title: Text(pkg, style: const TextStyle(color: Colors.white, fontSize: 13)))),
        const SizedBox(height: 12),
        ElevatedButton.icon(style: ElevatedButton.styleFrom(backgroundColor: Colors.greenAccent, foregroundColor: Colors.black, minimumSize: const Size(double.infinity, 48)), icon: const Icon(Icons.refresh), label: const Text("I'VE CLOSED THEM — RE-CHECK"), onPressed: _refreshRunning),
      ])))));
  @override void dispose() { _t?.cancel(); _clock?.cancel(); _unlockPassCtrl.dispose(); super.dispose(); }
}
