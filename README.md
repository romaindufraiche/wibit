# Wibit Create — configurateur 3D de parcs aquatiques gonflables (MVP)

Outil web de conception de parcs aquatiques gonflables **Wibit**, inspiré de Boaz Create :
catalogue de modules en 3D, assemblage par aimantation, devis estimatif en temps réel,
contrôle des règles de sécurité et — **fonction différenciante** — un générateur de
**parcs aléatoires cohérents** (🎲).

> MVP de démonstration destiné à être présenté à Wibit Sports. Les modèles 3D sont des
> reconstructions procédurales à partir des dimensions du catalogue public ; prix,
> capacités et ancrages sont des estimations. Après accord, on branchera les fichiers 3D
> et la grille tarifaire officiels.

## Démarrer

```bash
npm install
```

```bash
npm run dev
```

Puis ouvrir l'URL affichée (par défaut http://localhost:5173). Build de production : `npm run build`
(site statique dans `dist/`, hébergeable n'importe où). Tests : `npm test`.

## Fonctionnalités

| Fonction | Détail |
| --- | --- |
| Catalogue | 88 modules Wibit (Fun, MatchTrack, WatchLine, Technique, Autonomes) avec dimensions, hauteur et profondeur officielles, vignettes 3D, recherche et filtres. |
| Scène 3D | Plan d'eau paramétrable (longueur, largeur, profondeur), plage, ciel, ombres, grille, ligne de sécurité 3 m. |
| Édition | Glisser-déposer depuis le catalogue, clic = accrocher au module sélectionné, aimantation des connexions (Alt pour désactiver), rotation R / Maj+R, Ctrl+D, Suppr, flèches, multi-sélection Maj+clic, annuler / rétablir. |
| Contrôle des règles | 15 règles (chevauchement, distance au bord, profondeur, zones de glisse, anti-coincement, accès, transitions de hauteur, enchaînements, surveillance, public…) — cliquer sur une alerte sélectionne les modules concernés. |
| Devis | Total HT, capacité, emprise, nomenclature, produits à prévoir (ancrages, bouées, gilets, bateau). |
| 🎲 Générateur | Parc cohérent selon public, capacité, intensité, boucle InfinityLoop, grand toboggan, modules autonomes. Déterministe par graine. |
| ✏️ Stylo main levée | Bouton « Stylo » (touche P) : tracez un parcours sur l'eau, au relâchement les modules se posent le long du tracé en respectant toutes les règles (virages, jonctions, enchaînements, fin de parcours). Commencer près d'une connexion libre prolonge un parc existant. Annulable en un Ctrl+Z. |
| Modèles de parcs | Kids Lagoon, Family Beach, AquaTrack, SportsPark XL, Lake Resort. |
| Exports | Devis PDF (impression), liste Excel (CSV), projet JSON, capture PNG, lien de partage (projet encodé dans l'URL). Sauvegarde automatique dans le navigateur. |

## Architecture

```
src/
  catalog/modules.ts     catalogue Wibit : dimensions, ports de connexion, zones d'eau libre, estimations
  core/                  géométrie 2D (rotation, OBB, aimantation), graphe de connexions
  rules/validate.ts      moteur de règles R01–R15 + statistiques / devis
  generator/             générateur de parcs (grammaire + retour arrière + sélection par score)
  models/builders.ts     modèles 3D procéduraux (three.js) — à remplacer par les glTF Wibit
  scene/                 viewport 3D (interaction, surcouches), vignettes du catalogue
  editor/store.ts        état, sélection, historique
  ui/, io/               panneaux, dialogues, exports
docs/REGLES.md           règles de conception proposées (à valider avec Wibit)
```

Le moteur (catalogue, règles, générateur) n'a **aucune dépendance à three.js** : il est
testable en Node et réutilisable côté serveur.

### Brancher les vrais modèles 3D

`buildModel(spec)` dans `src/models/builders.ts` est le seul point d'entrée : il suffira
d'y charger un glTF par `spec.id` (GLTFLoader) en conservant le repère
(x = longueur, z = largeur, y = hauteur, ligne d'eau en y = 0).
