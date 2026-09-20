import type { FireMission, FireMode } from './ballistics'
import { FIRE_MODE_META } from './ballistics'
import { degreesToMils } from './geo'

export type FireStep = {
  n: number
  title: string
  detail: string
  value?: string
  kind: 'prep' | 'aim' | 'safety' | 'fire' | 'correct'
}

export type FireCorrection = {
  id: string
  label: string
  command: string
  reason: string
  severity: 'info' | 'warn' | 'critical'
}

/** Ordres de tir pas à pas pour l'opérateur. */
export function buildFireSteps(
  mission: FireMission,
  rangeM: number,
  mode: FireMode,
): FireStep[] {
  const meta = FIRE_MODE_META[mode]
  if (!mission.inRange) {
    return [
      {
        n: 1,
        title: 'STOP — hors portée',
        detail: mission.reason,
        kind: 'safety',
      },
      {
        n: 2,
        title: 'Options',
        detail:
          'Rapprochez la pièce, augmentez la pression max dispo, allongez le tube, ou changez de mode.',
        kind: 'correct',
      },
    ]
  }

  const windCorr =
    Math.abs(mission.azimuthCorrectionMils) >= 1
      ? `Corriger azimut ${mission.azimuthCorrectionDeg >= 0 ? 'droite' : 'gauche'} ${Math.abs(mission.azimuthCorrectionMils).toFixed(0)} mil (vent).`
      : 'Pas de correction vent significative.'

  return [
    {
      n: 1,
      title: 'Mode',
      detail: `${meta.label} (${meta.short}) — ${meta.blurb}`,
      value: meta.label,
      kind: 'prep',
    },
    {
      n: 2,
      title: 'Pression régulateur',
      detail: `Régler à ${mission.pressureBar.toFixed(1)} bar (mini ${mission.minPressureBar.toFixed(1)} · max ${mission.maxPressureBar.toFixed(1)}).`,
      value: `${mission.pressureBar.toFixed(1)} bar`,
      kind: 'prep',
    },
    {
      n: 3,
      title: 'Azimut de pointage',
      detail: `Pointer ${mission.aimAzimuthDeg.toFixed(2)}° (${mission.aimAzimuthMils.toFixed(0)} mil). ${windCorr}`,
      value: `${mission.aimAzimuthDeg.toFixed(2)}°`,
      kind: 'aim',
    },
    {
      n: 4,
      title: 'Élévation',
      detail: `Hausse ${mission.elevationDeg.toFixed(2)}° (${mission.elevationMils.toFixed(0)} mil). Distance ${Math.round(rangeM)} m.`,
      value: `${mission.elevationDeg.toFixed(2)}° / ${mission.elevationMils.toFixed(0)} mil`,
      kind: 'aim',
    },
    {
      n: 5,
      title: 'Sécurité zone',
      detail: `Zone 50 % ±${mission.zone.semiRange50M.toFixed(0)} m / ±${mission.zone.semiDefl50M.toFixed(0)} m. Zone 90 % plus large — personne dans le corridor de tir.`,
      value: `ToF ${mission.tofS.toFixed(1)} s`,
      kind: 'safety',
    },
    {
      n: 6,
      title: 'Contrôles avant FEU',
      detail: `v₀ ≈ ${mission.muzzleVelocity.toFixed(0)} m/s · impact ≈ ${mission.impactSpeed.toFixed(0)} m/s · sommet ${mission.apexHeightM.toFixed(0)} m. Culasse verrouillée, tube dégagé, observateur informé.`,
      kind: 'prep',
    },
    {
      n: 7,
      title: 'FEU',
      detail: mission.order,
      value: 'FEU',
      kind: 'fire',
    },
  ]
}

/**
 * Corrections automatiques basées sur l'écart impact calculé vs cible
 * + vent + mode (à appliquer au prochain coup).
 */
export function buildFireCorrections(
  mission: FireMission,
  rangeM: number,
): FireCorrection[] {
  const out: FireCorrection[] = []

  if (!mission.inRange) {
    out.push({
      id: 'oor',
      label: 'Portée',
      command: 'NE PAS TIRER',
      reason: mission.reason,
      severity: 'critical',
    })
    return out
  }

  const impactX = mission.traj.impact?.x ?? rangeM
  const missRange = impactX - rangeM
  const missDefl = mission.driftM

  // Écart résiduel de modèle (devrait être ~0 si solveur OK)
  if (Math.abs(missRange) > 3) {
    const mils = degreesToMils(
      Math.atan2(missRange, Math.max(rangeM, 1)) * (180 / Math.PI),
    )
    out.push({
      id: 'range',
      label: 'Portée',
      command:
        missRange > 0
          ? `MOINS hausse ~${Math.abs(mils).toFixed(0)} mil`
          : `PLUS hausse ~${Math.abs(mils).toFixed(0)} mil`,
      reason: `Écart calculé ${missRange >= 0 ? '+' : ''}${missRange.toFixed(1)} m en portée.`,
      severity: 'warn',
    })
  }

  if (Math.abs(missDefl) > 1.5) {
    out.push({
      id: 'defl',
      label: 'Direction',
      command:
        missDefl > 0
          ? `GAUCHE ${Math.abs(mission.azimuthCorrectionMils).toFixed(0)} mil`
          : `DROITE ${Math.abs(mission.azimuthCorrectionMils).toFixed(0)} mil`,
      reason: `Dérive vent ${missDefl >= 0 ? '+' : ''}${missDefl.toFixed(1)} m (droite +).`,
      severity: 'warn',
    })
  } else {
    out.push({
      id: 'defl-ok',
      label: 'Direction',
      command: 'Tenir azimut calculé',
      reason: 'Dérive compensée dans l’azimut de pointage.',
      severity: 'info',
    })
  }

  if (mission.mode === 'direct' && mission.elevationDeg > 18) {
    out.push({
      id: 'flat',
      label: 'Trajectoire',
      command: 'Augmenter pression max si possible',
      reason: `Élévation ${mission.elevationDeg.toFixed(1)}° encore haute pour un tir direct.`,
      severity: 'warn',
    })
  }

  if (mission.mode === 'plunging' && mission.tofS > 12) {
    out.push({
      id: 'tof',
      label: 'Temps de vol',
      command: 'Surveiller dérive vent pendant le vol',
      reason: `ToF long (${mission.tofS.toFixed(1)} s) — vent variable = écart.`,
      severity: 'warn',
    })
  }

  if (mission.pressureBar > mission.minPressureBar + 0.5) {
    out.push({
      id: 'pmin',
      label: 'Pression',
      command: `Tenir ${mission.pressureBar.toFixed(1)} bar`,
      reason: `Marge vs mini ${mission.minPressureBar.toFixed(1)} bar — ne pas descendre sans recalcul.`,
      severity: 'info',
    })
  }

  out.push({
    id: 'zone',
    label: 'Zone impact',
    command: `Corridor ±${mission.zone.semiDefl90M.toFixed(0)} m / ±${mission.zone.semiRange90M.toFixed(0)} m (90 %)`,
    reason: 'Personne dans l’ellipse ni sous la trajectoire.',
    severity: 'critical',
  })

  return out
}
