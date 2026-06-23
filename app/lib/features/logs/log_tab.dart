import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/platform.dart';

/// Logs tab — a terminal-style live feed of allow/block decisions, streamed
/// from the native AppBlockerService via an EventChannel.
class LogTab extends StatefulWidget { const LogTab({super.key}); @override State<LogTab> createState() => _LogTabState(); }
class _LogTabState extends State<LogTab> {
  static const eventChannel = EventChannel('com.example.env_guardian/logs'); StreamSubscription? _sub; List<Map<String, dynamic>> _logs = [];
  @override void initState() { super.initState(); _fetch(); _sub = eventChannel.receiveBroadcastStream().listen((e) { if (mounted) setState(() => _logs.insert(0, Map<String, dynamic>.from(e))); }); }
  Future<void> _fetch() async { final List h = await platformBlocker.invokeMethod('getIronLedger'); if (mounted) setState(() => _logs = h.map((e) => Map<String, dynamic>.from(e)).toList()); }
  @override Widget build(BuildContext context) => Container(color: Colors.black, padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text("root@guardian-sentinel:~# tail -f /var/log/perimeter.log", style: TextStyle(color: Colors.grey, fontFamily: 'monospace', fontSize: 12)), const Divider(color: Colors.grey), Expanded(child: ListView.builder(itemCount: _logs.length, itemBuilder: (c, i) { final isBlocked = _logs[i]['blocked']; return Padding(padding: const EdgeInsets.symmetric(vertical: 4.0), child: Text("${_logs[i]['time']} ${isBlocked ? '[BLOCKED]' : '[ALLOWED]'} > ${_logs[i]['package']}", style: TextStyle(color: isBlocked ? Colors.redAccent : Colors.greenAccent, fontFamily: 'monospace', fontSize: 13))); }))]));
  @override void dispose() { _sub?.cancel(); super.dispose(); }
}
