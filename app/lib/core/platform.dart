import 'package:flutter/services.dart';

/// Shared platform channel to the native Android side (MainActivity /
/// AppBlockerService): app blocking, accessibility + usage-access status,
/// and the on-device log ledger.
const platformBlocker = MethodChannel('com.example.env_guardian/blocker');
