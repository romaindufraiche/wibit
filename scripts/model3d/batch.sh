#!/bin/bash
# finition texturée + compression de tous les modules reconstruits, puis liste des modèles de l'application
S=${S:-$(cd "$(dirname "$0")" && pwd)/work-env}  # dossier de travail (work/, baked/, venv, gltf)
OUT=$(cd "$(dirname "$0")/../.." && pwd)/public/models
G=${GLTF_TRANSFORM:-npx -y @gltf-transform/cli@4}
cd "$(dirname "$0")"
$S/venv/bin/python -I bake.py $S/work $S/baked "$@" 2>&1 | grep -v -i warn | grep -v inclinaison
for f in $S/baked/*.glb; do
  id=$(basename $f .glb)
  [ $# -gt 0 ] && [[ ! " $* " =~ " $id " ]] && continue
  $G optimize $f $OUT/$id.glb --compress meshopt --texture-compress webp --texture-size 1024 >/dev/null 2>&1 || echo "compression $id : échec"
done
OUT=$OUT python3 - <<'PY'
import json, os
out = os.environ.get('OUT', 'public/models')
m = {f[:-4]: {'file': f, 'source': 'TripoSR + texture projetée'} for f in sorted(os.listdir(out)) if f.endswith('.glb')}
json.dump(m, open(f'{out}/index.json', 'w'), indent=1)
print(len(m), 'modèles,', round(sum(os.path.getsize(f'{out}/{f}') for f in os.listdir(out)) / 1e6, 1), 'Mo')
PY
