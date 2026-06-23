import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'cloud_sync.dart';
import 'app.dart';
import 'core/background_service.dart';

/// Application entry point.
///
/// The app is organised feature-first so each part can be owned independently:
///   core/      → shared plumbing (platform channel, background service, theme)
///   features/  → one folder per feature (onboarding, command_center, armory,
///                map, logs)
///   app.dart   → the root MaterialApp
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await flutterLocalNotificationsPlugin.initialize(const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')));
  final prefs = await SharedPreferences.getInstance();
  final bool isSealed = prefs.getBool('is_sealed') ?? false;
  await initializeGhost(isSealed);
  await CloudSync.syncSettings();
  runApp(EnvGuardianApp(isSealed: isSealed));
}
