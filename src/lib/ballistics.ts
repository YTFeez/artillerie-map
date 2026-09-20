/**
 * Ballistique canon pneumatique HP — calibre 50 mm, obus ~50 g, 25 bar max.
 * Modèle : détente adiabatique + trajectoire 3D (traînée + vent).
 *
 * Repère pièce : x = avant (azimut), y = haut, z = droite.
 * Vent météo : direction D'OÙ vient le vent (0 = N, 90 = E).
 */

const G = 9.81
const GAMMA = 1.4
const P_ATM = 101_325
const RHO_AIR = 1.225

export const MAX_WORKING_PRESSURE_BAR = 25

export type AirCannonConfig = {
  boreMm: number
  massG: number
  pressureBar: number
  barrelLengthM: number
  chamberVolumeL: number
  efficiency: number
  dragCd: number
}

/** Vent météo : vitesse + provenance (degrés, 0 = Nord, sens horaire). */
export type WindConfig = {
  speedMs: number
  /** Direction d'où souffle le vent (°) */
  fromDeg: number
}

export const DEFAULT_AIR_CANNON: AirCannonConfig = {
  boreMm: 50,
  massG: 50,
  pressureBar: 25,
  barrelLengthM: 1.35,
  chamberVolumeL: 0.8,
  efficiency: 0.6,
  dragCd: 0.18,
}

export const DEFAULT_WIND: WindConfig = {
  speedMs: 0,
  fromDeg: 270, // Ouest → vent d'ouest
}

export type PneumaticResult = {
  boreAreaM2: number
  absolutePressurePa: number
  breechForceN: number
  muzzleEnergyJ: number
  muzzleVelocity: number
  maxRangeVacuumM: number
  maxRangeDragM: number
  optimalElevationDeg: number
  launchAccelG: number
}

/** Point échantillonné le long de la trajectoire (repère pièce). */
export type TrajectoryPoint = {
  x: number
  y: number
  z: number
  t: number
  speed: number
}

export type TrajectoryResult = {
  points: TrajectoryPoint[]
  /** Impact sur le plan y = deltaAltM */
  impact: TrajectoryPoint | null
  apex: TrajectoryPoint | null
  elevationDeg: number
  /** Dérive latérale à l'impact (m, + = droite) */
  driftM: number
  /** Portée horizontale sol (hypot x,z) */
  groundRangeM: number
  /** Correction d'azimut recommandée (°) pour annuler la dérive */
  azimuthCorrectionDeg: number
  /** Correction d'azimut (mil OTAN) */
  azimuthCorrectionMils: number
}

export type ImpactZone = {
  /** Demi-axe portée (m) — ellipse 50 % */
  semiRange50M: number
  /** Demi-axe dérive (m) */
  semiDefl50M: number
  semiRange90M: number
  semiDefl90M: number
  /** Centre ellipse en repère pièce (x,z) */
  centerX: number
  centerZ: number
}

export type FireSolution = {
  muzzleVelocity: number
  maxRangeM: number
  maxRangeVacuumM: number
  elevationLow: number | null
  elevationHigh: number | null
  tofLow: number | null
  tofHigh: number | null
  impactSpeedLow: number | null
  impactSpeedHigh: number | null
  driftLowM: number | null
  driftHighM: number | null
  azCorrLowDeg: number | null
  azCorrHighDeg: number | null
  inRange: boolean
  deltaAltM: number
  withDrag: boolean
  trajLow: TrajectoryResult | null
  trajHigh: TrajectoryResult | null
  zoneLow: ImpactZone | null
  zoneHigh: ImpactZone | null
}

export function boreArea(boreMm: number): number {
  const r = boreMm / 2000
  return Math.PI * r * r
}

export function adiabaticMuzzleEnergy(
  absolutePressurePa: number,
  chamberVolumeM3: number,
  boreAreaM2: number,
  barrelLengthM: number,
  efficiency: number,
): number {
  const V0 = Math.max(chamberVolumeM3, 1e-9)
  const Vf = V0 + boreAreaM2 * Math.max(barrelLengthM, 1e-6)
  const ideal =
    ((absolutePressurePa * V0) / (GAMMA - 1)) *
    (1 - (V0 / Vf) ** (GAMMA - 1))
  return Math.max(0, ideal * clamp(efficiency, 0.05, 1))
}

