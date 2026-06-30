import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:installed_apps/app_info.dart';
import 'package:installed_apps/installed_apps.dart';
import '../../cloud_sync.dart';
import '../../core/platform.dart';

/// Armory tab — the admin-only "Zero Trust Vault" where allowed apps
/// (the custom whitelist) are toggled per device.
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
      final a = _apps[i]; if (a.packageName == "com.envguardian.mdm") return const SizedBox.shrink();
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
