import type { LatLng } from './lib/geo'

export type MarkerRole = 'gun' | 'target' | 'observer' | 'custom'

export type MapMarker = {
  id: string
  role: MarkerRole
  name: string
  position: LatLng
  /** Altitude MSL en mètres (saisie manuelle) */
  altM: number
  color: string
}

export type PlaceMode = MarkerRole | null

export type MapLayerId = 'satellite' | 'hybrid' | 'topo' | 'streets'

export const ROLE_META: Record<
  MarkerRole,
  { label: string; short: string; color: string; defaultName: string }
> = {
  gun: {
    label: 'Pièce / batterie',
    short: 'PCE',
    color: '#4f7a5a',
    defaultName: 'Pièce',
  },
  target: {
    label: 'Cible',
    short: 'CBL',
    color: '#8f4a42',
    defaultName: 'Cible',
  },
  observer: {
    label: 'Observateur (FO)',
    short: 'FO',
    color: '#5a7380',
    defaultName: 'Observateur',
  },
  custom: {
    label: 'Repère',
    short: 'REP',
    color: '#8a7a48',
    defaultName: 'Repère',
  },
}

export function createMarker(
  role: MarkerRole,
  position: LatLng,
  index: number,
): MapMarker {
  const meta = ROLE_META[role]
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    name: `${meta.defaultName} ${index}`,
    position,
    altM: 0,
    color: meta.color,
  }
}
