import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { ImpactZone, TrajectoryResult } from '../lib/ballistics'
import type { LatLng } from '../lib/geo'
import { ellipseRing, gunFrameToLatLng, lineCoordinates } from '../lib/geo'
import type { MapLayerId, MapMarker, PlaceMode } from '../types'
import { ROLE_META } from '../types'

type MapInstance = maplibregl.Map
type GlMarker = maplibregl.Marker

const LAYER_STYLES: Record<MapLayerId, maplibregl.StyleSpecification> = {
  satellite: {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: 'Tiles © Esri',
        maxzoom: 19,
      },
    },
    layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
  },
  hybrid: {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: 'Tiles © Esri',
        maxzoom: 19,
      },
      labels: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: 'Labels © Esri',
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'esri', type: 'raster', source: 'esri' },
      { id: 'labels', type: 'raster', source: 'labels' },
    ],
  },
  topo: {
    version: 8,
    sources: {
      topo: {
        type: 'raster',
        tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenTopoMap (CC-BY-SA)',
        maxzoom: 17,
      },
    },
    layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
  },
  streets: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap',
        maxzoom: 19,
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  },
}

type FireOverlay = {
  traj: TrajectoryResult | null
  zone: ImpactZone | null
  azimuthDeg: number
}

type Props = {
  layer: MapLayerId
  markers: MapMarker[]
  placeMode: PlaceMode
  gunId: string | null
  targetId: string | null
  fireOverlay: FireOverlay
  onPlace: (pos: LatLng) => void
  onSelectMarker: (id: string) => void
  onMoveMarker: (id: string, pos: LatLng) => void
}

function makeEl(marker: MapMarker, selected: boolean): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `map-marker${selected ? ' is-selected' : ''}`
  el.style.setProperty('--mk', marker.color)
  el.innerHTML = `<span>${ROLE_META[marker.role].short}</span>`
  el.title = marker.name
  return el
}

function ensureSources(map: MapInstance) {
  if (!map.getSource('fire-line')) {
    map.addSource('fire-line', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'fire-line-glow',
      type: 'line',
      source: 'fire-line',
      paint: {
        'line-color': '#e8c547',
        'line-width': 6,
        'line-opacity': 0.25,
      },
    })
    map.addLayer({
      id: 'fire-line',
      type: 'line',
      source: 'fire-line',
      paint: {
        'line-color': '#f0d060',
        'line-width': 2,
        'line-dasharray': [2, 1.5],
      },
    })
  }

  if (!map.getSource('traj-ground')) {
    map.addSource('traj-ground', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'traj-ground',
      type: 'line',
      source: 'traj-ground',
      paint: {
        'line-color': '#5eb0e0',
        'line-width': 2.5,
        'line-opacity': 0.9,
      },
    })
  }

  if (!map.getSource('impact-zones')) {
    map.addSource('impact-zones', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'impact-zone-90',
      type: 'fill',
      source: 'impact-zones',
      filter: ['==', ['get', 'level'], '90'],
      paint: {
        'fill-color': '#c44b3c',
        'fill-opacity': 0.18,
      },
    })
    map.addLayer({
      id: 'impact-zone-50',
      type: 'fill',
      source: 'impact-zones',
      filter: ['==', ['get', 'level'], '50'],
      paint: {
        'fill-color': '#e8c547',
        'fill-opacity': 0.28,
      },
    })
    map.addLayer({
      id: 'impact-zone-outline',
      type: 'line',
      source: 'impact-zones',
      paint: {
        'line-color': '#f0d060',
        'line-width': 1.2,
        'line-opacity': 0.8,
      },
    })
  }
}

