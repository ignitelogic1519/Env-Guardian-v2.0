import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

/// Map tab — shows the device location and the restricted-zone polygon.
class MapTab extends StatelessWidget {
  final double currentLat, currentLng; final List<Offset> polygonPoints; const MapTab({super.key, required this.currentLat, required this.currentLng, required this.polygonPoints});
  @override Widget build(BuildContext context) { if (currentLat == 0) return const Center(child: CircularProgressIndicator()); return FlutterMap(options: MapOptions(initialCenter: LatLng(currentLat, currentLng), initialZoom: 16), children: [TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'com.sumit.env_guardian'), PolygonLayer(polygons: [Polygon(points: polygonPoints.map((p) => LatLng(p.dx, p.dy)).toList(), color: Colors.red.withOpacity(0.3), borderColor: Colors.red, borderStrokeWidth: 4, isFilled: true)]), MarkerLayer(markers: [Marker(point: LatLng(currentLat, currentLng), child: const Icon(Icons.my_location, color: Colors.blue, size: 30))])]); }
}
