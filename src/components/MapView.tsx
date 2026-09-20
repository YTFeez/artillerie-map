import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import * as THREE from 'three'
import 'maplibre-gl/dist/maplibre-gl.css'
import type {
  FireMission,
  ImpactZone,
  TrajectoryResult,
  WindConfig,
} from '../lib/ballistics'
import { windInGunFrame } from '../lib/ballistics'
import type { LatLng } from '../lib/geo'
import {
  ellipseRing,
  gunFrameToLatLng,
  lineCoordinates,
  offsetMeters,
} from '../lib/geo'
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

export type FireOverlay = {
  traj: TrajectoryResult | null
  zone: ImpactZone | null
  azimuthDeg: number
  mission: FireMission | null
  wind: WindConfig
}

type Props = {
  layer: MapLayerId
  markers: MapMarker[]
  placeMode: PlaceMode
  gunId: string | null
  targetId: string | null
  fireOverlay: FireOverlay
  pitch3d: boolean
  onPlace: (pos: LatLng) => void
  onSelectMarker: (id: string) => void
  onMoveMarker: (id: string, pos: LatLng) => void
}

type TrajApi = {
  scene: THREE.Scene
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer | null
  root: THREE.Group
}

function makeEl(marker: MapMarker, selected: boolean): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `map-marker${selected ? ' is-selected' : ''}`
  el.style.setProperty('--mk', marker.color)
  el.innerHTML = `<span>${ROLE_META[marker.role].short}</span>`
  el.title = marker.name
  return el
}

function clearGroup(root: THREE.Group) {
  while (root.children.length) {
    const obj = root.children[0]!
    root.remove(obj)
    obj.traverse((c) => {
      if (c instanceof THREE.Mesh || c instanceof THREE.Line || c instanceof THREE.LineLoop) {
        c.geometry?.dispose()
        const mat = c.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose?.()
      }
    })
  }
}

function rebuildTraj3d(
  root: THREE.Group,
  gun: MapMarker,
  overlay: FireOverlay,
) {
  clearGroup(root)
  const traj = overlay.traj
  if (!traj?.points.length) return

  const az = overlay.azimuthDeg
  const gunAlt = gun.altM
  const v0 = Math.max(overlay.mission?.muzzleVelocity ?? 1, 1)
  const meter = maplibregl.MercatorCoordinate.fromLngLat(
    { lng: gun.position.lng, lat: gun.position.lat },
    gunAlt,
  ).meterInMercatorCoordinateUnits()

  const toMerc = (x: number, y: number, z: number) => {
    const ll = gunFrameToLatLng(gun.position, az, x, z)
    const mc = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: ll.lng, lat: ll.lat },
      gunAlt + y,
    )
    return new THREE.Vector3(mc.x, mc.y, mc.z)
  }

  // Rideau trajectoire
  {
    const positions: number[] = []
    const colors: number[] = []
    for (let i = 0; i < traj.points.length - 1; i++) {
      const a = traj.points[i]!
      const b = traj.points[i + 1]!
      const a0 = toMerc(a.x, 0, a.z)
      const a1 = toMerc(a.x, a.y, a.z)
      const b0 = toMerc(b.x, 0, b.z)
      const b1 = toMerc(b.x, b.y, b.z)
      const push = (v: THREE.Vector3, speed: number) => {
        positions.push(v.x, v.y, v.z)
        const t = Math.min(1, speed / v0)
        colors.push(0.25 + t * 0.7, 0.8 - t * 0.35, 0.12)
      }
      push(a0, a.speed)
      push(a1, a.speed)
      push(b1, b.speed)
      push(a0, a.speed)
      push(b1, b.speed)
      push(b0, b.speed)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    root.add(
      new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    )
  }

  // Tube + ligne
  {
    const pts = traj.points.map((p) => toMerc(p.x, p.y, p.z))
    root.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xb7a15a }),
      ),
    )
    if (pts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(pts)
      root.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(
            curve,
            Math.min(160, pts.length * 2),
            meter * 1.6,
            5,
            false,
          ),
          new THREE.MeshBasicMaterial({
            color: 0xb7a15a,
            transparent: true,
            opacity: 0.88,
          }),
        ),
      )
    }
  }

  // Trace sol
  {
    const pts = traj.points.map((p) => toMerc(p.x, 0.4, p.z))
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({
        color: 0x6d8a9a,
        dashSize: meter * 5,
        gapSize: meter * 3,
      }),
    )
    line.computeLineDistances()
    root.add(line)
  }

  if (traj.apex) {
    const a = toMerc(traj.apex.x, traj.apex.y, traj.apex.z)
    const g = toMerc(traj.apex.x, 0, traj.apex.z)
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(meter * 3, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x6d8a9a }),
    )
    s.position.copy(a)
    root.add(s)
    root.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, g]),
        new THREE.LineBasicMaterial({ color: 0x6d8a9a }),
      ),
    )
  }

  if (traj.impact) {
    const i = toMerc(traj.impact.x, Math.max(1, traj.impact.y), traj.impact.z)
    const c = new THREE.Mesh(
      new THREE.ConeGeometry(meter * 3.5, meter * 7, 8),
      new THREE.MeshBasicMaterial({ color: 0x9e4a3f }),
    )
    c.position.copy(i)
    c.rotation.x = Math.PI
    root.add(c)
  }

  const { wx, wz } = windInGunFrame(overlay.wind, az)
  if (Math.hypot(wx, wz) > 0.2) {
    const from = toMerc(12, 6, 12)
    const to = toMerc(12 + wx * 4, 6, 12 + wz * 4)
    root.add(
      new THREE.ArrowHelper(
        to.clone().sub(from).normalize(),
        from,
        meter * (14 + Math.hypot(wx, wz)),
        0x5eb0e0,
        meter * 4,
        meter * 2.5,
      ),
    )
  }
}

