# Modèles 3D des modules : conversion 2D → 3D

Chaque module du catalogue a un rendu produit officiel (`src/catalog/references.json`, généré par
`npm run refs:wibit`). Ces images sont converties en modèles 3D texturés (GLB) en deux étapes.

**1. Reconstruction** (`infer.py`) : [TripoSR](https://github.com/VAST-AI-Research/TripoSR)
(licence MIT, CPU) reconstruit la forme à partir du rendu détouré ; le maillage brut est gardé
(`work/raw/<id>.ply`) pour pouvoir refaire la finition sans relancer le réseau (~25 s par module sur 4 cœurs).

**2. Finition et texture** (`bake.py`, ~10 s par module) :
- surface reconstruite proprement : voxelisation pleine, ouverture et fermeture morphologiques (voiles,
  lambeaux et artefacts internes supprimés), isosurface d'un champ légèrement lissé, simplification à
  30 000 faces, puis filtrage bilatéral des normales (faces planes vraiment planes, arêtes et plis nets) ;
- dépliage UV (xatlas) et texture peinte en 2048 puis réduite en 1024 (bords anticrénelés) en projetant le rendu officiel depuis la caméra
  d'entrée de TripoSR (logos, prises, cordes, numéros), avec un test de visibilité ; les faces cachées
  prennent les couleurs reconstruites, fortement lissées ;
- toutes les couleurs ramenées à la palette officielle Wibit (jaune, vert, bleu, rouge, blanc, gris, noir) :
  fond en jaune / vert / bleu aux contours adoucis, détails (logos, prises, numéros) posés par-dessus et
  gardés nets ; reflets de la photo ramenés à leur teinte ; faces cachées en aplats des trois teintes
  principales ; petites taches absorbées par leur entourage ; plaques rouges denses (texte fondu) retirées ;
- assise plate à la ligne d'eau (4 % inférieurs aplanis) ;
- inclinaison de la prise de vue corrigée (~30°), emprise alignée sur les axes, face documentée tournée
  vers l'avant, posé à la ligne d'eau.

`finish.py` est la variante sans texture (couleurs par sommet). `batch.sh` enchaîne finition, compression
(glTF-Transform : géométrie meshopt, textures WebP, ~200 Ko par module) et la liste `public/models/index.json`.
Dans l'application, chaque modèle est mis exactement aux dimensions officielles du module (longueur, largeur, hauteur).

```bash
git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR scripts/model3d/TripoSR
python3 -m venv .venv-3d
.venv-3d/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv-3d/bin/pip install "transformers<5" einops omegaconf trimesh pillow huggingface-hub scikit-image scipy fast-simplification xatlas imageio
# rendus officiels -> renders/<id>.png (liste : src/catalog/references.json)
.venv-3d/bin/python scripts/model3d/infer.py renders work            # [id ...] pour quelques modules
.venv-3d/bin/python scripts/model3d/bake.py work public/models        # puis déclarer les GLB dans public/models/index.json
```

`torchmcubes` (à compiler) et `rembg` (inutile, rendus déjà détourés) sont remplacés par `shim/`.
Les poids (`stabilityai/TripoSR`, ~1,7 Go) sont téléchargés depuis Hugging Face au premier lancement.
