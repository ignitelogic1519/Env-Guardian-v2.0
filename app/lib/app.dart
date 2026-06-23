import 'package:flutter/material.dart';
import 'core/theme/neumorphic.dart';
import 'features/command_center/command_center_screen.dart';
import 'features/onboarding/admin_setup_screen.dart';

/// Root widget. Shows the Command Center if the device is already sealed,
/// otherwise the first-run setup flow.
class EnvGuardianApp extends StatelessWidget {
  final bool isSealed; const EnvGuardianApp({super.key, required this.isSealed});
  @override Widget build(BuildContext context) => MaterialApp(debugShowCheckedModeBanner: false, theme: buildNeuTheme(), home: isSealed ? const CommandCenterScreen() : const AdminSetupScreen());
}