function clampPressureBar(bar: number): number {
  return clamp(bar, 0.5, MAX_WORKING_PRESSURE_BAR)
}

/**
 * Vent dans le repère pièce (x avant, z droite).
 * Convention météo : fromDeg = d'où vient le vent.
 */
export function windInGunFrame(
  wind: WindConfig,
  azimuthDeg: number,
): { wx: number; wz: number } {
  const sp = Math.max(0, wind.speedMs)
  const from = (wind.fromDeg * Math.PI) / 180
  const az = (azimuthDeg * Math.PI) / 180
  // Vitesse de la masse d'air (où elle va)
  const vE = -sp * Math.sin(from)
  const vN = -sp * Math.cos(from)
  // Avant pièce : E = sin(az), N = cos(az)
  const wx = vE * Math.sin(az) + vN * Math.cos(az)
  // Droite pièce : E = cos(az), N = -sin(az)
  const wz = vE * Math.cos(az) - vN * Math.sin(az)
  return { wx, wz }
}

export function computePneumatics(
  cfg: AirCannonConfig,
  wind: WindConfig = DEFAULT_WIND,
): PneumaticResult {
  const pressureBar = clampPressureBar(cfg.pressureBar)
  const A = boreArea(cfg.boreMm)
  const m = Math.max(cfg.massG, 0.1) / 1000
  const P_abs = pressureBar * 1e5 + P_ATM
  const P_gauge = pressureBar * 1e5
  const V0 = Math.max(cfg.chamberVolumeL, 0.01) / 1000
  const L = Math.max(cfg.barrelLengthM, 0.05)

  const E = adiabaticMuzzleEnergy(P_abs, V0, A, L, cfg.efficiency)
  const v0 = Math.sqrt((2 * E) / m)
  const F0 = P_gauge * A
  const maxRangeVacuum = (v0 * v0) / G

  const { rangeM: maxRangeDrag, elevationDeg } = maxRangeWithDrag(
    v0,
    cfg,
    wind,
    0,
  )

  return {
    boreAreaM2: A,
    absolutePressurePa: P_abs,
    breechForceN: F0,
    muzzleEnergyJ: E,
    muzzleVelocity: v0,
    maxRangeVacuumM: maxRangeVacuum,
    maxRangeDragM: maxRangeDrag,
    optimalElevationDeg: elevationDeg,
    launchAccelG: F0 / (m * G),
  }
}

/**
 * Intégration RK4 3D : traînée relative au vent + gravité.
 * Azimut = 0 dans le repère pièce (tir le long de +x) ; le vent est déjà projeté.
 */
