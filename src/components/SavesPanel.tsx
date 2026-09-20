import { useEffect, useState } from 'react'
import type { FireMission, FireMode, AirCannonConfig, WindConfig } from '../lib/ballistics'
import {
  buildPayload,
  deleteCloudMission,
  deleteLocalMission,
  getAuthorName,
  isCloudConfigured,
  listAllMissions,
  saveCloudMission,
  saveLocalMission,
  setAuthorName,
  type MissionPayload,
  type SavedMission,
} from '../lib/saves'
import type { MapMarker } from '../types'
import { formatDistance } from '../lib/geo'

type Props = {
  fireMode: FireMode
  wind: WindConfig
  cannon: AirCannonConfig
  markers: MapMarker[]
  gunId: string | null
  targetId: string | null
  observerId: string | null
  mission: FireMission | null
  rangeM: number
  onLoad: (payload: MissionPayload) => void
}

export function SavesPanel({
  fireMode,
  wind,
  cannon,
  markers,
  gunId,
  targetId,
  observerId,
  mission,
  rangeM,
  onLoad,
}: Props) {
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [author, setAuthor] = useState(getAuthorName)
  const [list, setList] = useState<SavedMission[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'local' | 'cloud'>('all')
  const cloudOk = isCloudConfigured()

  const refresh = async () => {
    setError(null)
    try {
      const all = await listAllMissions()
      setList(all)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur chargement')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const payload = () =>
    buildPayload({
      fireMode,
      wind,
      cannon,
      markers,
      gunId,
      targetId,
      observerId,
      mission,
      rangeM,
      note,
    })

  const onSaveLocal = () => {
    setAuthorName(author)
    saveLocalMission(title, payload())
    setTitle('')
    void refresh()
  }

  const onSaveCloud = async () => {
    if (!cloudOk) {
      setError('Configurez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY')
      return
    }
    setBusy(true)
    setError(null)
    setAuthorName(author)
    try {
      await saveCloudMission(title, payload())
      setTitle('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec sauvegarde cloud')
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (item: SavedMission) => {
    if (!confirm(`Supprimer « ${item.title} » ?`)) return
    setBusy(true)
    setError(null)
    try {
      if (item.source === 'local') deleteLocalMission(item.id)
      else await deleteCloudMission(item.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec suppression')
    } finally {
      setBusy(false)
    }
  }

  const filtered = list.filter((m) => {
    if (tab === 'local') return m.source === 'local'
    if (tab === 'cloud') return m.source === 'cloud'
    return true
  })

  return (
    <section className="panel-section">
      <h2>Sauvegardes</h2>
      <p className="disclaimer">
        Local = cet appareil. Cloud = visible par{' '}
        <strong>tous les utilisateurs</strong> (Supabase).
      </p>

      <label className="field">
        <span>Votre indicatif</span>
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="ex. PCE-1"
        />
      </label>
      <label className="field">
        <span>Titre mission</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="ex. Zone Nord 350 m cloche"
        />
      </label>
      <label className="field">
        <span>Note</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="optionnel"
        />
      </label>

      <div className="save-actions">
        <button type="button" className="tool" onClick={onSaveLocal} disabled={busy}>
          Sauver local
        </button>
        <button
          type="button"
          className="tool is-active"
          onClick={() => void onSaveCloud()}
          disabled={busy || !cloudOk}
          title={cloudOk ? 'Partager à tous' : 'Cloud non configuré'}
        >
          Sauver cloud (tous)
        </button>
      </div>

      {!cloudOk && (
        <p className="disclaimer">
          Cloud inactif — ajoutez un fichier <code>.env</code> (voir README /
          supabase).
        </p>
      )}
      {error && <p className="save-error">{error}</p>}

      <div className="traj3d-tabs" style={{ marginTop: '0.75rem' }}>
        <button
          type="button"
          className={tab === 'all' ? 'is-active' : ''}
          onClick={() => setTab('all')}
        >
          Toutes
        </button>
        <button
          type="button"
          className={tab === 'local' ? 'is-active' : ''}
          onClick={() => setTab('local')}
        >
          Local
        </button>
        <button
          type="button"
          className={tab === 'cloud' ? 'is-active' : ''}
          onClick={() => setTab('cloud')}
        >
          Cloud
        </button>
        <button type="button" className="tool" onClick={() => void refresh()}>
          Rafraîchir
        </button>
      </div>

      <ul className="saves-list">
        {filtered.length === 0 && (
          <li className="empty">Aucune sauvegarde pour l’instant.</li>
        )}
        {filtered.map((item) => {
          const s = item.payload.missionSummary
          return (
            <li key={`${item.source}-${item.id}`} className="save-item">
              <div className="save-item-head">
                <strong>{item.title}</strong>
                <em className={item.source === 'cloud' ? 'cloud' : ''}>
                  {item.source === 'cloud' ? 'CLOUD' : 'LOCAL'}
                </em>
              </div>
              <div className="save-item-meta">
                {item.author} ·{' '}
                {new Date(item.createdAt).toLocaleString('fr-FR')}
                {s && (
                  <>
                    {' '}
                    · {s.inRange ? formatDistance(s.rangeM) : 'hors portée'} ·{' '}
                    {s.pressureBar.toFixed(1)} bar · {s.elevationDeg.toFixed(1)}
                    °
                  </>
                )}
              </div>
              {item.payload.note && (
                <div className="save-item-note">{item.payload.note}</div>
              )}
              <div className="save-item-actions">
                <button
                  type="button"
                  className="tool is-active"
                  onClick={() => onLoad(item.payload)}
                >
                  Charger
                </button>
                <button
                  type="button"
                  className="tool danger"
                  onClick={() => void onDelete(item)}
                >
                  Supprimer
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
