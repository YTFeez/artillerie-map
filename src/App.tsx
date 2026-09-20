import { useCallback, useMemo, useState } from 'react'
import { FireHud } from './components/FireHud'
import { FirePanel } from './components/FirePanel'
import { MapView } from './components/MapView'
import {
  computeFireMission,
  DEFAULT_AIR_CANNON,
  DEFAULT_WIND,
  FIRE_MODE_META,
  MAX_WORKING_PRESSURE_BAR,
  type AirCannonConfig,
  type FireMode,
  type WindConfig,
} from './lib/ballistics'
import type { MissionPayload } from './lib/saves'
import { haversineDistance, initialBearing, type LatLng } from './lib/geo'
import {
  createMarker,
  ROLE_META,
  type MapLayerId,
  type MapMarker,
  type MarkerRole,
  type PlaceMode,
} from './types'
import './App.css'

const LAYERS: { id: MapLayerId; label: string }[] = [
  { id: 'hybrid', label: 'Satellite + labels' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'topo', label: 'Topographique' },
  { id: 'streets', label: 'Routes' },
]

export default function App() {
  const [markers, setMarkers] = useState<MapMarker[]>([])
  const [placeMode, setPlaceMode] = useState<PlaceMode>('gun')
  const [layer, setLayer] = useState<MapLayerId>('hybrid')
  const [gunId, setGunId] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [observerId, setObserverId] = useState<string | null>(null)
  const [cannon, setCannon] = useState<AirCannonConfig>(DEFAULT_AIR_CANNON)
  const [wind, setWind] = useState<WindConfig>(DEFAULT_WIND)
  const [fireMode, setFireMode] = useState<FireMode>('direct')
  const [pitch3d, setPitch3d] = useState(true)

  const counts = useMemo(() => {
    const c = { gun: 0, target: 0, observer: 0, custom: 0 }
    for (const m of markers) c[m.role]++
    return c
  }, [markers])

  const gun = markers.find((m) => m.id === gunId) ?? null
  const target = markers.find((m) => m.id === targetId) ?? null

  const rangeM =
    gun && target ? haversineDistance(gun.position, target.position) : 0
  const azDeg =
    gun && target ? initialBearing(gun.position, target.position) : 0
  const deltaAlt = gun && target ? target.altM - gun.altM : 0

  const mission = useMemo(() => {
    if (!gun || !target || rangeM < 1) return null
    return computeFireMission(
      rangeM,
      deltaAlt,
      cannon,
      wind,
      azDeg,
      fireMode,
      cannon.pressureBar,
    )
  }, [gun, target, rangeM, deltaAlt, cannon, wind, azDeg, fireMode])

  const onPlace = useCallback(
    (pos: LatLng) => {
      if (!placeMode) return
      const next = createMarker(placeMode, pos, counts[placeMode] + 1)
      setMarkers((prev) => [...prev, next])
      if (placeMode === 'gun' && !gunId) setGunId(next.id)
      if (placeMode === 'target' && !targetId) setTargetId(next.id)
      if (placeMode === 'observer' && !observerId) setObserverId(next.id)
    },
    [placeMode, counts, gunId, targetId, observerId],
  )

  const onMoveMarker = useCallback((id: string, pos: LatLng) => {
    setMarkers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, position: pos } : m)),
    )
  }, [])

  const onUpdateMarker = useCallback((id: string, patch: Partial<MapMarker>) => {
    setMarkers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    )
  }, [])

  const onDeleteMarker = useCallback(
    (id: string) => {
      setMarkers((prev) => prev.filter((m) => m.id !== id))
      if (gunId === id) setGunId(null)
      if (targetId === id) setTargetId(null)
      if (observerId === id) setObserverId(null)
    },
    [gunId, targetId, observerId],
  )

  const onSelectMarker = useCallback(
    (id: string) => {
      const m = markers.find((x) => x.id === id)
      if (!m) return
      if (m.role === 'gun') setGunId(id)
      if (m.role === 'target') setTargetId(id)
      if (m.role === 'observer') setObserverId(id)
    },
    [markers],
  )

  const onCannon = useCallback((patch: Partial<AirCannonConfig>) => {
    setCannon((prev) => {
      const next = { ...prev, ...patch }
      if (patch.pressureBar != null) {
        next.pressureBar = Math.min(
          MAX_WORKING_PRESSURE_BAR,
          Math.max(0.5, patch.pressureBar),
        )
      }
      return next
    })
  }, [])

  const onWind = useCallback((patch: Partial<WindConfig>) => {
    setWind((prev) => ({ ...prev, ...patch }))
  }, [])

  const onLoadMission = useCallback((payload: MissionPayload) => {
    setCannon(payload.cannon)
    setWind(payload.wind)
    setFireMode(payload.fireMode)
    setMarkers(payload.markers)
    setGunId(payload.gunId)
    setTargetId(payload.targetId)
    setObserverId(payload.observerId)
    setPlaceMode(null)
  }, [])

  const clearAll = () => {
    setMarkers([])
    setGunId(null)
    setTargetId(null)
    setObserverId(null)
  }

  const fireOverlay = useMemo(
    () => ({
      traj: mission?.inRange ? mission.traj : null,
      zone: mission?.inRange ? mission.zone : null,
      azimuthDeg: azDeg,
      mission,
      wind,
    }),
    [mission, azDeg, wind],
  )

  return (
    <div className="app">
      <FirePanel
        markers={markers}
        gunId={gunId}
        targetId={targetId}
        observerId={observerId}
        cannon={cannon}
        wind={wind}
        fireMode={fireMode}
        mission={mission}
        rangeM={rangeM}
        azDeg={azDeg}
        deltaAlt={deltaAlt}
        onCannon={onCannon}
        onWind={onWind}
        onFireMode={setFireMode}
        onGunId={setGunId}
        onTargetId={setTargetId}
        onObserverId={setObserverId}
        onUpdateMarker={onUpdateMarker}
        onDeleteMarker={onDeleteMarker}
        onLoadMission={onLoadMission}
      />

      <main className="map-shell">
        <div className="toolbar">
          <div className="tool-group" role="group" aria-label="Placement">
            {(Object.keys(ROLE_META) as MarkerRole[]).map((role) => {
              const meta = ROLE_META[role]
              return (
                <button
                  key={role}
                  type="button"
                  className={`tool${placeMode === role ? ' is-active' : ''}`}
                  style={{ ['--accent' as string]: meta.color }}
                  onClick={() =>
                    setPlaceMode((m) => (m === role ? null : role))
                  }
                >
                  <i style={{ background: meta.color }} />
                  {meta.label}
                </button>
              )
            })}
            <button
              type="button"
              className={`tool${placeMode === null ? ' is-active' : ''}`}
              onClick={() => setPlaceMode(null)}
            >
              Naviguer
            </button>
          </div>

          <div className="tool-group layers">
            {LAYERS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`tool${layer === l.id ? ' is-active' : ''}`}
                onClick={() => setLayer(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>

          <button type="button" className="tool danger" onClick={clearAll}>
            Tout effacer
          </button>
        </div>

        <div className="map-stage">
          <MapView
            layer={layer}
            markers={markers}
            placeMode={placeMode}
            gunId={gunId}
            targetId={targetId}
            fireOverlay={fireOverlay}
            pitch3d={pitch3d}
            onPlace={onPlace}
            onSelectMarker={onSelectMarker}
            onMoveMarker={onMoveMarker}
          />
          <FireHud
            mission={mission}
            fireMode={fireMode}
            wind={wind}
            rangeM={rangeM}
            pitch3d={pitch3d}
            onTogglePitch={() => setPitch3d((v) => !v)}
            onFireMode={setFireMode}
          />
        </div>

        <p className="hint">
          {placeMode
            ? `Placement : ${ROLE_META[placeMode].label} — cliquez la carte.`
            : `Plan unique · ${FIRE_MODE_META[fireMode].label} · trajectoire 3D + zones + ordres sur la carte.`}
        </p>
      </main>
    </div>
  )
}
