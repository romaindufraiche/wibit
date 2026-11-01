# Parkcraft — configurateur 3D de parcs aquatiques gonflables (MVP)

> Nom de travail neutre (défini dans `src/brand.ts`), pas une appellation officielle de la marque.

Outil web de conception de parcs aquatiques gonflables, construit sur le catalogue **Wibit**, inspiré de Boaz Create :
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

Puis ouvrir l'URL affichée (par défaut http://localhost:5173). Pour les comptes et l'enregistrement
en ligne, lancer aussi l'API dans un second terminal :

```bash
npm run dev:api
```

Production : `npm run build` puis `npm start` (serveur Node : site + API). Sans `DATABASE_URL`,
les comptes et parcs sont stockés dans `data/db.json` ; avec `DATABASE_URL`, dans PostgreSQL.
Définir `SESSION_SECRET` (chaîne aléatoire) en production. Tests : `npm test`.

Administration : les comptes dont l'e-mail figure dans `ADMIN_EMAILS` (liste séparée par des virgules)
deviennent administrateurs à leur prochaine connexion ; l'interface est sur `/admin`.
Données de démonstration (comptes fictifs `@demo.parkcraft.fr`, société suffixée « (démo) ») :

```bash
npm run seed:demo
```

Ajouter `-- --reset` pour supprimer d'abord les comptes de démonstration existants.

## Fonctionnalités

| Fonction | Détail |
| --- | --- |
| Catalogue | 88 modules Wibit (Fun, MatchTrack, WatchLine, Technique, Autonomes) avec dimensions, hauteur et profondeur officielles, vignettes 3D, recherche et filtres. |
| Scène 3D | Plan d'eau paramétrable (longueur, largeur, profondeur), plage de sable texturée, berge immergée, écume, pelouse, ciel, ombres, grille, ligne de sécurité 3 m. |
| Site réel | « Partir de mon site réel » (fenêtre de démarrage ou panneau Plan d'eau) : recherche d'adresse ou de lac, navigation libre sur carte satellite, point posé à l'endroit du parc. Le contour réel du plan d'eau est détecté (OpenStreetMap / Overpass, ou contour du lac trouvé par la recherche) ou dessiné à la main ; la zone de travail est orientée sur la berge la plus proche, géoréférencée (plan d'ancrage GPS exact) et le terrain 3D est texturé avec la photo satellite. |
| Rivage remodelable | Clic sur la plage (ou touche B) : glisser les points du rivage, en ajouter / supprimer ; crique, avancée de terre, berge irrégulière. Règles, générateur et stylo respectent le nouveau contour. |
| Édition | Glisser-déposer depuis le catalogue, clic = accrocher au module sélectionné, aimantation des connexions (Alt pour désactiver), rotation R / Maj+R, Ctrl+D, Suppr, flèches, multi-sélection Maj+clic, annuler / rétablir. |
| Contrôle des règles | 15 règles (chevauchement, distance au bord, profondeur, zones de glisse, anti-coincement, accès, transitions de hauteur, enchaînements, surveillance, public…) — cliquer sur une alerte sélectionne les modules concernés. |
| Devis | Total HT, capacité, emprise, nomenclature, produits à prévoir (ancrages, bouées, gilets, bateau). |
| Générateur | Parc cohérent selon public, capacité, intensité, boucle InfinityLoop, grand toboggan, modules autonomes. Déterministe par graine. |
| Stylo main levée | Bouton « Stylo » (touche P) : le tracé est redressé et interprété (ligne droite, segments avec virages à 45° / 90°, arcs, boucle fermée), puis rempli de modules alignés et réellement connectés, selon les règles du générateur. Commencer près d'une connexion libre prolonge un parc existant. Annulable en un Ctrl+Z. |
| Budget | Budget maximum dans le générateur (produits à prévoir inclus). |
| Mon parc & saison | Stock de modules possédés (import .json / .csv « module ; quantité » ou parc affiché) ; « Agrandir le parc affiché » avec un budget (ex. +50 000 €) ; « Nouvelle composition avec mon stock ». |
| Plan d'ancrage | Position GPS + azimut du large ; export GPX (GPS Garmin, traceurs, Navionics, OsmAnd), KML (Google Earth, téléphone), CSV et plan imprimable. Ancres numérotées dans l'ordre de pose (tournée en bateau). |
| Mode Play | Baigneurs animés (parcours, pauses, trampolines, sauts, toboggans, nage, groupes d'amis), fréquentation 10–100 % de la capacité, caméra cinématique ou libre. |
| Comptes | Fenêtre de connexion à l'ouverture (ou « Continuer sans compte »), inscription avec société et téléphone, « Mes parcs » enregistrés en ligne, import d'un parc existant. |
| Demande de devis | Bouton « Demander un devis » : le parc est enregistré dans le compte du client et transmis à l'équipe commerciale avec son message. |
| Administration (`/admin`) | Tableau de bord d'activité (clients actifs, projets, parcours client, modules les plus utilisés), **À relancer** (clients engagés dont le projet n'a pas abouti, classés par priorité, avec les blocages probables et un message de relance pré-rédigé), comptes (fiche, notes, rôle, désactivation, chronologie d'activité), projets & devis (statut, édition dans l'outil, devis éditable et imprimable), réglages du catalogue (prix, capacité, ancrages, modules masqués). |
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
