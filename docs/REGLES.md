# Règles de conception d'un parc Wibit — proposition v0.1

Ce document décrit les règles utilisées par **Parkcraft** pour :

1. **contrôler** un parc dessiné à la main (panneau « Contrôle des règles ») ;
2. **générer** automatiquement un parc aléatoire **cohérent** (bouton 🎲).

Ce sont des **hypothèses de travail** établies à partir du catalogue public Wibit
(dimensions, profondeurs, descriptions), de la notice de sécurité de Boaz Create
(norme EN ISO 25649) et des pratiques courantes des parcs gonflables. Elles sont
toutes paramétrables dans `src/rules/validate.ts` (objet `RULES`) et doivent être
validées avec Wibit.

## 1. Modèle de données

### Connecteurs (ports)

Chaque module a des **points de connexion** sur ses bords, avec une direction sortante :

| Type de module | Connexions | Exemples |
| --- | --- | --- |
| Traversant | 2, aux deux extrémités | Slide, Cliff, MonkeyBars, BalanceBeam… |
| Accès | 1 (côté parc) ou 2 | Step, Step 6, StartGate SUS, LaunchGate, Base |
| Fin de parcours | 1, sortie vers l'eau | Slope, ActionLoop, Wave, Mountain, Springboard, EndRise, TakeOff |
| Jonction | 3 ou 4 | Junction (4), T-Connect SUS (3), Y-Connect (3, à 45°), Trampoline 4, RoundAbout |
| Virage 90° | 2, sur deux côtés adjacents | Bend, Curve, Turn SUS, CornerSwing, L/R-Connect SUS, SideKick, SwingAround |
| Autonome | 0 | Volley, Bouncer XXL, IceTower XXL, MultiClimb… |

Deux modules sont **connectés** lorsque deux de leurs ports sont confondus (< 15 cm)
et opposés. Les connexions ne sont donc jamais « stockées » : elles se déduisent de la
géométrie, ce qui rend l'aimantation et la validation robustes.

### Zones d'eau libre

Les toboggans et modules de saut déclarent des **zones qui doivent rester en eau libre** :
sortie de glisse (orange) ou réception de saut (rose). Exemples : 4 m devant un Slope,
8 m devant une Wave ou une Mountain, 3–4 m de chaque côté d'un Swing / HighBars.

### Rôles (grammaire)

`entry` (accès) · `connector` (jonction / virage / plateforme de repos) · `obstacle` ·
`tower` (≥ 2,4 m) · `terminal` (fin de parcours) · `watch` (surveillance) · `standalone`.

## 2. Règles de contrôle

| ID | Niveau | Règle | Paramètre |
| --- | --- | --- | --- |
| R01 | Erreur | Deux modules ne se chevauchent pas. | — |
| R02 | Erreur | Tout module est à ≥ 3 m du rivage et des bords du plan d'eau. | `edgeMargin = 3` |
| R03 | Erreur | La profondeur du site est ≥ la profondeur minimale du module (catalogue Wibit). | — |
| R04 | Erreur | Les zones de glisse / réception sont dans le plan d'eau et vides de tout module. | — |
| R05 | Erreur | Deux modules **non reliés** sont espacés d'au moins 1,5 m (risque de coincement). Les modules reliés au même connecteur sont exemptés. | `minGap = 1.5` |
| R06 | Alerte | Deux ports proches (< 90 cm) mais non alignés : connexion mal posée. | `misalignTol = 0.9` |
| R07 | Erreur | Un module modulaire n'est jamais isolé (sauf modules autonomes). | — |
| R08 | Erreur | Chaque îlot de modules possède au moins un accès (Base, Step, StartGate ou module SUS). | — |
| R09 | Alerte | Deux obstacles reliés n'ont pas plus de 1,5 m d'écart de hauteur : sinon insérer une Junction / plateforme. | `maxHeightStep = 1.5` |
| R10 | Alerte | Pas plus de 4 obstacles enchaînés sans plateforme de repos, ni plus de 2 obstacles « experts » (difficulté ≥ 4) d'affilée. | `maxRun = 4`, `maxExpertRun = 2` |
| R11 | Alerte | 1 poste de surveillance par 50 baigneurs, et chaque module à ≤ 25 m d'un poste. | `usersPerWatch = 50`, `watchRadius = 25` |
| R12 | Alerte | Profil public : Enfants ≤ 2 m de haut et difficulté ≤ 2 ; Famille ≤ 3,5 m et difficulté ≤ 4. | `AUDIENCE_LIMITS` |
| R13 | Info | Extrémité libre sur un obstacle : terminer par un TakeOff, un Slope ou un module de fin. | — |
| R14 | Info | Au-delà de 60 places, une boucle InfinityLoop est recommandée (pas de goulet). | `loopAdvisedFrom = 60` |
| R15 | Alerte | 1 accès pour 40 baigneurs. | `usersPerAccess = 40` |

