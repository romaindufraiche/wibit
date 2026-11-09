"""Étape 1 : TripoSR une seule fois par module -> raw/<id>.ply (maillage brut + couleurs) et input/<id>.png."""
import os, sys, time
import torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from convert_triposr import TSR, prepare  # noqa: E402

src, dst = sys.argv[1], sys.argv[2]
only = set(sys.argv[3:])
os.makedirs(f'{dst}/raw', exist_ok=True)
os.makedirs(f'{dst}/input', exist_ok=True)
torch.set_num_threads(os.cpu_count())
model = TSR.from_pretrained('stabilityai/TripoSR', config_name='config.yaml', weight_name='model.ckpt')
model.renderer.set_chunk_size(8192)
for f in sorted(os.listdir(src)):
    mid = os.path.splitext(f)[0]
    if (only and mid not in only) or os.path.exists(f'{dst}/raw/{mid}.ply'):
        continue
    t0 = time.time()
    try:
        img = prepare(os.path.join(src, f))
        img.save(f'{dst}/input/{mid}.png')
        with torch.no_grad():
            codes = model([img], device='cpu')
        mesh = model.extract_mesh(codes, True, resolution=288)[0]
        mesh.export(f'{dst}/raw/{mid}.ply')
        print(mid, len(mesh.faces), 'faces', round(time.time() - t0, 1), 's', flush=True)
    except Exception as e:  # noqa: BLE001
        print(mid, 'ERREUR', e, flush=True)
