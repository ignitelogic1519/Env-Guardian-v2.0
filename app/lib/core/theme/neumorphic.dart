import 'package:flutter/material.dart';

/// Neumorphic ("soft UI") design tokens and reusable widgets for Env Guardian.
///
/// Neumorphism relies on a mid-tone background with two opposing shadows —
/// a light one (top-left) and a dark one (bottom-right) — to make surfaces
/// look softly extruded from, or pressed into, the background.
class NeuColors {
  static const Color base = Color(0xFF2B2F36); // page background
  static const Color surface = Color(0xFF2F343C); // raised surfaces
  static const Color accent = Color(0xFF4F8CFF);
  static const Color textPrimary = Color(0xFFE6E9EF);
  static const Color textMuted = Color(0xFF8A92A6);

  static const Color _shadowDark = Color(0xFF1E2127);
  static const Color _shadowLight = Color(0xFF3A4049);

  /// Shadows for a raised (extruded) surface.
  static List<BoxShadow> raised([double d = 6]) => [
        BoxShadow(color: _shadowDark, offset: Offset(d, d), blurRadius: d * 2),
        BoxShadow(color: _shadowLight, offset: Offset(-d, -d), blurRadius: d * 2),
      ];

  /// Shadows for a pressed (inset-looking) surface — softer, reversed.
  static List<BoxShadow> pressed([double d = 4]) => [
        BoxShadow(color: _shadowDark, offset: Offset(-d, -d), blurRadius: d * 2),
        BoxShadow(color: _shadowLight, offset: Offset(d, d), blurRadius: d * 2),
      ];
}

/// A soft, raised neumorphic card/panel.
class NeuCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final double radius;
  final double depth;
  final Color? color;
  const NeuCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.margin,
    this.radius = 20,
    this.depth = 6,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      margin: margin,
      decoration: BoxDecoration(
        color: color ?? NeuColors.surface,
        borderRadius: BorderRadius.circular(radius),
        boxShadow: NeuColors.raised(depth),
      ),
      child: child,
    );
  }
}

/// A tappable neumorphic button that visually depresses while pressed.
class NeuButton extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final double radius;
  final Color? color;
  const NeuButton({
    super.key,
    required this.child,
    required this.onTap,
    this.padding = const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
    this.radius = 16,
    this.color,
  });

  @override
  State<NeuButton> createState() => _NeuButtonState();
}

class _NeuButtonState extends State<NeuButton> {
  bool _down = false;
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _down = true),
      onTapUp: (_) => setState(() => _down = false),
      onTapCancel: () => setState(() => _down = false),
      onTap: widget.onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        padding: widget.padding,
        decoration: BoxDecoration(
          color: widget.color ?? NeuColors.surface,
          borderRadius: BorderRadius.circular(widget.radius),
          boxShadow: _down ? NeuColors.pressed(3) : NeuColors.raised(5),
        ),
        child: Center(widthFactor: 1, child: widget.child),
      ),
    );
  }
}

/// The shared dark-neumorphic theme.
ThemeData buildNeuTheme() {
  return ThemeData.dark().copyWith(
    scaffoldBackgroundColor: NeuColors.base,
    primaryColor: NeuColors.accent,
    colorScheme: const ColorScheme.dark(
      primary: NeuColors.accent,
      surface: NeuColors.surface,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: NeuColors.base,
      elevation: 0,
      centerTitle: true,
    ),
    textTheme: ThemeData.dark().textTheme.apply(
          bodyColor: NeuColors.textPrimary,
          displayColor: NeuColors.textPrimary,
        ),
  );
}