export function simulateTrajectory(
  v0: number,
  elevationDeg: number,
  cfg: AirCannonConfig,
  wind: WindConfig = DEFAULT_WIND,
  azimuthDeg = 0,
  deltaAltM = 0,
  sampleEvery = 8,
): TrajectoryResult {
  const m = Math.max(cfg.massG, 0.1) / 1000
  const A = boreArea(cfg.boreMm)
  const Cd = clamp(cfg.dragCd, 0.05, 1.5)
  const k = (0.5 * RHO_AIR * Cd * A) / m
  const { wx, wz } = windInGunFrame(wind, azimuthDeg)

  const θ = (elevationDeg * Math.PI) / 180
  let vx = v0 * Math.cos(θ)
  let vy = v0 * Math.sin(θ)
  let vz = 0
  let x = 0
  let y = 0
  let z = 0
  let t = 0

  const dt = 0.002
  const maxT = 90
  let crossedUp = deltaAltM <= 0
  let step = 0
  let apex: TrajectoryPoint | null = null
  let maxY = -Infinity

  const points: TrajectoryPoint[] = [
    { x: 0, y: 0, z: 0, t: 0, speed: v0 },
  ]

  const accel = (px: number, py: number, pz: number) => {
    const vrx = px - wx
    const vry = py
    const vrz = pz - wz
    const sr = Math.hypot(vrx, vry, vrz)
    return {
      ax: -k * sr * vrx,
      ay: -G - k * sr * vry,
      az: -k * sr * vrz,
    }
  }

  let impact: TrajectoryPoint | null = null

  while (t < maxT) {
    const speed = Math.hypot(vx, vy, vz)
    if (speed < 0.5 && t > 0.05) break

    const a1 = accel(vx, vy, vz)
    const k2v = {
      vx: vx + 0.5 * dt * a1.ax,
      vy: vy + 0.5 * dt * a1.ay,
      vz: vz + 0.5 * dt * a1.az,
    }
    const a2 = accel(k2v.vx, k2v.vy, k2v.vz)
    const k3v = {
      vx: vx + 0.5 * dt * a2.ax,
      vy: vy + 0.5 * dt * a2.ay,
      vz: vz + 0.5 * dt * a2.az,
    }
    const a3 = accel(k3v.vx, k3v.vy, k3v.vz)
    const k4v = {
      vx: vx + dt * a3.ax,
      vy: vy + dt * a3.ay,
      vz: vz + dt * a3.az,
    }
    const a4 = accel(k4v.vx, k4v.vy, k4v.vz)

    const nvx =
      vx + (dt / 6) * (a1.ax + 2 * a2.ax + 2 * a3.ax + a4.ax)
    const nvy =
      vy + (dt / 6) * (a1.ay + 2 * a2.ay + 2 * a3.ay + a4.ay)
    const nvz =
      vz + (dt / 6) * (a1.az + 2 * a2.az + 2 * a3.az + a4.az)
    const nx = x + (dt / 6) * (vx + 2 * k2v.vx + 2 * k3v.vx + k4v.vx)
    const ny = y + (dt / 6) * (vy + 2 * k2v.vy + 2 * k3v.vy + k4v.vy)
    const nz = z + (dt / 6) * (vz + 2 * k2v.vz + 2 * k3v.vz + k4v.vz)
    const nt = t + dt

    if (ny > maxY) {
      maxY = ny
      apex = {
        x: nx,
        y: ny,
        z: nz,
        t: nt,
        speed: Math.hypot(nvx, nvy, nvz),
      }
    }

    if (!crossedUp && ny >= deltaAltM) crossedUp = true

    const hitDescending =
      crossedUp && y > deltaAltM && ny <= deltaAltM && nvy <= 0
    const hitAscendingClose =
      deltaAltM > 0 && y < deltaAltM && ny >= deltaAltM && t > 0

    if (hitDescending || hitAscendingClose) {
      const denom = ny - y
      const frac = Math.abs(denom) < 1e-12 ? 0 : (deltaAltM - y) / denom
      const fx = x + frac * (nx - x)
      const fy = deltaAltM
      const fz = z + frac * (nz - z)
      const fvx = vx + frac * (nvx - vx)
      const fvy = vy + frac * (nvy - vy)
      const fvz = vz + frac * (nvz - vz)
      const ft = t + frac * dt
      const fs = Math.hypot(fvx, fvy, fvz)
      if (fx > 0.5 || Math.hypot(fx, fz) > 0.5) {
        impact = { x: fx, y: fy, z: fz, t: ft, speed: fs }
        points.push(impact)
      }
      break
    }

    if (ny < Math.min(0, deltaAltM) - 5 && t > 0.1) break

    x = nx
    y = ny
    z = nz
    vx = nvx
    vy = nvy
    vz = nvz
    t = nt
    step++
    if (step % sampleEvery === 0) {
      points.push({ x, y, z, t, speed: Math.hypot(vx, vy, vz) })
    }
  }

  const groundRangeM = impact
    ? Math.hypot(impact.x, impact.z)
    : Math.hypot(x, z)
  const driftM = impact?.z ?? z
  const azCorrRad = impact ? Math.atan2(impact.z, impact.x) : 0
  // Correction : viser à gauche de la dérive positive
  const azimuthCorrectionDeg = (-azCorrRad * 180) / Math.PI
  const azimuthCorrectionMils = (azimuthCorrectionDeg / 360) * 6400

  return {
    points,
    impact,
    apex,
    elevationDeg,
    driftM,
    groundRangeM,
    azimuthCorrectionDeg,
    azimuthCorrectionMils,
  }
}

