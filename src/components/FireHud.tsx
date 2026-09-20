import type { FireMission, FireMode, WindConfig } from '../lib/ballistics'
import { FIRE_MODE_META } from '../lib/ballistics'
import { buildFireCorrections, buildFireSteps } from '../lib/fireOrders'
import { formatDistance } from '../lib/geo'

type Props = {
  mission: FireMission | null
  fireMode: FireMode
  wind: WindConfig
  rangeM: number
  pitch3d: boolean
  onTogglePitch: () => void
  onFireMode: (m: FireMode) => void
}

export function FireHud({
  mission,
  fireMode,
  wind,
  rangeM,
  pitch3d,
  onTogglePitch,
  onFireMode,
}: Props) {
  const steps = mission ? buildFireSteps(mission, rangeM, fireMode) : []
  const corrections = mission ? buildFireCorrections(mission, rangeM) : []

  return (
    <div className="fire-hud">
      <div className="fire-hud-top">
        <div className="fire-hud-modes">
          {(Object.keys(FIRE_MODE_META) as FireMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={fireMode === m ? 'is-active' : ''}
              onClick={() => onFireMode(m)}
            >
              {FIRE_MODE_META[m].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`hud-chip${pitch3d ? ' is-active' : ''}`}
          onClick={onTogglePitch}
          title="Vue carte 3D / plat"
        >
          {pitch3d ? 'Vue 3D ON' : 'Vue 3D OFF'}
        </button>
      </div>

      {mission?.inRange && (
        <div className="fire-order-strip">
          <span className="tag">ORDRE</span>
          <strong>{mission.order}</strong>
        </div>
      )}

      <div className="fire-hud-cols">
        <div className="hud-card">
          <h3>Instructions de tir</h3>
          {!mission && (
            <p className="empty">Placez pièce + cible pour générer les ordres.</p>
          )}
          <ol className="fire-steps">
            {steps.map((s) => (
              <li key={s.n} className={`step-${s.kind}`}>
                <div className="step-head">
                  <em>{s.n}</em>
                  <strong>{s.title}</strong>
                  {s.value && <span>{s.value}</span>}
                </div>
                <p>{s.detail}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="hud-card">
          <h3>Corrections à prendre</h3>
          {!mission && (
            <p className="empty">Les corrections s’affichent avec la mission.</p>
          )}
          <ul className="fire-corr">
            {corrections.map((c) => (
              <li key={c.id} className={`sev-${c.severity}`}>
                <div className="corr-head">
                  <strong>{c.label}</strong>
                  <span>{c.command}</span>
                </div>
                <p>{c.reason}</p>
              </li>
            ))}
          </ul>
          {mission?.inRange && (
            <div className="hud-quick">
              <div>
                <em>Distance</em>
                <b>{formatDistance(rangeM)}</b>
              </div>
              <div>
                <em>Vent</em>
                <b>
                  {wind.speedMs.toFixed(1)} m/s / {wind.fromDeg.toFixed(0)}°
                </b>
              </div>
              <div>
                <em>Sommet</em>
                <b>{mission.apexHeightM.toFixed(0)} m</b>
              </div>
              <div>
                <em>Dérive</em>
                <b>
                  {mission.driftM >= 0 ? '+' : ''}
                  {mission.driftM.toFixed(1)} m
                </b>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
