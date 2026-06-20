import { useMemo } from 'react';
import { GeoJSON, MapContainer, Marker, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoJsonObject } from 'geojson';

// Avoid the bundler broken-default-marker issue with a simple div marker.
const pin = L.divIcon({
  className: 'parcel-pin',
  html: '<div class="parcel-pin-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export function ParcelMap({
  lat,
  lng,
  lotGeojson,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  lotGeojson?: string | null;
}) {
  const polygon = useMemo<GeoJsonObject | null>(() => {
    if (!lotGeojson) return null;
    try {
      return JSON.parse(lotGeojson) as GeoJsonObject;
    } catch {
      return null;
    }
  }, [lotGeojson]);

  if (lat == null || lng == null) {
    return <div className="map map-empty">No location for this parcel.</div>;
  }

  return (
    <MapContainer center={[lat, lng]} zoom={16} className="map" scrollWheelZoom={false}>
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[lat, lng]} icon={pin} />
      {polygon && <GeoJSON data={polygon} style={{ color: '#1f6feb', weight: 2, fillOpacity: 0.1 }} />}
    </MapContainer>
  );
}