function ensureGeoSources(map: MapInstance) {
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
        'line-color': '#b7a15a',
        'line-width': 6,
        'line-opacity': 0.28,
      },
    })
    map.addLayer({
      id: 'fire-line',
      type: 'line',
      source: 'fire-line',
      paint: {
        'line-color': '#c4b06a',
        'line-width': 1.8,
        'line-dasharray': [2, 1.4],
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
        'line-color': '#6d8a9a',
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
      paint: { 'fill-color': '#9e4a3f', 'fill-opacity': 0.18 },
    })
    map.addLayer({
      id: 'impact-zone-50',
      type: 'fill',
      source: 'impact-zones',
      filter: ['==', ['get', 'level'], '50'],
      paint: { 'fill-color': '#b7a15a', 'fill-opacity': 0.26 },
    })
    map.addLayer({
      id: 'impact-zone-outline',
      type: 'line',
      source: 'impact-zones',
      paint: { 'line-color': '#b7a15a', 'line-width': 1.1 },
    })
  }

  if (!map.getSource('traj-labels')) {
    map.addSource('traj-labels', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addLayer({
      id: 'traj-labels',
      type: 'symbol',
      source: 'traj-labels',
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-offset': [0, 1.15],
        'text-anchor': 'top',
      },
      paint: {
        'text-color': '#d7dbd2',
        'text-halo-color': '#0a0c0a',
        'text-halo-width': 1.4,
      },
    })
  }
}

function setOverlayData(
  map: MapInstance,
  markers: MapMarker[],
  gunId: string | null,
  targetId: string | null,
  overlay: FireOverlay,
  trajApi: TrajApi | null,
) {
  ensureGeoSources(map)
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
  const labelSrc = map.getSource('traj-labels') as maplibregl.GeoJSONSource

  if (!gun || !overlay.traj?.points.length) {
    trajSrc.setData({ type: 'FeatureCollection', features: [] })
    zoneSrc.setData({ type: 'FeatureCollection', features: [] })
    labelSrc.setData({ type: 'FeatureCollection', features: [] })
    if (trajApi) clearGroup(trajApi.root)
    map.triggerRepaint()
    return
  }

  const az = overlay.azimuthDeg
  trajSrc.setData({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: overlay.traj.points.map((p) => {
        const ll = gunFrameToLatLng(gun.position, az, p.x, p.z)
        return [ll.lng, ll.lat]
      }),
    },
  })

  if (overlay.zone) {
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
  } else {
    zoneSrc.setData({ type: 'FeatureCollection', features: [] })
  }

  const labels: {
    type: 'Feature'
    properties: { label: string }
    geometry: { type: 'Point'; coordinates: [number, number] }
  }[] = []
  if (overlay.traj.apex) {
    const ll = gunFrameToLatLng(
      gun.position,
      az,
      overlay.traj.apex.x,
      overlay.traj.apex.z,
    )
    labels.push({
      type: 'Feature',
      properties: { label: `Sommet ${overlay.traj.apex.y.toFixed(0)} m` },
      geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
    })
  }
  if (overlay.traj.impact) {
    const ll = gunFrameToLatLng(
      gun.position,
      az,
      overlay.traj.impact.x,
      overlay.traj.impact.z,
    )
    labels.push({
      type: 'Feature',
      properties: {
        label: `Impact ${overlay.traj.impact.speed.toFixed(0)} m/s`,
      },
      geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
    })
  }
  const tip = offsetMeters(
    gun.position,
    Math.sin((az * Math.PI) / 180) * 35,
    Math.cos((az * Math.PI) / 180) * 35,
  )
  labels.push({
    type: 'Feature',
    properties: {
      label: overlay.mission
        ? `P ${overlay.mission.pressureBar.toFixed(1)} bar · Élev ${overlay.mission.elevationDeg.toFixed(1)}°`
        : `AZ ${az.toFixed(1)}°`,
    },
    geometry: { type: 'Point', coordinates: [tip.lng, tip.lat] },
  })
  labelSrc.setData({ type: 'FeatureCollection', features: labels })

  if (trajApi) rebuildTraj3d(trajApi.root, gun, overlay)
  map.triggerRepaint()
}