## 3. Règles de génération (bouton 🎲)

Le générateur fait **pousser** le parc comme un graphe, module par module, en vérifiant
toutes les règles ci-dessus à chaque pose. Grammaire :

```
Parc      := Accès [Boucle] Parcours Branches* Surveillance Accès* [Autonomes]
Parcours  := ( Obstacle{1..maxRun} Connecteur )* Fin
Branche   := port libre d'un connecteur → Obstacle{0..3} Fin
Boucle    := T-Connect → A → Virage → M → Virage → Bas(avec Junction) → Virage → M → Virage → B → T
```

1. **Accès sur le rivage** : StartGate SUS / Step 6 pour les grands parcs, Base SUS pour
   les enfants, LaunchGate pour le sportif. Orienté vers le large.
2. **Boucle InfinityLoop** (option) : rectangle fermé dont les côtés opposés ont la même
   longueur (modules de 3 / 6 m), accroché par un T-Connect SUS. La Junction du côté opposé
   sert de départ au parcours principal → pas de cul-de-sac, flux continu.
3. **Parcours principal** : alternance obstacles / connecteurs.
   - après au plus `maxRun` obstacles (3, ou 4 si intensité ≥ 4) → **connecteur obligatoire** ;
   - après une **tour** (≥ 2,4 m) → connecteur obligatoire ;
   - transition de hauteur > 1,5 m interdite entre deux obstacles ;
   - pas plus de 2 obstacles experts d'affilée ;
   - les virages / jonctions sont favorisés quand l'eau libre devant est < 12 m
     (le parc « serpente » au lieu de partir en ligne droite) ;
   - choix pondérés : proximité de la difficulté visée, **nouveauté** (un module déjà
     posé est pénalisé, le même module deux fois de suite quasi exclu), MatchTrack favorisé
     en profil sportif.
4. **Fins de parcours** : uniquement des modules `terminal` (Slope, TakeOff, ActionLoop,
   Springboard, Wave, Mountain, EndRise). **Rien ne peut être posé après un toboggan** :
   ces modules n'ont qu'une connexion, et leur zone de sortie doit être libre.
   Le grand toboggan demandé (Wave / Mountain / ActionLoop) est fortement prioritaire.
5. **Branches** : les ports libres des jonctions sont développés en courtes branches
   (1 à 4 modules + fin) jusqu'à atteindre la capacité visée.
6. **Culs-de-sac** : les extrémités libres d'obstacles reçoivent un Slope / TakeOff.
7. **Surveillance & accès** : postes (WatchSpot, WatchTopper, WatchRaft, Deck3, GuardTower)
   accrochés aux connecteurs les plus éloignés des postes existants ; Steps ajoutés sur les
   jonctions pour atteindre 1 accès / 40 baigneurs.
8. **Autonomes** (option) : 1 à 3 modules (Volley, Bouncer XXL, IceTower…) à distance du parc.
9. **Sélection** : 14 variantes sont générées à partir de la graine ; la meilleure est
   retenue selon un score (erreurs ≫ alertes ≫ écart à la capacité, variété, boucle et
   grand toboggan présents). Même graine ⇒ même parc (partageable).

## 4. Stylo main levée

Le tracé est rééchantillonné tous les 1 m et lissé. Le parcours démarre sur un port libre
situé à moins de 4 m du début du tracé (prolongement d'un parc), sinon sur un accès posé et
orienté selon le tracé. À chaque pas, parmi les modules autorisés par la grammaire
(section 3, mêmes contraintes d'enchaînement et de hauteur), on garde celui dont la sortie
colle le mieux au tracé : écart au tracé, écart du centre du module, alignement avec la
tangente, avancée le long du tracé, variété. En cas d'impasse, retour arrière (jusqu'à 6
fois). Le parcours se termine par un module de fin à moins de 3,5 m du bout du tracé, et
des postes de surveillance sont ajoutés si la capacité l'exige.

## 5. Points à valider avec Wibit

- Capacité réelle par module (utilisée pour le dimensionnement) — **estimée** aujourd'hui.
- Grille tarifaire, nombre d'ancrages par module, longueur de la ligne de bouées.
- Côtés réellement connectables de chaque module (largeur des sangles, modules à 4 côtés).
- Distances de sécurité exactes (sortie de toboggan, zones de saut, distance au bord).
- Règles d'enchaînement maison (ex. « jamais deux tours consécutives », ratio surveillance).
- Profils d'âge / taille par module.
