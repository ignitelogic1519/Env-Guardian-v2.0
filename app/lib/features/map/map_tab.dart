import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

/// Map tab — shows the restricted-zone polygon (red boundary + red vertex
/// points) and the device's current location.
///
/// The map auto-fits to the configured zone so it is always visible, even when
/// the device is far away from it. If no zone is configured yet, a clear empty
/// state is shown instead of an endless spinner.
class MapTab extends StatelessWidget {
  final double currentLat, currentLng;
  final List<Offset> polygonPoints;
  const MapTab({super.key, required this.currentLat, required this.currentLng, required this.polygonPoints});

  @override
  Widget build(BuildContext context) {
    final List<LatLng> pts = polygonPoints.map((p) => LatLng(p.dx, p.dy)).toList();
    final bool hasZone = pts.length >= 3;
    final bool hasGps = currentLat != 0 || currentLng != 0;

    // Nothing to show yet: no GPS fix AND no zone configured.
    if (!hasZone && !hasGps) {
      return const Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.location_off, size: 64, color: Colors.white30),
          SizedBox(height: 16),
          Text("No restricted zone configured", style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold)),
          SizedBox(height: 6),
          Text("Waiting for location / zone data…", style: TextStyle(color: Colors.white38)),
        ]),
      );
    }

    final LatLng fallbackCenter = hasGps ? LatLng(currentLat, currentLng) : pts.first;

    return Stack(children: [
      FlutterMap(
        options: MapOptions(
          initialCenter: fallbackCenter,
          initialZoom: 16,
          // When a zone exists, frame the whole polygon so it is always visible.
          initialCameraFit: hasZone
              ? CameraFit.bounds(bounds: LatLngBounds.fromPoints(pts), padding: const EdgeInsets.all(60))
              : null,
        ),
        children: [
          TileLayer(
            urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            userAgentPackageName: 'com.sumit.env_guardian',
          ),
          if (hasZone)
            PolygonLayer(polygons: [
              Polygon(
                points: pts,
                color: Colors.red.withOpacity(0.25),
                borderColor: Colors.red,
                borderStrokeWidth: 4,
                isFilled: true,
              ),
            ]),
          // Red points at each corner of the restricted boundary.
          if (hasZone)
            CircleLayer(circles: [
              for (final p in pts)
                CircleMarker(point: p, radius: 7, color: Colors.red, borderColor: Colors.white, borderStrokeWidth: 2),
            ]),
          if (hasGps)
            MarkerLayer(markers: [
              Marker(point: LatLng(currentLat, currentLng), child: const Icon(Icons.my_location, color: Colors.blue, size: 30)),
            ]),
        ],
      ),
      // Small legend so it's obvious what the red area means.
      Positioned(
        left: 12,
        top: 12,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(color: Colors.black.withOpacity(0.6), borderRadius: BorderRadius.circular(10)),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Container(width: 12, height: 12, decoration: BoxDecoration(color: Colors.red.withOpacity(0.4), border: Border.all(color: Colors.red, width: 2))),
            const SizedBox(width: 8),
            Text(hasZone ? "Restricted Zone" : "No zone set", style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
          ]),
        ),
      ),
    ]);
  }
}
