import { SavesPanel } from './SavesPanel'
import {
  FIRE_MODE_META,
  MAX_WORKING_PRESSURE_BAR,
  type AirCannonConfig,
  type FireMission,
  type FireMode,
  type WindConfig,
} from '../lib/ballistics'
import type { MissionPayload } from '../lib/saves'
import {
  angleOfSiteMils,
  backAzimuth,
  degreesToMils,
  formatCoord,
  formatDistance,
  haversineDistance,
  initialBearing,
} from '../lib/geo'
import type { MapMarker } from '../types'
import { ROLE_META } from '../types'

type Props = {
  markers: MapMarker[]
  gunId: string | null
  targetId: string | null
  observerId: string | null
  cannon: AirCannonConfig
  wind: WindConfig
  fireMode: FireMode
  mission: FireMission | null
  rangeM: number
  azDeg: number
  deltaAlt: number
  onCannon: (patch: Partial<AirCannonConfig>) => void
  onWind: (patch: Partial<WindConfig>) => void
  onFireMode: (mode: FireMode) => void
  onGunId: (id: string | null) => void
  onTargetId: (id: string | null) => void
  onObserverId: (id: string | null) => void
  onUpdateMarker: (id: string, patch: Partial<MapMarker>) => void
  onDeleteMarker: (id: string) => void
  onLoadMission: (payload: MissionPayload) => void
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="data-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function NumField({
  label,
  value,
  step,
  min,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  step: number
  min: number
  max: number
  unit: string
  onChange: (n: number) => void
}) {
  return (
    <label className="field">
      <span>
        {label} <em className="unit">({unit})</em>
      </span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

const WIND_PRESETS: { label: string; fromDeg: number }[] = [
  { label: 'N', fromDeg: 0 },
  { label: 'NE', fromDeg: 45 },
  { label: 'E', fromDeg: 90 },
  { label: 'SE', fromDeg: 135 },
  { label: 'S', fromDeg: 180 },
  { label: 'SO', fromDeg: 225 },
  { label: 'O', fromDeg: 270 },
  { label: 'NO', fromDeg: 315 },
]

export function FirePanel({
  markers,
  gunId,
  targetId,
  observerId,
  cannon,
  wind,
  fireMode,
  mission,
  rangeM,
  azDeg,
  deltaAlt,
  onCannon,
  onWind,
  onFireMode,
  onGunId,
  onTargetId,
  onObserverId,
  onUpdateMarker,
  onDeleteMarker,
  onLoadMission,
}: Props) {
  const gun = markers.find((m) => m.id === gunId) ?? null
  const target = markers.find((m) => m.id === targetId) ?? null
  const observer = markers.find((m) => m.id === observerId) ?? null

  const guns = markers.filter((m) => m.role === 'gun')
  const targets = markers.filter((m) => m.role === 'target')
  const observers = markers.filter((m) => m.role === 'observer')

  const siteMils = gun && target ? angleOfSiteMils(rangeM, deltaAlt) : 0

  let foRange = 0
  let foAz = 0
  if (observer && target) {
    foRange = haversineDistance(observer.position, target.position)
    foAz = initialBearing(observer.position, target.position)
  }

  return (
    <aside className="panel">
      <header className="panel-head">
        <p className="brand">FIRE GRID · FDC</p>
        <h1>Poste de tir</h1>
        <p className="lede">
          Mode, pression, hausse, azimut — calculés. Carte et trajectoire sur le
          même plan.
        </p>
      </header>

      <section className="panel-section">
        <h2>Mode de tir</h2>
        <div className="mode-grid">
          {(Object.keys(FIRE_MODE_META) as FireMode[]).map((mode) => {
            const meta = FIRE_MODE_META[mode]
            return (
              <button
                key={mode}
                type="button"
                className={`mode-card${fireMode === mode ? ' is-active' : ''}`}
                onClick={() => onFireMode(mode)}
              >
                <strong>{meta.label}</strong>
                <em>{meta.short}</em>
                <span>{meta.blurb}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel-section">
        <h2>Liaison</h2>
        <label className="field">
          <span>Pièce</span>
          <select
            value={gunId ?? ''}
            onChange={(e) => onGunId(e.target.value || null)}
          >
            <option value="">—</option>
            {guns.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Cible</span>
          <select
            value={targetId ?? ''}
            onChange={(e) => onTargetId(e.target.value || null)}
          >
            <option value="">—</option>
            {targets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Observateur</span>
          <select
            value={observerId ?? ''}
            onChange={(e) => onObserverId(e.target.value || null)}
          >
            <option value="">—</option>
            {observers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {gun && target && (
        <section className="panel-section solution">
          <h2>Géométrie</h2>
          <Row label="Distance" value={formatDistance(rangeM)} />
          <Row
            label="Azimut géométrique"
            value={`${azDeg.toFixed(2)}° · ${degreesToMils(azDeg).toFixed(0)} mil`}
          />
          <Row
            label="Contre-azimut"
            value={`${backAzimuth(azDeg).toFixed(2)}° · ${degreesToMils(backAzimuth(azDeg)).toFixed(0)} mil`}
          />
          <Row
            label="Δ altitude"
            value={`${deltaAlt >= 0 ? '+' : ''}${deltaAlt.toFixed(0)} m`}
          />
          <Row
            label="Angle de site"
            value={`${siteMils >= 0 ? '+' : ''}${siteMils.toFixed(1)} mil`}
          />
          <Row
            label="Coord. pièce"
            value={`${formatCoord(gun.position.lat)}, ${formatCoord(gun.position.lng)}`}
          />
          <Row
            label="Coord. cible"
            value={`${formatCoord(target.position.lat)}, ${formatCoord(target.position.lng)}`}
          />
        </section>
      )}

      {mission && (
        <section className="panel-section mission">
          <h2>Ordre de tir calculé</h2>
          {!mission.inRange ? (
            <div className="charge-card is-out">
              <div className="charge-title">
                <strong>Hors portée</strong>
                <em className="out">impossible</em>
              </div>
              <p className="charge-meta">{mission.reason}</p>
              <div className="charge-data">
                <span>
                  Portée max @ {mission.maxPressureBar} bar ≈{' '}
                  {formatDistance(mission.maxRangeAtPressureM)}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="order-banner">{mission.order}</div>
              <p className="charge-meta">{mission.reason}</p>

              <div className="mission-grid">
                <div className="mission-kpi">
                  <span>Pression à régler</span>
                  <strong>{mission.pressureBar.toFixed(1)} bar</strong>
                </div>
                <div className="mission-kpi">
                  <span>Élévation</span>
                  <strong>
                    {mission.elevationDeg.toFixed(2)}°
                    <small>
                      {' '}
                      · {mission.elevationMils.toFixed(0)} mil
                    </small>
                  </strong>
                </div>
                <div className="mission-kpi">
                  <span>Azimut de pointage</span>
                  <strong>
                    {mission.aimAzimuthDeg.toFixed(2)}°
                    <small>
                      {' '}
                      · {mission.aimAzimuthMils.toFixed(0)} mil
                    </small>
                  </strong>
                </div>
                <div className="mission-kpi">
                  <span>Temps de vol</span>
                  <strong>{mission.tofS.toFixed(2)} s</strong>
                </div>
              </div>

              <div className="charge-card is-best" style={{ marginTop: '0.75rem' }}>
                <div className="charge-title">
                  <strong>Données balistiques</strong>
                </div>
                <div className="charge-data">
                  <span>
                    v₀ {mission.muzzleVelocity.toFixed(1)} m/s → impact{' '}
                    {mission.impactSpeed.toFixed(1)} m/s
                  </span>
                  <span>
                    Énergie {mission.muzzleEnergyJ.toFixed(0)} J · Culasse{' '}
                    {mission.breechForceN.toFixed(0)} N · ~
                    {mission.launchAccelG.toFixed(0)} g
                  </span>
                  <span>
                    Sommet {mission.apexHeightM.toFixed(0)} m @{' '}
                    {mission.apexRangeM.toFixed(0)} m
                  </span>
                  <span>
                    Dérive vent {mission.driftM >= 0 ? '+' : ''}
                    {mission.driftM.toFixed(1)} m · corr.{' '}
                    {mission.azimuthCorrectionDeg >= 0 ? '+' : ''}
                    {mission.azimuthCorrectionDeg.toFixed(2)}° (
                    {mission.azimuthCorrectionMils.toFixed(0)} mil)
                  </span>
                  <span>
                    Zone 50 % ±{mission.zone.semiRange50M.toFixed(0)} m / ±
                    {mission.zone.semiDefl50M.toFixed(0)} m
                  </span>
                  <span>
                    Zone 90 % ±{mission.zone.semiRange90M.toFixed(0)} m / ±
                    {mission.zone.semiDefl90M.toFixed(0)} m
                  </span>
                  <span>
                    Pression mini {mission.minPressureBar.toFixed(1)} bar · max
                    dispo {mission.maxPressureBar.toFixed(1)} bar
                  </span>
                  <span>
                    Portée max @ pression réglée{' '}
                    {formatDistance(mission.maxRangeAtPressureM)}
                  </span>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {!mission && gun && target && (
        <section className="panel-section">
          <p className="empty">Calcul de mission en cours…</p>
        </section>
      )}

      {!gun || !target ? (
        <section className="panel-section">
          <p className="empty">
            Placez une pièce et une cible pour obtenir l&apos;ordre de tir.
          </p>
        </section>
      ) : null}

      {observer && target && (
        <section className="panel-section">
          <h2>Depuis l&apos;observateur</h2>
          <Row label="Distance FO→cible" value={formatDistance(foRange)} />
          <Row
            label="Azimut FO"
            value={`${foAz.toFixed(2)}° · ${degreesToMils(foAz).toFixed(0)} mil`}
          />
        </section>
      )}

      <section className="panel-section">
        <h2>Météo · vent</h2>
        <div className="num-grid">
          <NumField
            label="Vitesse"
            value={wind.speedMs}
            step={0.5}
            min={0}
            max={40}
            unit="m/s"
            onChange={(speedMs) => onWind({ speedMs: Math.max(0, speedMs) })}
          />
          <NumField
            label="Provenance"
            value={wind.fromDeg}
            step={5}
            min={0}
            max={359}
            unit="°"
            onChange={(fromDeg) =>
              onWind({ fromDeg: ((fromDeg % 360) + 360) % 360 })
            }
          />
        </div>
        <div className="wind-presets">
          {WIND_PRESETS.map((p) => (
            <button
              key={p.fromDeg}
              type="button"
              className={`tool${wind.fromDeg === p.fromDeg ? ' is-active' : ''}`}
              onClick={() => onWind({ fromDeg: p.fromDeg })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2>Matériel (fixe)</h2>
        <div className="num-grid">
          <NumField
            label="Pression max dispo"
            value={cannon.pressureBar}
            step={0.5}
            min={1}
            max={MAX_WORKING_PRESSURE_BAR}
            unit="bar"
            onChange={(pressureBar) =>
              onCannon({
                pressureBar: Math.min(
                  MAX_WORKING_PRESSURE_BAR,
                  Math.max(0.5, pressureBar),
                ),
              })
            }
          />
          <NumField
            label="Calibre"
            value={cannon.boreMm}
            step={1}
            min={10}
            max={100}
            unit="mm"
            onChange={(boreMm) => onCannon({ boreMm })}
          />
          <NumField
            label="Masse obus"
            value={cannon.massG}
            step={1}
            min={1}
            max={500}
            unit="g"
            onChange={(massG) => onCannon({ massG })}
          />
          <NumField
            label="Longueur tube"
            value={cannon.barrelLengthM}
            step={0.05}
            min={0.8}
            max={2}
            unit="m"
            onChange={(barrelLengthM) => onCannon({ barrelLengthM })}
          />
          <NumField
            label="Volume détente"
            value={cannon.chamberVolumeL}
            step={0.05}
            min={0.2}
            max={5}
            unit="L"
            onChange={(chamberVolumeL) => onCannon({ chamberVolumeL })}
          />
          <NumField
            label="Rendement vanne"
            value={cannon.efficiency}
            step={0.05}
            min={0.2}
            max={1}
            unit="0–1"
            onChange={(efficiency) => onCannon({ efficiency })}
          />
          <NumField
            label="Cd ogive"
            value={cannon.dragCd}
            step={0.01}
            min={0.1}
            max={0.6}
            unit="—"
            onChange={(dragCd) => onCannon({ dragCd })}
          />
        </div>
        <p className="disclaimer">
          La « pression max dispo » est la limite régulateur (25 bar). La
          pression à régler pour le coup est calculée automatiquement selon le
          mode.
        </p>
      </section>

      <SavesPanel
        fireMode={fireMode}
        wind={wind}
        cannon={cannon}
        markers={markers}
        gunId={gunId}
        targetId={targetId}
        observerId={observerId}
        mission={mission}
        rangeM={rangeM}
        onLoad={onLoadMission}
      />

      <section className="panel-section">
        <h2>Marqueurs</h2>
        <ul className="marker-list">
          {markers.length === 0 && (
            <li className="empty">
              Aucun marqueur — choisissez un outil puis cliquez la carte.
            </li>
          )}
          {markers.map((m) => (
            <li key={m.id}>
              <div className="marker-row">
                <span
                  className="dot"
                  style={{ background: m.color }}
                  title={ROLE_META[m.role].label}
                />
                <input
                  className="name-input"
                  value={m.name}
                  onChange={(e) =>
                    onUpdateMarker(m.id, { name: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onDeleteMarker(m.id)}
                  title="Supprimer"
                >
                  ×
                </button>
              </div>
              <label className="alt-field">
                Alt. MSL (m)
                <input
                  type="number"
                  value={m.altM}
                  onChange={(e) =>
                    onUpdateMarker(m.id, {
                      altM: Number(e.target.value) || 0,
                    })
                  }
                />
              </label>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
