/** Constantes géodésiques et conversions artillerie */

export const EARTH_RADIUS_M = 6_371_000
/** Cercle OTAN : 6400 millièmes */
export const MILS_CIRCLE = 6400

export type LatLng = { lat: number; lng: number }

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** Distance orthodromique (Haversine) en mètres */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat)
  const φ2 = toRad(b.lat)
  const Δφ = toRad(b.lat - a.lat)
  const Δλ = toRad(b.lng - a.lng)

  const h =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/**
 * Azimut initial (bearing) de A vers B, en degrés [0, 360).
 * 0 = Nord, sens horaire.
 */
export function initialBearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat)
  const φ2 = toRad(b.lat)
  const Δλ = toRad(b.lng - a.lng)

  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export function degreesToMils(deg: number): number {
  return (deg / 360) * MILS_CIRCLE
}

export function milsToDegrees(mils: number): number {
  return (mils / MILS_CIRCLE) * 360
}

export function backAzimuth(deg: number): number {
  return (deg + 180) % 360
}

/** Angle de site en millièmes (approx. petite distance) */
export function angleOfSiteMils(rangeM: number, deltaAltM: number): number {
  if (rangeM < 1) return 0
  return degreesToMils(toDeg(Math.atan2(deltaAltM, rangeM)))
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m)} m`
}

export function formatCoord(n: number, digits = 5): string {
  return n.toFixed(digits)
}

/** Point intermédiaire le long du grand cercle (pour tracer la ligne de tir) */
export function intermediatePoint(
  a: LatLng,
  b: LatLng,
  fraction: number,
): LatLng {
  const φ1 = toRad(a.lat)
  const λ1 = toRad(a.lng)
  const φ2 = toRad(b.lat)
  const λ2 = toRad(b.lng)

  const Δ =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((φ2 - φ1) / 2) ** 2 +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
      ),
    )

  if (Δ < 1e-12) return { ...a }

  const A = Math.sin((1 - fraction) * Δ) / Math.sin(Δ)
  const B = Math.sin(fraction * Δ) / Math.sin(Δ)

  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2)
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2)
  const z = A * Math.sin(φ1) + B * Math.sin(φ2)

  return {
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lng: toDeg(Math.atan2(y, x)),
  }
}

export function lineCoordinates(
  a: LatLng,
  b: LatLng,
  steps = 64,
): [number, number][] {
  const coords: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const p = intermediatePoint(a, b, i / steps)
    coords.push([p.lng, p.lat])
  }
  return coords
}

/**
 * Déplace un point de `eastM` / `northM` mètres (approx. plate pour < ~20 km).
 */
export function offsetMeters(
  origin: LatLng,
  eastM: number,
  northM: number,
): LatLng {
  const dLat = northM / EARTH_RADIUS_M
  const dLng = eastM / (EARTH_RADIUS_M * Math.cos(toRad(origin.lat)))
  return {
    lat: origin.lat + toDeg(dLat),
    lng: origin.lng + toDeg(dLng),
  }
}

/** Convertit (x avant, z droite) en lat/lng depuis la pièce, azimut en °. */
export function gunFrameToLatLng(
  gun: LatLng,
  azimuthDeg: number,
  xM: number,
  zM: number,
): LatLng {
  const az = toRad(azimuthDeg)
  // Avant : E = sin(az), N = cos(az) ; Droite : E = cos(az), N = -sin(az)
  const east = xM * Math.sin(az) + zM * Math.cos(az)
  const north = xM * Math.cos(az) - zM * Math.sin(az)
  return offsetMeters(gun, east, north)
}

/** Ellipse en GeoJSON (ring) dans le repère pièce. */
export function ellipseRing(
  gun: LatLng,
  azimuthDeg: number,
  centerX: number,
  centerZ: number,
  semiRangeM: number,
  semiDeflM: number,
  steps = 48,
): [number, number][] {
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const lx = centerX + semiRangeM * Math.cos(a)
    const lz = centerZ + semiDeflM * Math.sin(a)
    const p = gunFrameToLatLng(gun, azimuthDeg, lx, lz)
    ring.push([p.lng, p.lat])
  }
  return ring
}
