import type {
  AirCannonConfig,
  FireMode,
  FireMission,
  TrajectoryPoint,
  WindConfig,
} from './ballistics'
import type { MapMarker } from '../types'

/** Instantané partageable d'une session de tir */
export type MissionPayload = {
  fireMode: FireMode
  wind: WindConfig
  cannon: AirCannonConfig
  markers: MapMarker[]
  gunId: string | null
  targetId: string | null
  observerId: string | null
  /** Résumé mission au moment de la sauvegarde */
  missionSummary: {
    inRange: boolean
    pressureBar: number
    elevationDeg: number
    aimAzimuthDeg: number
    tofS: number
    muzzleVelocity: number
    impactSpeed: number
    driftM: number
    rangeM: number
    order: string
  } | null
  /** Trajectoire échantillonnée (pour relecture rapide) */
  trajectory: TrajectoryPoint[]
  note: string
}

export type SavedMission = {
  id: string
  title: string
  author: string
  createdAt: string
  source: 'local' | 'cloud'
  payload: MissionPayload
}

export function buildPayload(input: {
  fireMode: FireMode
  wind: WindConfig
  cannon: AirCannonConfig
  markers: MapMarker[]
  gunId: string | null
  targetId: string | null
  observerId: string | null
  mission: FireMission | null
  rangeM: number
  note: string
}): MissionPayload {
  const m = input.mission
  return {
    fireMode: input.fireMode,
    wind: input.wind,
    cannon: input.cannon,
    markers: input.markers,
    gunId: input.gunId,
    targetId: input.targetId,
    observerId: input.observerId,
    missionSummary: m
      ? {
          inRange: m.inRange,
          pressureBar: m.pressureBar,
          elevationDeg: m.elevationDeg,
          aimAzimuthDeg: m.aimAzimuthDeg,
          tofS: m.tofS,
          muzzleVelocity: m.muzzleVelocity,
          impactSpeed: m.impactSpeed,
          driftM: m.driftM,
          rangeM: input.rangeM,
          order: m.order,
        }
      : null,
    trajectory: m?.inRange ? m.traj.points : [],
    note: input.note.trim(),
  }
}

const LOCAL_KEY = 'firegrid.missions.v1'
const AUTHOR_KEY = 'firegrid.author'

export function getAuthorName(): string {
  return localStorage.getItem(AUTHOR_KEY)?.trim() || 'anonyme'
}

export function setAuthorName(name: string) {
  localStorage.setItem(AUTHOR_KEY, name.trim() || 'anonyme')
}

function readLocal(): SavedMission[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedMission[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocal(list: SavedMission[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list))
}

export function listLocalMissions(): SavedMission[] {
  return readLocal().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function saveLocalMission(
  title: string,
  payload: MissionPayload,
): SavedMission {
  const item: SavedMission = {
    id: crypto.randomUUID(),
    title: title.trim() || `Mission ${new Date().toLocaleString('fr-FR')}`,
    author: getAuthorName(),
    createdAt: new Date().toISOString(),
    source: 'local',
    payload,
  }
  const list = readLocal()
  list.unshift(item)
  writeLocal(list.slice(0, 100))
  return item
}

export function deleteLocalMission(id: string) {
  writeLocal(readLocal().filter((m) => m.id !== id))
}

export function isCloudConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  )
}

async function getSupabase() {
  if (!isCloudConfigured()) return null
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(
    import.meta.env.VITE_SUPABASE_URL as string,
    import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  )
}

type CloudRow = {
  id: string
  title: string
  author: string
  created_at: string
  payload: MissionPayload
}

export async function listCloudMissions(): Promise<SavedMission[]> {
  const sb = await getSupabase()
  if (!sb) return []
  const { data, error } = await sb
    .from('missions')
    .select('id,title,author,created_at,payload')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return ((data as CloudRow[]) ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    createdAt: row.created_at,
    source: 'cloud' as const,
    payload: row.payload,
  }))
}

export async function saveCloudMission(
  title: string,
  payload: MissionPayload,
): Promise<SavedMission> {
  const sb = await getSupabase()
  if (!sb) throw new Error('Cloud non configuré (variables Supabase manquantes)')
  const row = {
    title: title.trim() || `Mission ${new Date().toLocaleString('fr-FR')}`,
    author: getAuthorName(),
    payload,
  }
  const { data, error } = await sb
    .from('missions')
    .insert(row)
    .select('id,title,author,created_at,payload')
    .single()
  if (error) throw new Error(error.message)
  const r = data as CloudRow
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    createdAt: r.created_at,
    source: 'cloud',
    payload: r.payload,
  }
}

export async function deleteCloudMission(id: string): Promise<void> {
  const sb = await getSupabase()
  if (!sb) throw new Error('Cloud non configuré')
  const { error } = await sb.from('missions').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listAllMissions(): Promise<SavedMission[]> {
  const local = listLocalMissions()
  let cloud: SavedMission[] = []
  if (isCloudConfigured()) {
    try {
      cloud = await listCloudMissions()
    } catch {
      cloud = []
    }
  }
  return [...cloud, ...local].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}