/** Portée le long de l'axe de tir (coord. x) — pour le solveur d'élévation. */
export function rangeAlongAim(
  elevationDeg: number,
  v0: number,
  cfg: AirCannonConfig,
  wind: WindConfig,
  azimuthDeg: number,
  deltaAltM = 0,
): number | null {
  const traj = simulateTrajectory(
    v0,
    elevationDeg,
    cfg,
    wind,
    azimuthDeg,
    deltaAltM,
    40,
  )
  return traj.impact ? traj.impact.x : null
}

function maxRangeWithDrag(
  v0: number,
  cfg: AirCannonConfig,
  wind: WindConfig,
  deltaAltM: number,
  azimuthDeg = 0,
): { rangeM: number; elevationDeg: number } {
  if (v0 < 1) return { rangeM: 0, elevationDeg: 45 }

  let bestR = 0
  let bestE = 30
  for (let e = 5; e <= 55; e += 2.5) {
    const r = rangeAlongAim(e, v0, cfg, wind, azimuthDeg, deltaAltM)
    if (r != null && r > bestR) {
      bestR = r
      bestE = e
    }
  }
  for (let e = bestE - 2.5; e <= bestE + 2.5; e += 0.25) {
    if (e < 1 || e > 80) continue
    const r = rangeAlongAim(e, v0, cfg, wind, azimuthDeg, deltaAltM)
    if (r != null && r > bestR) {
      bestR = r
      bestE = e
    }
  }
  return { rangeM: bestR, elevationDeg: bestE }
}

export function solveElevationDrag(
  rangeM: number,
  deltaAltM: number,
  v0: number,
  cfg: AirCannonConfig,
  wind: WindConfig = DEFAULT_WIND,
  azimuthDeg = 0,
): { low: number | null; high: number | null } {
  if (rangeM < 0.5 || v0 < 1) return { low: null, high: null }

  const { rangeM: maxR, elevationDeg: optE } = maxRangeWithDrag(
    v0,
    cfg,
    wind,
    deltaAltM,
    azimuthDeg,
  )
  if (rangeM > maxR * 1.01) return { low: null, high: null }

  const low = bisectElevation(
    1,
    optE,
    rangeM,
    deltaAltM,
    v0,
    cfg,
    wind,
    azimuthDeg,
    'low',
  )
  const high = bisectElevation(
    optE,
    80,
    rangeM,
    deltaAltM,
    v0,
    cfg,
    wind,
    azimuthDeg,
    'high',
  )

  return { low, high }
}

function bisectElevation(
  lo: number,
  hi: number,
  targetRange: number,
  deltaAltM: number,
  v0: number,
  cfg: AirCannonConfig,
  wind: WindConfig,
  azimuthDeg: number,
  branch: 'low' | 'high',
): number | null {
  let a = lo
  let b = hi
  let best: number | null = null

  for (let i = 0; i < 28; i++) {
    const mid = (a + b) / 2
    const r = rangeAlongAim(mid, v0, cfg, wind, azimuthDeg, deltaAltM)
    if (r == null) {
      if (branch === 'low') a = mid
      else b = mid
      continue
    }
    best = mid
    if (Math.abs(r - targetRange) < 0.35) return mid

    if (branch === 'low') {
      if (r < targetRange) a = mid
      else b = mid
    } else {
      if (r < targetRange) b = mid
      else a = mid
    }
  }

  if (best == null) return null
  const rBest = rangeAlongAim(best, v0, cfg, wind, azimuthDeg, deltaAltM)
  if (
    rBest == null ||
    Math.abs(rBest - targetRange) > Math.max(3, targetRange * 0.02)
  )
    return null
  return best
}

