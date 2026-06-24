import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

/// Map tab — shows the restricted-zone polygon (red boundary + red vertex
/// points), the device's current location, and whether the device is currently
/// inside the zone.
///
/// The camera auto-fits to include BOTH the zone and the device, so the zone is
/// always visible and you can always see where you are relative to it. If no
/// zone is configured yet, a clear empty state is shown instead of a spinner.
class MapTab extends StatelessWidget {
  final double currentLat, currentLng;
  final List<Offset> polygonPoints;
  const MapTab({super.key, required this.currentLat, required this.currentLng, required this.polygonPoints});

  // Ray-casting point-in-polygon test (lat = y, lng = x).
  static bool _inside(LatLng pt, List<LatLng> poly) {
    if (poly.length < 3) return false;
    bool inside = false;
    for (int i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      final bool intersect = (poly[i].latitude > pt.latitude) != (poly[j].latitude > pt.latitude) &&
          (pt.longitude < (poly[j].longitude - poly[i].longitude) * (pt.latitude - poly[i].latitude) / (poly[j].latitude - poly[i].latitude) + poly[i].longitude);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  @override
  Widget build(BuildContext context) {
    final List<LatLng> pts = polygonPoints.map((p) => LatLng(p.dx, p.dy)).toList();
    final bool hasZone = pts.length >= 3;
    final bool hasGps = currentLat != 0 || currentLng != 0;
    final LatLng? me = hasGps ? LatLng(currentLat, currentLng) : null;

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

    final bool amInside = (hasZone && me != null) && _inside(me, pts);

    // Frame both the zone and the device so both are always visible.
    final List<LatLng> fitPts = [...pts, if (me != null) me];
    final bool useFit = fitPts.length >= 2;

    return Stack(children: [
      FlutterMap(
        options: MapOptions(
          initialCenter: me ?? pts.first,
          initialZoom: 16,
          initialCameraFit: useFit
              ? CameraFit.bounds(bounds: LatLngBounds.fromPoints(fitPts), padding: const EdgeInsets.all(70))
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
          if (me != null)
            MarkerLayer(markers: [
              Marker(point: me, child: const Icon(Icons.my_location, color: Colors.blue, size: 30)),
            ]),
        ],
      ),
      // Legend.
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
      // Inside / outside status badge.
      if (hasZone && me != null)
        Positioned(
          right: 12,
          top: 12,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(color: (amInside ? Colors.red : Colors.green).withOpacity(0.85), borderRadius: BorderRadius.circular(20)),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(amInside ? Icons.warning_amber_rounded : Icons.check_circle, color: Colors.white, size: 16),
              const SizedBox(width: 6),
              Text(amInside ? "INSIDE ZONE" : "OUTSIDE ZONE", style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
            ]),
          ),
        ),
    ]);
  }
}
