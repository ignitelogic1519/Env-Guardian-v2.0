import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/theme/glass.dart';
import '../../core/theme/neumorphic.dart';
import '../../core/background_service.dart';

/// Policy tab — shows every policy the device is currently enforcing, pulled
/// straight from the device's own synced state (no network call):
///   • the effective whitelist (global ∪ per-device custom),
///   • per-app daily time budgets, and — the headline — the TIME LEFT today for
///     each timed whitelist app (budget minus in-zone usage), counted only while
///     inside the restricted zone.
class PolicyTab extends StatefulWidget {
  const PolicyTab({super.key});
  @override
  State<PolicyTab> createState() => _PolicyTabState();
}

class _PolicyTabState extends State<PolicyTab> {
  Timer? _t;
  bool _timeLimitsOn = false;
  bool _inZone = false;
  List<String> _globalWl = [];
  List<String> _customWl = [];
  List<Map<String, dynamic>> _policies = [];
  Map<String, int> _usage = {};

  @override
  void initState() {
    super.initState();
    _load();
    // Refresh every second so the "time left" countdown ticks live in-zone.
    _t = Timer.periodic(const Duration(seconds: 1), (_) => _load());
  }

  Future<void> _load() async {
    final p = await SharedPreferences.getInstance();
    await p.reload();
    Map<String, dynamic> flags = {};
    try { flags = json.decode(p.getString('feature_flags') ?? '{}') as Map<String, dynamic>; } catch (_) {}
    List<dynamic> pol = [];
    try { pol = json.decode(p.getString('app_policies') ?? '[]') as List<dynamic>; } catch (_) {}

    if (!mounted) return;
    setState(() {
      _timeLimitsOn = flags['app_time_limits'] == true;
      _inZone = p.getBool('in_restricted_zone') ?? false;
      _globalWl = p.getStringList('global_whitelist') ?? [];
      _customWl = p.getStringList('custom_whitelist') ?? [];
      _policies = pol.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      _usage = readInZoneUsage(p);
    });
  }

  // Short package label — the last dotted segment, so "com.google.android.youtube"
  // reads as "youtube".
  String _short(String pkg) {
    final parts = pkg.split('.');
    return parts.isEmpty ? pkg : parts.last;
  }