/**
 * Ellipse d'impact (modèle opérationnel simplifié).
 * Incertitudes : chronographe ±3 %, Cd ±10 %, vent ±1 m/s, pointage ±2 mil.
 */
export function computeImpactZone(
  traj: TrajectoryResult,
  wind: WindConfig,
  v0: number,
): ImpactZone {
  const tof = traj.impact?.t ?? 1
  const range = traj.groundRangeM || 1
  const windSens = Math.max(0.35, tof * 0.55)

  const semiRange50 =
    range * 0.018 + 4 + Math.abs(wind.speedMs) * 0.15 * tof * 0.2
  const semiDefl50 =
    2.5 + windSens * 1.0 + Math.max(0, wind.speedMs) * 0.12 * tof

  // Facteur vitesse (tir rapide = ellipse un peu plus serrée)
  const vFac = clamp(180 / Math.max(v0, 80), 0.7, 1.4)

  return {
    semiRange50M: semiRange50 * vFac,
    semiDefl50M: semiDefl50 * vFac,
    semiRange90M: semiRange50 * vFac * 2.15,
    semiDefl90M: semiDefl50 * vFac * 2.15,
    centerX: traj.impact?.x ?? traj.groundRangeM,
    centerZ: traj.impact?.z ?? 0,
  }
}

export function computeAirSolution(
  rangeM: number,
  deltaAltM: number,
  cfg: AirCannonConfig,
  wind: WindConfig = DEFAULT_WIND,
  azimuthDeg = 0,
): FireSolution {
  const p = computePneumatics(cfg, wind)
  const v0 = p.muzzleVelocity
  const { low, high } = solveElevationDrag(
    rangeM,
    deltaAltM,
    v0,
    cfg,
    wind,
    azimuthDeg,
  )

  const trajLow =
    low != null
      ? simulateTrajectory(v0, low, cfg, wind, azimuthDeg, deltaAltM)
      : null
  const trajHigh =
    high != null
      ? simulateTrajectory(v0, high, cfg, wind, azimuthDeg, deltaAltM)
      : null

  const inRange =
    rangeM <= p.maxRangeDragM * 1.02 && (low !== null || high !== null)

  return {
    muzzleVelocity: v0,
    maxRangeM: p.maxRangeDragM,
    maxRangeVacuumM: p.maxRangeVacuumM,
    elevationLow: low,
    elevationHigh: high,
    tofLow: trajLow?.impact?.t ?? null,
    tofHigh: trajHigh?.impact?.t ?? null,
    impactSpeedLow: trajLow?.impact?.speed ?? null,
    impactSpeedHigh: trajHigh?.impact?.speed ?? null,
    driftLowM: trajLow?.driftM ?? null,
    driftHighM: trajHigh?.driftM ?? null,
    azCorrLowDeg: trajLow?.azimuthCorrectionDeg ?? null,
    azCorrHighDeg: trajHigh?.azimuthCorrectionDeg ?? null,
    inRange,
    deltaAltM,
    withDrag: true,
    trajLow,
    trajHigh,
    zoneLow: trajLow ? computeImpactZone(trajLow, wind, v0) : null,
    zoneHigh: trajHigh ? computeImpactZone(trajHigh, wind, v0) : null,
  }
}

/** Mode de tir opérationnel */
export type FireMode = 'direct' | 'plunging'

export const FIRE_MODE_META: Record<
  FireMode,
  { label: string; short: string; branch: 'low' | 'high'; blurb: string }
> = {
  direct: {
    label: 'Tir direct',
    short: 'Infanterie',
    branch: 'low',
    blurb: 'Trajectoire tendue — pression max pour aplatir l’angle.',
  },
  plunging: {
    label: 'Tir en cloche',
    short: 'Artillerie',
    branch: 'high',
    blurb: 'Trajectoire plongeante — pression calée pour ~55° d’élévation.',
  },
}