export function MapView({
  layer,
  markers,
  placeMode,
  gunId,
  targetId,
  fireOverlay,
  pitch3d,
  onPlace,
  onSelectMarker,
  onMoveMarker,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const markersRef = useRef<globalThis.Map<string, GlMarker>>(
    new globalThis.Map(),
  )
  const trajApiRef = useRef<TrajApi | null>(null)
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
      zoom: 12,
      pitch: 55,
      bearing: -18,
      maxPitch: 80,
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

    const scene = new THREE.Scene()
    const camera = new THREE.Camera()
    const root = new THREE.Group()
    scene.add(root)
    trajApiRef.current = { scene, camera, renderer: null, root }

    const addCustom = () => {
      if (map.getLayer('traj-3d-layer')) return
      map.addLayer({
        id: 'traj-3d-layer',
        type: 'custom',
        renderingMode: '3d',
        onAdd(_m, gl) {
          const api = trajApiRef.current
          if (!api) return
          api.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl as WebGLRenderingContext,
            antialias: true,
          })
          api.renderer.autoClear = false
        },
        render(_gl, options) {
          const api = trajApiRef.current
          if (!api?.renderer) return
          api.camera.projectionMatrix = new THREE.Matrix4().fromArray(
            options.defaultProjectionData.mainMatrix,
          )
          api.renderer.resetState()
          api.renderer.render(api.scene, api.camera)
          map.triggerRepaint()
        },
      } as maplibregl.CustomLayerInterface)
    }

    map.on('style.load', () => {
      addCustom()
      const f = fireRef.current
      setOverlayData(
        map,
        f.markers,
        f.gunId,
        f.targetId,
        f.fireOverlay,
        trajApiRef.current,
      )
    })

    mapRef.current = map
    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current.clear()
      trajApiRef.current?.renderer?.dispose()
      trajApiRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ pitch: pitch3d ? 58 : 0, duration: 550 })
  }, [pitch3d])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setStyle(LAYER_STYLES[layer])
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
    setOverlayData(
      map,
      markers,
      gunId,
      targetId,
      fireOverlay,
      trajApiRef.current,
    )

    const gun = markers.find((m) => m.id === gunId)
    const target = markers.find((m) => m.id === targetId)
    if (!gun || !target) return

    const bounds = new maplibregl.LngLatBounds(
      [gun.position.lng, gun.position.lat],
      [target.position.lng, target.position.lat],
    )
    if (fireOverlay.traj?.points.length) {
      for (const p of fireOverlay.traj.points) {
        const ll = gunFrameToLatLng(
          gun.position,
          fireOverlay.azimuthDeg,
          p.x,
          p.z,
        )
        bounds.extend([ll.lng, ll.lat])
      }
    }
    map.fitBounds(bounds, {
      padding: { top: 70, bottom: 240, left: 36, right: 36 },
      maxZoom: 15,
      duration: 650,
      pitch: pitch3d ? 58 : map.getPitch(),
    })
  }, [markers, gunId, targetId, fireOverlay, pitch3d])

  return <div ref={containerRef} className="map-canvas" />
}
