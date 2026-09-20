# FIRE GRID — Canon pneumatique HP 50 mm

Carte + **poste de tir FDC** pour propulseur pneumatique haute pression (calibre 50 mm, ogive 50 g, **25 bar max**).

## Specs validées

| Élément | Valeur |
|--------|--------|
| Pression de travail | **25 bar max** (régulateur HPA) |
| Chambre / réservoir | Bouteille HPA alu/fibre **0,8 L** — **métal uniquement**, pas de PVC |
| Déclenchement | Vanne piston / haut débit |
| Tube | Acier ou aluminium **1,20–1,50 m** |
| Obus | 50 g, Ø 50 mm, ogive pointue, CG avancé |

## Capacités FDC

1. Placez pièce + cible
2. Choisissez **Tir direct (infanterie)** ou **Tir en cloche (artillerie)**
3. Le logiciel calcule automatiquement pression, élévation, azimut, ToF, zones…
4. Visu 3D + ellipses sur la carte
5. **Sauvegardes** locales + **cloud partagé** (tous les utilisateurs)

### Logique des modes

| Mode | Branche | Pression |
|------|---------|----------|
| Tir direct | basse (tendue) | **max disponible** → trajectoire la plus plate |
| Tir en cloche | haute (plongeante) | calée pour **~55°** d’élévation |

## Lancer

```bash
npm install
npm run dev
```

## Sauvegardes partagées (tous les utilisateurs)

1. Créez un projet gratuit sur [Supabase](https://supabase.com)
2. SQL Editor → exécutez `supabase/schema.sql`
3. Settings → API → copiez **Project URL** et **anon public** key
4. Créez `.env` à partir de `.env.example` :

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

5. Relancez `npm run dev`

Dans le panneau **Sauvegardes** :
- **Sauver local** → cet appareil seulement
- **Sauver cloud (tous)** → visible par tous les utilisateurs de l’app
- **Charger** restaure marqueurs, vent, mode, matériel

Sans `.env`, le cloud est inactif ; le local fonctionne quand même.

## GitHub + hébergement

Repo : https://github.com/YTFeez/artillerie-map  
Site : https://ytfeez.github.io/artillerie-map/

Le workflow `.github/workflows/deploy-pages.yml` build Vite et publie `dist` sur GitHub Pages à chaque push sur `master`.

```bash
git push -u origin master
```

Variables cloud (optionnel) : ajoutez `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans **Settings → Secrets and variables → Actions**, puis adaptez le workflow si besoin.