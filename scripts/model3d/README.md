# Modèles 3D des modules : conversion 2D → 3D (TripoSR)

Chaque module du catalogue a un rendu produit officiel (`src/catalog/references.json`, généré par
`npm run refs:wibit`). Ce dossier convertit ces images en modèles 3D (GLB) avec
[TripoSR](https://github.com/VAST-AI-Research/TripoSR) (licence MIT, fonctionne sur CPU), puis :

- détoure et cadre l'objet (fond transparent ou blanc retiré) ;
- retire les fragments isolés, simplifie le maillage (~7 000 faces) ;
- aligne l'emprise sur les axes (longueur du module sur x), pose le modèle à la ligne d'eau ;
- recolore chaque sommet dans la palette officielle Wibit (jaune, vert, bleu, rouge, blanc, gris),
  sans l'ombrage cuit dans la photo (`palette.py` retrouve ces teintes à partir des rendus) ;
- écrit `<id>.glb` : à copier dans `public/models/` et à déclarer dans `public/models/index.json`
  (`{"guardtower": {"file": "guardtower.glb"}, …}`) ; l'application les charge à la place du rendu procédural.

```bash
git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR scripts/model3d/TripoSR
python3 -m venv .venv-3d
.venv-3d/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv-3d/bin/pip install "transformers<5" einops omegaconf trimesh pillow huggingface-hub scikit-image scipy fast-simplification
# rendus officiels -> renders/<id>.png (liste : src/catalog/references.json)
.venv-3d/bin/python scripts/model3d/convert_triposr.py renders out guardtower actiontower-xl
```

`torchmcubes` (à compiler) est remplacé par le marching cubes de scikit-image (`shim/`).
Les poids (`stabilityai/TripoSR`, ~1,7 Go) sont téléchargés depuis Hugging Face au premier lancement.
Sur 4 cœurs CPU, compter environ 1 à 3 minutes par module.
