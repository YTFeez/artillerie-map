import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type {
  ImpactZone,
  TrajectoryResult,
  WindConfig,
} from '../lib/ballistics'
import { windInGunFrame } from '../lib/ballistics'
import { degreesToMils } from '../lib/geo'

type Branch = 'low' | 'high'

type Props = {
  traj: TrajectoryResult | null
  zone: ImpactZone | null
  wind: WindConfig
  azimuthDeg: number
  muzzleVelocity: number
  branch: Branch
  onBranch: (b: Branch) => void
  hasHigh: boolean
  targetRangeM: number
  modeLabel?: string
}

function speedColor(speed: number, v0: number): THREE.Color {
  const t = Math.min(1, Math.max(0, speed / Math.max(v0, 1)))
  // bleu (lent) → cyan → jaune → rouge (rapide)
  const c = new THREE.Color()
  if (t < 0.33) c.setRGB(0.15, 0.45 + t * 1.2, 0.95)
  else if (t < 0.66) c.setRGB(0.2 + (t - 0.33) * 2, 0.85, 0.25)
  else c.setRGB(0.95, 0.55 - (t - 0.66) * 0.8, 0.12)
  return c
}

export function Trajectory3D({
  traj,
  zone,
  wind,
  azimuthDeg,
  muzzleVelocity,
  branch,
  onBranch,
  hasHigh,
  targetRangeM,
  modeLabel,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  const hud = useMemo(() => {
    if (!traj?.impact) return null
    const { wx, wz } = windInGunFrame(wind, azimuthDeg)
    return {
      elev: traj.elevationDeg,
      elevMils: degreesToMils(traj.elevationDeg),
      tof: traj.impact.t,
      vImpact: traj.impact.speed,
      apexY: traj.apex?.y ?? 0,
      apexX: traj.apex?.x ?? 0,
      drift: traj.driftM,
      azCorr: traj.azimuthCorrectionDeg,
      azCorrMils: traj.azimuthCorrectionMils,
      ground: traj.groundRangeM,
      wx,
      wz,
    }
  }, [traj, wind, azimuthDeg])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const w = mount.clientWidth || 640
    const h = mount.clientHeight || 280

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x121610)
    scene.fog = new THREE.Fog(0x121610, 80, 900)

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 5000)
    camera.position.set(-40, 55, 90)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.49
    controls.target.set(80, 8, 0)

    scene.add(new THREE.AmbientLight(0xb8c4a8, 0.7))
    const sun = new THREE.DirectionalLight(0xfff2d0, 0.85)
    sun.position.set(-40, 80, 30)
    scene.add(sun)

    const root = new THREE.Group()
    scene.add(root)

    let raf = 0
    const animate = () => {
      raf = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()
    setReady(true)

    const onResize = () => {
      if (!mount) return
      const nw = mount.clientWidth
      const nh = mount.clientHeight
      camera.aspect = nw / Math.max(nh, 1)
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)

    const api = {
      root,
      scene,
      camera,
      controls,
      renderer,
      clearRoot: () => {
        while (root.children.length) {
          const obj = root.children[0]!
          root.remove(obj)
          obj.traverse((c) => {
            if (c instanceof THREE.Mesh || c instanceof THREE.Line) {
              c.geometry?.dispose()
              const mat = c.material
              if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
              else mat?.dispose()
            }
          })
        }
      },
    }

    ;(mount as HTMLDivElement & { __t3d?: typeof api }).__t3d = api

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      delete (mount as HTMLDivElement & { __t3d?: typeof api }).__t3d
    }
  }, [])

  useEffect(() => {
    const mount = mountRef.current as
      | (HTMLDivElement & {
          __t3d?: {
            root: THREE.Group
            controls: OrbitControls
            clearRoot: () => void
          }
        })
      | null
    if (!mount?.__t3d) return
    const { root, controls, clearRoot } = mount.__t3d
    clearRoot()

    // Sol grillagé
    const grid = new THREE.GridHelper(Math.max(200, targetRangeM * 1.4), 28, 0x3a4534, 0x2a3126)
    grid.position.y = 0.02
    root.add(grid)

    // Axes : X avant (ambre), Y haut (vert), Z droite (bleu)
    const axes = new THREE.AxesHelper(Math.max(25, targetRangeM * 0.08))
    root.add(axes)

    // Ligne d'azimut au sol (visée)
    {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.05, 0),
        new THREE.Vector3(Math.max(targetRangeM, 10), 0.05, 0),
      ])
      const line = new THREE.Line(
        geo,
        new THREE.LineDashedMaterial({
          color: 0xc4a035,
          dashSize: 4,
          gapSize: 2,
        }),
      )
      line.computeLineDistances()
      root.add(line)
    }

    // Marqueur pièce
    {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.6, 2.2, 10),
        new THREE.MeshStandardMaterial({ color: 0x3d8b5a }),
      )
      mesh.position.set(0, 1.1, 0)
      root.add(mesh)
    }

    // Cible théorique
    {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.2, 3.2, 24),
        new THREE.MeshBasicMaterial({
          color: 0xc44b3c,
          side: THREE.DoubleSide,
        }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(targetRangeM, 0.08, 0)
      root.add(ring)
    }

    // Vent (flèche masse d'air dans le repère pièce)
    {
      const { wx, wz } = windInGunFrame(wind, azimuthDeg)
      const len = Math.hypot(wx, wz)
      if (len > 0.15) {
        const dir = new THREE.Vector3(wx, 0, wz).normalize()
        const origin = new THREE.Vector3(12, 6, 12)
        const arrow = new THREE.ArrowHelper(
          dir,
          origin,
          8 + len * 1.5,
          0x5eb0e0,
          2.5,
          1.8,
        )
        root.add(arrow)
      }
    }

    if (!traj || traj.points.length < 2) {
      controls.target.set(targetRangeM * 0.4, 10, 0)
      return
    }

    const v0 = Math.max(muzzleVelocity, 1)
    const pts = traj.points

    // Trajectoire colorée par vitesse
    {
      const positions: number[] = []
      const colors: number[] = []
      for (const p of pts) {
        positions.push(p.x, p.y, p.z)
        const c = speedColor(p.speed, v0)
        colors.push(c.r, c.g, c.b)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      )
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          linewidth: 2,
        }),
      )
      root.add(line)

      // Tube fin pour lisibilité
      const curve = new THREE.CatmullRomCurve3(
        pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      )
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.min(200, pts.length * 2), 0.35, 6, false),
        new THREE.MeshStandardMaterial({
          color: 0xe8c547,
          transparent: true,
          opacity: 0.35,
          roughness: 0.6,
        }),
      )
      root.add(tube)
    }

    // Projection sol
    {
      const positions: number[] = []
      for (const p of pts) positions.push(p.x, 0.06, p.z)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      )
      const line = new THREE.Line(
        geo,
        new THREE.LineDashedMaterial({
          color: 0x6a7860,
          dashSize: 3,
          gapSize: 2,
        }),
      )
      line.computeLineDistances()
      root.add(line)
    }

    // Arc d'élévation à la bouche
    {
      const elev = (traj.elevationDeg * Math.PI) / 180
      const R = Math.min(28, Math.max(12, targetRangeM * 0.06))
      const arcPts: THREE.Vector3[] = []
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * elev
        arcPts.push(new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), 0))
      }
      const geo = new THREE.BufferGeometry().setFromPoints(arcPts)
      root.add(
        new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({ color: 0xf0d060 }),
        ),
      )
      // Ligne tube (visée)
      root.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(R * Math.cos(elev), R * Math.sin(elev), 0),
          ]),
          new THREE.LineBasicMaterial({ color: 0xf0d060 }),
        ),
      )
      // Ligne horizon
      root.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(R, 0, 0),
          ]),
          new THREE.LineBasicMaterial({ color: 0x8a9480 }),
        ),
      )
    }

    // Apex
    if (traj.apex) {
      const apex = new THREE.Mesh(
        new THREE.SphereGeometry(1.4, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x5eb0e0, emissive: 0x1a4060 }),
      )
      apex.position.set(traj.apex.x, traj.apex.y, traj.apex.z)
      root.add(apex)
      // Drop line
      root.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(traj.apex.x, traj.apex.y, traj.apex.z),
            new THREE.Vector3(traj.apex.x, 0, traj.apex.z),
          ]),
          new THREE.LineDashedMaterial({
            color: 0x5eb0e0,
            dashSize: 2,
            gapSize: 1.5,
          }),
        ),
      )
    }

    // Impact
    if (traj.impact) {
      const imp = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0xc44b3c, emissive: 0x401010 }),
      )
      imp.position.set(traj.impact.x, 2, traj.impact.z)
      imp.rotation.x = Math.PI
      root.add(imp)

      // Vecteur vitesse d'impact (échelle)
      const dir = new THREE.Vector3(1, -0.4, traj.driftM * 0.002).normalize()
      // Approx from last two points
      if (pts.length >= 2) {
        const a = pts[pts.length - 2]!
        const b = pts[pts.length - 1]!
        dir.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize()
      }
      root.add(
        new THREE.ArrowHelper(
          dir,
          new THREE.Vector3(traj.impact.x, traj.impact.y + 1, traj.impact.z),
          10,
          0xff6644,
          2.2,
          1.4,
        ),
      )
    }

    // Zones d'impact 50 % / 90 %
    if (zone && traj.impact) {
      const makeEllipse = (
        sr: number,
        sd: number,
        color: number,
        opacity: number,
      ) => {
        const shape = new THREE.Shape()
        shape.absellipse(0, 0, sr, sd, 0, Math.PI * 2, false, 0)
        const geo = new THREE.ShapeGeometry(shape, 48)
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(zone.centerX, 0.12, zone.centerZ)
        return mesh
      }
      root.add(makeEllipse(zone.semiRange90M, zone.semiDefl90M, 0xc44b3c, 0.12))
      root.add(makeEllipse(zone.semiRange50M, zone.semiDefl50M, 0xe8c547, 0.22))
    }

    // Balises vitesse le long de la trajectoire
    const nMarks = Math.min(6, Math.floor(pts.length / 8))
    for (let i = 1; i <= nMarks; i++) {
      const idx = Math.floor((i / (nMarks + 1)) * (pts.length - 1))
      const p = pts[idx]!
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 8, 8),
        new THREE.MeshBasicMaterial({ color: speedColor(p.speed, v0) }),
      )
      s.position.set(p.x, p.y, p.z)
      root.add(s)
    }

    const midX = traj.impact?.x ?? targetRangeM
    const midY = Math.max(12, (traj.apex?.y ?? 20) * 0.55)
    controls.target.set(midX * 0.55, midY * 0.35, (traj.impact?.z ?? 0) * 0.5)
  }, [
    traj,
    zone,
    wind,
    azimuthDeg,
    muzzleVelocity,
    targetRangeM,
    ready,
  ])

  return (
    <div className="traj3d">
      <div className="traj3d-bar">
        <div className="traj3d-title">
          <span>VISU 3D · {modeLabel?.toUpperCase() ?? 'TRAJECTOIRE'}</span>
          <em>x avant · y haut · z droite</em>
        </div>
        <div className="traj3d-tabs" role="tablist">
          <button
            type="button"
            className={branch === 'low' ? 'is-active' : ''}
            onClick={() => onBranch('low')}
          >
            Tir direct
          </button>
          <button
            type="button"
            className={branch === 'high' ? 'is-active' : ''}
            onClick={() => onBranch('high')}
            disabled={!hasHigh}
          >
            Tir en cloche
          </button>
        </div>
      </div>

      <div className="traj3d-stage">
        <div ref={mountRef} className="traj3d-canvas" />
        {hud ? (
          <div className="traj3d-hud">
            <div>
              <span>Élévation</span>
              <strong>
                {hud.elev.toFixed(2)}° · {hud.elevMils.toFixed(0)} mil
              </strong>
            </div>
            <div>
              <span>ToF</span>
              <strong>{hud.tof.toFixed(2)} s</strong>
            </div>
            <div>
              <span>v₀ → vᵢ</span>
              <strong>
                {muzzleVelocity.toFixed(0)} → {hud.vImpact.toFixed(0)} m/s
              </strong>
            </div>
            <div>
              <span>Sommet</span>
              <strong>
                {hud.apexY.toFixed(0)} m @ {hud.apexX.toFixed(0)} m
              </strong>
            </div>
            <div>
              <span>Dérive</span>
              <strong>
                {hud.drift >= 0 ? '+' : ''}
                {hud.drift.toFixed(1)} m
              </strong>
            </div>
            <div>
              <span>Corr. azimut</span>
              <strong>
                {hud.azCorr >= 0 ? '+' : ''}
                {hud.azCorr.toFixed(2)}° · {hud.azCorrMils.toFixed(0)} mil
              </strong>
            </div>
            <div>
              <span>Portée sol</span>
              <strong>{hud.ground.toFixed(0)} m</strong>
            </div>
            <div>
              <span>Vent (repère)</span>
              <strong>
                Wx {hud.wx.toFixed(1)} · Wz {hud.wz.toFixed(1)} m/s
              </strong>
            </div>
          </div>
        ) : (
          <div className="traj3d-empty">
            Placez pièce + cible à portée pour afficher la trajectoire 3D.
          </div>
        )}
      </div>

      <div className="traj3d-legend">
        <span>
          <i style={{ background: '#f04430' }} /> rapide
        </span>
        <span>
          <i style={{ background: '#e8c547' }} /> moyen
        </span>
        <span>
          <i style={{ background: '#3a8fd0' }} /> lent / sommet
        </span>
        <span>
          <i style={{ background: '#e8c547', opacity: 0.5 }} /> zone 50 %
        </span>
        <span>
          <i style={{ background: '#c44b3c', opacity: 0.35 }} /> zone 90 %
        </span>
        <span>Orbit : glisser · zoom : molette</span>
      </div>
    </div>
  )
}
