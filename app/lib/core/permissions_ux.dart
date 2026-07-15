import 'package:flutter/material.dart';
import 'platform.dart';

/// Shared permission-UX dialogs used by onboarding and the command center.
///
/// Two jobs:
///  1. [showBackgroundLocationDisclosure] — the Play-policy "prominent
///     disclosure" that MUST be shown and accepted BEFORE the system
///     background-location prompt (Play rejects the app without it).
///  2. [showAccessibilityHelp] — recovery guide for when the Accessibility
///     toggle won't turn on (Android 13+ "Restricted settings" on sideloaded
///     installs) or won't STAY on (aggressive OEM battery managers, e.g.
///     OnePlus/ColorOS).

/// Returns true only if the user explicitly agreed. Callers must skip the
/// system permission request entirely when this returns false.
Future<bool> showBackgroundLocationDisclosure(BuildContext context) async {
  final ok = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => AlertDialog(
      title: const Row(children: [
        Icon(Icons.location_on, color: Colors.blueAccent),
        SizedBox(width: 10),
        Expanded(child: Text("Background location")),
      ]),
      content: const Text(
        "Env Guardian collects location data in the background — even when the "
        "app is closed or not in use — to detect when this device enters or "
        "leaves your organisation's restricted zone and to enforce workplace "
        "policy while inside it.\n\n"
        "Your location status (inside/outside the zone) is shared with your "
        "organisation's dashboard. Location is not collected for any other "
        "purpose.",
        style: TextStyle(fontSize: 13.5, height: 1.4),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text("No thanks")),
        ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text("I agree")),
      ],
    ),
  );
  return ok == true;
}

/// Step-by-step help when the Accessibility toggle is blocked or keeps
/// reverting. Offers direct deep-links to the two screens involved. Callers
/// should arm the enforcement grace window first (as they already do for
/// other settings jumps).
Future<void> showAccessibilityHelp(BuildContext context) async {
  await showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Row(children: [
        Icon(Icons.accessibility_new, color: Colors.orangeAccent),
        SizedBox(width: 10),
        Expanded(child: Text("Toggle won't turn on?")),
      ]),
      content: const SingleChildScrollView(
        child: Text(
          "If the Env Guardian switch is blocked or keeps turning itself "
          "off, your phone is restricting the app. Fix it in two parts:\n\n"
          "1. Allow restricted settings (installs outside the Play Store)\n"
          "   • Open App info below\n"
          "   • Tap the ⋮ menu (top-right)\n"
          "   • Tap \"Allow restricted settings\" and confirm your PIN\n\n"
          "2. Stop the phone from killing the service\n"
          "   • App info → Battery → allow background activity / don't restrict\n"
          "   • Enable Auto-launch for Env Guardian\n"
          "   • In Recents, long-press the Env Guardian card and Lock it\n\n"
          "Then return to Accessibility settings and turn Env Guardian on.",
          style: TextStyle(fontSize: 13.5, height: 1.4),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () async {
            try { await platformBlocker.invokeMethod('openAppInfoSettings'); } catch (_) {}
          },
          child: const Text("Open App info"),
        ),
        ElevatedButton(
          onPressed: () async {
            Navigator.pop(ctx);
            try { await platformBlocker.invokeMethod('openAccessibilitySettings'); } catch (_) {}
          },
          child: const Text("Accessibility settings"),
        ),
      ],
    ),
  );
}