export type FireMission = {
  mode: FireMode
  inRange: boolean
  /** Pression à régler sur le régulateur (bar) */
  pressureBar: number
  /** Pression mini pour atteindre la cible dans ce mode */
  minPressureBar: number
  /** Pression max disponible (limite système) */
  maxPressureBar: number
  elevationDeg: number
  elevationMils: number
  /** Azimut géométrique pièce→cible */
  azimuthDeg: number
  /** Azimut de pointage = géométrie + correction vent */
  aimAzimuthDeg: number
  aimAzimuthMils: number
  azimuthCorrectionDeg: number
  azimuthCorrectionMils: number
  muzzleVelocity: number
  impactSpeed: number
  tofS: number
  driftM: number
  apexHeightM: number
  apexRangeM: number
  breechForceN: number
  muzzleEnergyJ: number
  launchAccelG: number
  maxRangeAtPressureM: number
  traj: TrajectoryResult
  zone: ImpactZone
  /** Message opérateur */
  order: string
  reason: string
}

function cfgAtPressure(cfg: AirCannonConfig, pressureBar: number): AirCannonConfig {
  return { ...cfg, pressureBar: clamp(pressureBar, 0.5, MAX_WORKING_PRESSURE_BAR) }
}

function canReachWithBranch(
  rangeM: number,
  deltaAltM: number,
  cfg: AirCannonConfig,
  wind: WindConfig,
  azimuthDeg: number,
  branch: 'low' | 'high',
): boolean {
  const p = computePneumatics(cfg, wind)
  const { low, high } = solveElevationDrag(
    rangeM,
    deltaAltM,
    p.muzzleVelocity,
    cfg,
    wind,
    azimuthDeg,
  )
  return branch === 'low' ? low != null : high != null
}

/** Pression minimale pour atteindre rangeM avec la branche demandée. */
export function findMinPressure(
  rangeM: number,
  deltaAltM: number,
  cfg: AirCannonConfig,
  wind: WindConfig,
  azimuthDeg: number,
  branch: 'low' | 'high',
  maxPressureBar = MAX_WORKING_PRESSURE_BAR,
): number | null {
  const hiCfg = cfgAtPressure(cfg, maxPressureBar)
  if (!canReachWithBranch(rangeM, deltaAltM, hiCfg, wind, azimuthDeg, branch)) {
    return null
  }

  let lo = 1
  let hi = maxPressureBar
  let best = maxPressureBar
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2
    const midCfg = cfgAtPressure(cfg, mid)
    if (canReachWithBranch(rangeM, deltaAltM, midCfg, wind, azimuthDeg, branch)) {
      best = mid
      hi = mid
    } else {
      lo = mid
    }
  }
  // Marge sécurité 3 %
  return Math.min(maxPressureBar, Math.ceil(best * 1.03 * 10) / 10)
}

/**
 * Pour tir en cloche : pression telle que l'élévation haute ≈ targetElevDeg.
 * Si impossible, retombe sur minPressure.
 */
function findPressureForHighElevation(
  rangeM: number,
  deltaAltM: number,
  cfg: AirCannonConfig,
  wind: WindConfig,
  azimuthDeg: number,
  targetElevDeg: number,
  minP: number,
  maxP: number,
): number {
  // Plus de pression → élévation haute plus proche de l'opt / plus basse sur la branche haute
  // À minP, high elev est proche de opt (~30°). À maxP, high elev monte (plus plongeant).
  let bestP = minP
  let bestErr = Infinity
  for (let i = 0; i <= 24; i++) {
    const P = minP + ((maxP - minP) * i) / 24
    const c = cfgAtPressure(cfg, P)
    const v0 = computePneumatics(c, wind).muzzleVelocity
    const { high } = solveElevationDrag(
      rangeM,
      deltaAltM,
      v0,
      c,
      wind,
      azimuthDeg,
    )
    if (high == null) continue
    const err = Math.abs(high - targetElevDeg)
    if (err < bestErr) {
      bestErr = err
      bestP = P
    }
  }
  return Math.round(bestP * 10) / 10
}

/**
 * Mission de tir : le logiciel calcule pression, angle, azimut corrigé, etc.
 * - direct (infanterie) : pression max → trajectoire la plus tendue
 * - plunging (artillerie) : pression calée pour élévation haute ~55°
 */