function setFireOverlayData(
  map: MapInstance,
  markers: MapMarker[],
  gunId: string | null,
  targetId: string | null,
  overlay: FireOverlay,
) {
  ensureSources(map)

  const gun = markers.find((m) => m.id === gunId)
  const target = markers.find((m) => m.id === targetId)

  const fireSrc = map.getSource('fire-line') as maplibregl.GeoJSONSource
  if (!gun || !target) {
    fireSrc.setData({ type: 'FeatureCollection', features: [] })
  } else {
    fireSrc.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: lineCoordinates(gun.position, target.position),
      },
    })
  }

  const trajSrc = map.getSource('traj-ground') as maplibregl.GeoJSONSource
  const zoneSrc = map.getSource('impact-zones') as maplibregl.GeoJSONSource

  if (!gun || !overlay.traj?.points.length) {
    trajSrc.setData({ type: 'FeatureCollection', features: [] })
    zoneSrc.setData({ type: 'FeatureCollection', features: [] })
    return
  }

  const az = overlay.azimuthDeg
  const groundCoords = overlay.traj.points.map((p) => {
    const ll = gunFrameToLatLng(gun.position, az, p.x, p.z)
    return [ll.lng, ll.lat] as [number, number]
  })

  trajSrc.setData({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: groundCoords },
  })

  if (!overlay.zone) {
    zoneSrc.setData({ type: 'FeatureCollection', features: [] })
    return
  }

  const z = overlay.zone
  zoneSrc.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { level: '90' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            ellipseRing(
              gun.position,
              az,
              z.centerX,
              z.centerZ,
              z.semiRange90M,
              z.semiDefl90M,
            ),
          ],
        },
      },
      {
        type: 'Feature',
        properties: { level: '50' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            ellipseRing(
              gun.position,
              az,
              z.centerX,
              z.centerZ,
              z.semiRange50M,
              z.semiDefl50M,
            ),
          ],
        },
      },
    ],
  })
}

export function MapView({
  layer,
  markers,
  placeMode,
  gunId,
  targetId,
  fireOverlay,
  onPlace,
  onSelectMarker,
  onMoveMarker,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const markersRef = useRef<globalThis.Map<string, GlMarker>>(
    new globalThis.Map(),
  )
  const fireRef = useRef({ markers, gunId, targetId, fireOverlay })
  fireRef.current = { markers, gunId, targetId, fireOverlay }
  const callbacks = useRef({ onPlace, onSelectMarker, onMoveMarker })
  callbacks.current = { onPlace, onSelectMarker, onMoveMarker }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: LAYER_STYLES.hybrid,
      center: [2.35, 48.85],
      zoom: 11,
      pitch: 0,
      attributionControl: { compact: true },
    })

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'top-right',
    )
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 160, unit: 'metric' }),
      'bottom-left',
    )

    map.on('click', (e) => {
      callbacks.current.onPlace({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    map.on('load', () => {
      const f = fireRef.current
      setFireOverlayData(map, f.markers, f.gunId, f.targetId, f.fireOverlay)
    })

    mapRef.current = map
    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current.clear()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onStyle = () => {
      const f = fireRef.current
      setFireOverlayData(map, f.markers, f.gunId, f.targetId, f.fireOverlay)
    }

    map.setStyle(LAYER_STYLES[layer])
    map.once('styledata', onStyle)
  }, [layer])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = placeMode ? 'crosshair' : ''
  }, [placeMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const existing = markersRef.current
    const ids = new Set(markers.map((m) => m.id))

    existing.forEach((mk, id) => {
      if (!ids.has(id)) {
        mk.remove()
        existing.delete(id)
      }
    })

    for (const marker of markers) {
      const selected = marker.id === gunId || marker.id === targetId
      let gl = existing.get(marker.id)
      if (!gl) {
        const el = makeEl(marker, selected)
        gl = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([marker.position.lng, marker.position.lat])
          .addTo(map)
        gl.on('dragend', () => {
          const ll = gl!.getLngLat()
          callbacks.current.onMoveMarker(marker.id, {
            lat: ll.lat,
            lng: ll.lng,
          })
        })
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          callbacks.current.onSelectMarker(marker.id)
        })
        existing.set(marker.id, gl)
      } else {
        gl.setLngLat([marker.position.lng, marker.position.lat])
        const el = gl.getElement()
        el.className = `map-marker${selected ? ' is-selected' : ''}`
        el.style.setProperty('--mk', marker.color)
        el.innerHTML = `<span>${ROLE_META[marker.role].short}</span>`
        el.title = marker.name
      }
    }
  }, [markers, gunId, targetId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    setFireOverlayData(map, markers, gunId, targetId, fireOverlay)
  }, [markers, gunId, targetId, fireOverlay])

  return <div ref={containerRef} className="map-canvas" />
}