  @override
  Widget build(BuildContext context) {
    final Set<String> whitelist = {..._globalWl, ..._customWl};
    // Map policies by package for quick lookup.
    final Map<String, Map<String, dynamic>> polByPkg = {
      for (final pol in _policies) (pol['package'] ?? '').toString(): pol
    };
    // Timed apps: whitelist apps that have a policy with a daily limit > 0.
    final timedApps = whitelist.where((pkg) {
      final pol = polByPkg[pkg];
      if (pol == null) return false;
      final int limit = (pol['daily_limit_ms'] as num?)?.toInt() ?? 0;
      return limit > 0;
    }).toList()
      ..sort();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // Header + feature-key status.
        GlassCard(
          padding: const EdgeInsets.all(18),
          child: Row(children: [
            const Icon(Icons.policy, color: Colors.blueAccent, size: 30),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text("DEVICE POLICY", style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
                const SizedBox(height: 2),
                Text(
                  _inZone ? "Inside restricted zone — enforcing" : "Safe zone — policy applies on entry",
                  style: TextStyle(color: _inZone ? Colors.redAccent : Colors.greenAccent, fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ]),
            ),
            _pill(_timeLimitsOn ? "Timers ON" : "Timers OFF", _timeLimitsOn ? Colors.greenAccent : Colors.white38),
          ]),
        ),
        const SizedBox(height: 14),

        // ── Time left for timed whitelist apps ──────────────────────────────
        const Padding(padding: EdgeInsets.symmetric(vertical: 6, horizontal: 4),
          child: Text("TIME LEFT TODAY (IN-ZONE)", style: TextStyle(color: NeuColors.textMuted, fontSize: 12, letterSpacing: 2, fontWeight: FontWeight.bold))),
        if (!_timeLimitsOn)
          _hintCard("No time-limit key is active for this device. Whitelisted apps have no timer applied.")
        else if (timedApps.isEmpty)
          _hintCard("No timed apps configured. The admin hasn't set a daily budget on any whitelisted app yet.")
        else
          ...timedApps.map((pkg) {
            final pol = polByPkg[pkg]!;
            final bool enabled = pol['enabled'] ?? true;
            final int limit = (pol['daily_limit_ms'] as num?)?.toInt() ?? 0;
            final int used = _usage[pkg] ?? 0;
            final int left = (limit - used).clamp(0, limit);
            final double frac = limit > 0 ? (used / limit).clamp(0.0, 1.0) : 0.0;
            final bool exhausted = !enabled || left <= 0;
            final Color barColor = exhausted ? Colors.redAccent : (frac > 0.75 ? Colors.orangeAccent : Colors.greenAccent);
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: GlassCard(
                padding: const EdgeInsets.all(14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(_short(pkg), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15))),
                    Text(
                      exhausted ? "BLOCKED" : fmtDuration(left),
                      style: TextStyle(color: barColor, fontWeight: FontWeight.bold, fontSize: 16, fontFamily: 'monospace'),
                    ),
                  ]),
                  const SizedBox(height: 2),
                  Text(pkg, style: const TextStyle(color: Colors.white38, fontSize: 11, fontFamily: 'monospace')),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(value: frac, minHeight: 7, backgroundColor: Colors.white12, valueColor: AlwaysStoppedAnimation(barColor)),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    exhausted
                        ? (enabled ? "Daily budget spent — blocked until midnight" : "Disabled by admin — always blocked in zone")
                        : "${fmtDuration(used)} used of ${fmtDuration(limit)} budget",
                    style: const TextStyle(color: Colors.white54, fontSize: 11),
                  ),
                ]),
              ),
            );
          }),

        const SizedBox(height: 14),
        // ── All whitelisted apps ────────────────────────────────────────────
        const Padding(padding: EdgeInsets.symmetric(vertical: 6, horizontal: 4),
          child: Text("ALLOWED APPS IN ZONE", style: TextStyle(color: NeuColors.textMuted, fontSize: 12, letterSpacing: 2, fontWeight: FontWeight.bold))),
        if (whitelist.isEmpty)
          _hintCard("No apps are whitelisted — every app is blocked inside the zone.")
        else
          GlassCard(
            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 6),
            child: Column(children: whitelist.toList().map((pkg) {
              final pol = polByPkg[pkg];
              final int limit = (pol?['daily_limit_ms'] as num?)?.toInt() ?? 0;
              final bool enabled = pol?['enabled'] ?? true;
              String sub;
              Color subColor;
              if (!enabled) { sub = "Disabled by policy"; subColor = Colors.redAccent; }
              else if (_timeLimitsOn && limit > 0) {
                final int left = (limit - (_usage[pkg] ?? 0)).clamp(0, limit);
                sub = left <= 0 ? "Time up — blocked" : "${fmtDuration(left)} left today";
                subColor = left <= 0 ? Colors.redAccent : Colors.greenAccent;
              } else { sub = "No timer"; subColor = Colors.white38; }
              return ListTile(
                dense: true,
                leading: const Icon(Icons.check_circle, color: Colors.greenAccent, size: 20),
                title: Text(_short(pkg), style: const TextStyle(color: Colors.white, fontSize: 14)),
                subtitle: Text(pkg, style: const TextStyle(color: Colors.white38, fontSize: 10, fontFamily: 'monospace')),
                trailing: Text(sub, style: TextStyle(color: subColor, fontSize: 11, fontWeight: FontWeight.w600)),
              );
            }).toList()),
          ),
        const SizedBox(height: 20),
      ]),
    );
  }

  Widget _pill(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(color: color.withOpacity(0.16), borderRadius: BorderRadius.circular(20), border: Border.all(color: color.withOpacity(0.5))),
        child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 11)),
      );

  Widget _hintCard(String text) => GlassCard(
        padding: const EdgeInsets.all(16),
        child: Row(children: [
          const Icon(Icons.info_outline, color: Colors.white38, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(color: Colors.white54, fontSize: 12.5))),
        ]),
      );

  @override
  void dispose() { _t?.cancel(); super.dispose(); }
}
