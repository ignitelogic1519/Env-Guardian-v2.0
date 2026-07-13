// Smoke test: the app boots into the right first screen for its seal state.
//
// (Replaces the default Flutter "counter" scaffold test, which referenced a
// MyApp class this project never had.)

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:env_guardian/app.dart';
import 'package:env_guardian/features/command_center/command_center_screen.dart';
import 'package:env_guardian/features/onboarding/admin_setup_screen.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('unsealed device boots into the setup flow', (tester) async {
    await tester.pumpWidget(const EnvGuardianApp(isSealed: false));
    expect(find.byType(AdminSetupScreen), findsOneWidget);
    expect(find.byType(CommandCenterScreen), findsNothing);
  });

  // The sealed path (CommandCenterScreen) is not pumped here: its initState
  // immediately starts cloud-sync loops whose network/platform-channel
  // timeouts leave timers pending past teardown, which the test binding
  // rejects. Covering it needs those services injected — see TEST_CASES.md
  // for the manual on-device checks that exercise the sealed flow.
}