export function computeFireMission(
  rangeM: number,
  deltaAltM: number,
  cfg: AirCannonConfig,
  wind: WindConfig,
  azimuthDeg: number,
  mode: FireMode,
  maxPressureBar = MAX_WORKING_PRESSURE_BAR,
): FireMission | null {
  if (rangeM < 1) return null

  const maxP = clamp(maxPressureBar, 1, MAX_WORKING_PRESSURE_BAR)
  const branch = FIRE_MODE_META[mode].branch
  const minP = findMinPressure(
    rangeM,
    deltaAltM,
    cfg,
    wind,
    azimuthDeg,
    branch,
    maxP,
  )

  if (minP == null) {
    const atMax = computePneumatics(cfgAtPressure(cfg, maxP), wind)
    return {
      mode,
      inRange: false,
      pressureBar: maxP,
      minPressureBar: maxP,
      maxPressureBar: maxP,
      elevationDeg: 0,
      elevationMils: 0,
      azimuthDeg,
      aimAzimuthDeg: azimuthDeg,
      aimAzimuthMils: (azimuthDeg / 360) * 6400,
      azimuthCorrectionDeg: 0,
      azimuthCorrectionMils: 0,
      muzzleVelocity: atMax.muzzleVelocity,
      impactSpeed: 0,
      tofS: 0,
      driftM: 0,
      apexHeightM: 0,
      apexRangeM: 0,
      breechForceN: atMax.breechForceN,
      muzzleEnergyJ: atMax.muzzleEnergyJ,
      launchAccelG: atMax.launchAccelG,
      maxRangeAtPressureM: atMax.maxRangeDragM,
      traj: {
        points: [],
        impact: null,
        apex: null,
        elevationDeg: 0,
        driftM: 0,
        groundRangeM: 0,
        azimuthCorrectionDeg: 0,
        azimuthCorrectionMils: 0,
      },
      zone: {
        semiRange50M: 0,
        semiDefl50M: 0,
        semiRange90M: 0,
        semiDefl90M: 0,
        centerX: 0,
        centerZ: 0,
      },
      order: 'HORS PORTÉE',
      reason: `Impossible en ${FIRE_MODE_META[mode].label.toLowerCase()} même à ${maxP} bar (portée max ≈ ${Math.round(atMax.maxRangeDragM)} m).`,
    }
  }

  let pressureBar: number
  let reason: string

  if (mode === 'direct') {
    pressureBar = maxP
    reason =
      'Tir direct : pression max pour trajectoire la plus tendue (élévation basse).'
  } else {
    pressureBar = findPressureForHighElevation(
      rangeM,
      deltaAltM,
      cfg,
      wind,
      azimuthDeg,
      55,
      minP,
      maxP,
    )
    reason =
      'Tir en cloche : pression réglée pour viser ~55° d’élévation (branche haute).'
  }

  const missionCfg = cfgAtPressure(cfg, pressureBar)
  const pneumo = computePneumatics(missionCfg, wind)
  const v0 = pneumo.muzzleVelocity
  const { low, high } = solveElevationDrag(
    rangeM,
    deltaAltM,
    v0,
    missionCfg,
    wind,
    azimuthDeg,
  )
  const elev = mode === 'direct' ? low : high
  if (elev == null) return null

  const traj = simulateTrajectory(
    v0,
    elev,
    missionCfg,
    wind,
    azimuthDeg,
    deltaAltM,
  )
  if (!traj.impact) return null

  const zone = computeImpactZone(traj, wind, v0)
  const elevMils = (elev / 360) * 6400
  const aimAz = (azimuthDeg + traj.azimuthCorrectionDeg + 360) % 360
  const aimMils = (aimAz / 360) * 6400

  const order = [
    `MODE ${FIRE_MODE_META[mode].label.toUpperCase()} (${FIRE_MODE_META[mode].short})`,
    `PRESSION ${pressureBar.toFixed(1)} bar`,
    `ÉLÉVATION ${elev.toFixed(2)}° (${elevMils.toFixed(0)} mil)`,
    `AZIMUT ${aimAz.toFixed(2)}° (${aimMils.toFixed(0)} mil)`,
    `ToF ${traj.impact.t.toFixed(2)} s`,
  ].join(' · ')

  return {
    mode,
    inRange: true,
    pressureBar,
    minPressureBar: minP,
    maxPressureBar: maxP,
    elevationDeg: elev,
    elevationMils: elevMils,
    azimuthDeg,
    aimAzimuthDeg: aimAz,
    aimAzimuthMils: aimMils,
    azimuthCorrectionDeg: traj.azimuthCorrectionDeg,
    azimuthCorrectionMils: traj.azimuthCorrectionMils,
    muzzleVelocity: v0,
    impactSpeed: traj.impact.speed,
    tofS: traj.impact.t,
    driftM: traj.driftM,
    apexHeightM: traj.apex?.y ?? 0,
    apexRangeM: traj.apex?.x ?? 0,
    breechForceN: pneumo.breechForceN,
    muzzleEnergyJ: pneumo.muzzleEnergyJ,
    launchAccelG: pneumo.launchAccelG,
    maxRangeAtPressureM: pneumo.maxRangeDragM,
    traj,
    zone,
    order,
    reason,
  }
}

