import 'dart:ui';
import 'package:flutter/material.dart';

/// Glassmorphism + motion helpers for Env Guardian.
///
/// Pairs with the neumorphic widgets in `neumorphic.dart`:
///   • [AuroraBackground] — a slowly animated dark gradient backdrop.
///   • [GlassCard]        — a frosted-glass panel (blur + translucent fill).
///   • [FadeInUp]         — a small entrance animation for content.

/// Brand accent colours used across the glass UI.
class GlassPalette {
  static const Color bgTop = Color(0xFF0E1230);
  static const Color bgMid = Color(0xFF15224B);
  static const Color bgBottom = Color(0xFF0C2233);
  static const Color accent = Color(0xFF5B8CFF);
  static const Color accent2 = Color(0xFF36D6C3);
}

/// A gently animated gradient background. Make Scaffolds transparent so this
/// shows through (the app theme already does this).
class AuroraBackground extends StatefulWidget {
  final Widget child;
  const AuroraBackground({super.key, required this.child});
  @override
  State<AuroraBackground> createState() => _AuroraBackgroundState();
}

class _AuroraBackgroundState extends State<AuroraBackground> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(seconds: 14))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, child) {
        final t = _c.value;
        return Stack(fit: StackFit.expand, children: [
          // Base moving gradient.
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment(-1 + 2 * t, -1),
                end: Alignment(1, 1 - 2 * t),
                colors: const [GlassPalette.bgTop, GlassPalette.bgMid, GlassPalette.bgBottom],
              ),
            ),
            child: const SizedBox.expand(),
          ),
          // Two soft aurora blobs drifting for depth.
          Positioned(
            top: 80 + 40 * t,
            left: -60 + 30 * t,
            child: _blob(GlassPalette.accent.withOpacity(0.30), 240),
          ),
          Positioned(
            bottom: 60 + 50 * (1 - t),
            right: -50 + 30 * t,
            child: _blob(GlassPalette.accent2.withOpacity(0.22), 280),
          ),
          if (child != null) child,
        ]);
      },
      child: widget.child,
    );
  }

  Widget _blob(Color color, double size) => ImageFiltered(
        imageFilter: ImageFilter.blur(sigmaX: 70, sigmaY: 70),
        child: Container(width: size, height: size, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
      );
}

/// A frosted-glass panel: real background blur + translucent fill + hairline border.
class GlassCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final double radius;
  final double blur;
  final double opacity;
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.margin,
    this.radius = 24,
    this.blur = 18,
    this.opacity = 0.12,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: margin ?? EdgeInsets.zero,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(radius),
              border: Border.all(color: Colors.white.withOpacity(0.18), width: 1.2),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Colors.white.withOpacity(opacity), Colors.white.withOpacity(opacity * 0.35)],
              ),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

/// Simple fade + slide-up entrance animation for any widget.
class FadeInUp extends StatelessWidget {
  final Widget child;
  final Duration duration;
  final double offset;
  const FadeInUp({super.key, required this.child, this.duration = const Duration(milliseconds: 450), this.offset = 24});

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: duration,
      curve: Curves.easeOutCubic,
      builder: (context, v, child) => Opacity(
        opacity: v.clamp(0.0, 1.0),
        child: Transform.translate(offset: Offset(0, (1 - v) * offset), child: child),
      ),
      child: child,
    );
  }
}