/** Compat : impact 2D sans vent (tests / legacy). */
export function simulateImpact(
  v0: number,
  elevationDeg: number,
  cfg: AirCannonConfig,
  deltaAltM = 0,
): { rangeM: number; tofS: number; impactSpeed: number } | null {
  const traj = simulateTrajectory(
    v0,
    elevationDeg,
    cfg,
    DEFAULT_WIND,
    0,
    deltaAltM,
  )
  if (!traj.impact) return null
  return {
    rangeM: traj.impact.x,
    tofS: traj.impact.t,
    impactSpeed: traj.impact.speed,
  }
}

export function rangeAtElevationDrag(
  elevationDeg: number,
  v0: number,
  cfg: AirCannonConfig,
  deltaAltM = 0,
): number | null {
  return simulateImpact(v0, elevationDeg, cfg, deltaAltM)?.rangeM ?? null
}

export function solveElevationVacuum(
  rangeM: number,
  deltaAltM: number,
  v0: number,
): { low: number | null; high: number | null } {
  if (rangeM < 0.5 || v0 < 1) return { low: null, high: null }
  const a = (G * rangeM * rangeM) / (2 * v0 * v0)
  const c = a + deltaAltM
  const disc = rangeM * rangeM - 4 * a * c
  if (disc < 0) return { low: null, high: null }
  const sqrt = Math.sqrt(disc)
  const u1 = (rangeM - sqrt) / (2 * a)
  const u2 = (rangeM + sqrt) / (2 * a)
  const angles = [u1, u2]
    .map((u) => (Math.atan(u) * 180) / Math.PI)
    .filter((t) => t > 0.5 && t < 85)
    .sort((x, y) => x - y)
  return { low: angles[0] ?? null, high: angles.length > 1 ? angles[1]! : null }
}

export const solveElevation = solveElevationVacuum

export function timeOfFlight(
  rangeM: number,
  elevationDeg: number,
  v0: number,
): number {
  const θ = (elevationDeg * Math.PI) / 180
  const vx = v0 * Math.cos(θ)
  if (vx < 0.1) return 0
  return rangeM / vx
}

export function impactSpeedVacuum(v0: number, deltaAltM: number): number {
  const v2 = v0 * v0 - 2 * G * deltaAltM
  return v2 > 0 ? Math.sqrt(v2) : 0
}

export const impactSpeed = impactSpeedVacuum

export function rangeAtElevation(
  elevationDeg: number,
  v0: number,
  deltaAltM = 0,
): number | null {
  const θ = (elevationDeg * Math.PI) / 180
  const vx = v0 * Math.cos(θ)
  const vy = v0 * Math.sin(θ)
  const disc = vy * vy - 2 * G * deltaAltM
  if (disc < 0) return null
  const t = (vy + Math.sqrt(disc)) / G
  if (t <= 0) return null
  return vx * t
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
