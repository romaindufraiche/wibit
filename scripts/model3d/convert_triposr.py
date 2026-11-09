"""
Conversion 2D -> 3D des modules Wibit avec TripoSR (image unique -> maillage), puis :
nettoyage (fragments), simplification, alignement de l'emprise sur les axes, couleurs Wibit
(teintes officielles, sans l'ombrage de la photo), export GLB.

  python convert.py <dossier_rendus> <dossier_sortie> [id ...]
"""
import json, math, os, sys, time
import numpy as np
from PIL import Image
import trimesh, torch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'shim'))
sys.path.insert(0, os.environ.get('TRIPOSR_DIR', os.path.join(HERE, 'TripoSR')))
from tsr.system import TSR  # noqa: E402
from tsr.utils import resize_foreground  # noqa: E402

# palette officielle (relevée sur les rendus produits)
WIBIT = {
    'yellow': (242, 210, 28),
    'green': (97, 174, 43),
    'blue': (47, 111, 194),
    'red': (214, 38, 46),
    'white': (244, 244, 240),
    'grey': (140, 146, 152),
    'dark': (43, 47, 51),
}
HUES = {'red': 355, 'yellow': 50, 'green': 100, 'blue': 213}


def wibit_color(rgb):
    """Teinte Wibit la plus proche (par la teinte pour les couleurs vives, par la luminosité sinon)."""
    r, g, b = [c / 255 for c in rgb]
    mx, mn = max(r, g, b), min(r, g, b)
    sat = (mx - mn) / mx if mx > 0 else 0
    if sat < 0.28 or mx < 0.18:
        return WIBIT['white'] if mx > 0.72 else WIBIT['grey'] if mx > 0.38 else WIBIT['dark']
    if mx == r:
        h = 60 * (((g - b) / (mx - mn)) % 6)
    elif mx == g:
        h = 60 * ((b - r) / (mx - mn) + 2)
    else:
        h = 60 * ((r - g) / (mx - mn) + 4)
    best = min(HUES, key=lambda k: min(abs(h - HUES[k]), 360 - abs(h - HUES[k])))
    return WIBIT[best]


def prepare(path):
    """Objet détouré, centré, sur fond gris (entrée attendue par TripoSR)."""
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(np.float32)
    if a[..., 3].min() > 250:  # pas de transparence : fond blanc à retirer depuis les bords
        rgb = a[..., :3]
        bg = np.linalg.norm(rgb - 255, axis=-1) < 38
        from scipy.ndimage import label
        lab, _ = label(bg)
        border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        a[..., 3] = np.where(np.isin(lab, list(border)), 0, 255)
        im = Image.fromarray(a.astype(np.uint8))
    im = resize_foreground(im, 0.85)
    im = im.resize((512, 512), Image.LANCZOS)
    x = np.asarray(im).astype(np.float32) / 255
    x = x[..., :3] * x[..., 3:4] + 0.5 * (1 - x[..., 3:4])
    return Image.fromarray((x * 255).astype(np.uint8))


def clean(mesh, faces=7000):
    # fragments isolés : on garde les composantes significatives
    parts = mesh.split(only_watertight=False)
    if len(parts) > 1:
        big = max(len(p.faces) for p in parts)
        mesh = trimesh.util.concatenate([p for p in parts if len(p.faces) > 0.03 * big])
    colors = mesh.visual.vertex_colors[:, :3].copy()
    verts = mesh.vertices.copy()
    if len(mesh.faces) > faces:
        import fast_simplification
        v2, f2 = fast_simplification.simplify(mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), target_reduction=1 - faces / len(mesh.faces))
        from scipy.spatial import cKDTree
        _, idx = cKDTree(verts).query(v2)
        mesh = trimesh.Trimesh(vertices=v2, faces=f2, process=False)
        colors = colors[idx]
    # couleurs Wibit, sans l'ombrage cuit dans la photo
    cache = {}
    out = np.zeros((len(colors), 4), np.uint8)
    for i, c in enumerate(colors):
        key = tuple(int(x) // 6 for x in c)
        if key not in cache:
            cache[key] = wibit_color(c)
        out[i, :3] = cache[key]
        out[i, 3] = 255
    # lissage des couleurs : vote majoritaire avec les voisins (évite les taches isolées)
    nb = mesh.vertex_neighbors
    smooth = out.copy()
    for i, n in enumerate(nb):
        if not n:
            continue
        vals, cnt = np.unique(out[[i, *n], :3], axis=0, return_counts=True)
        smooth[i, :3] = vals[cnt.argmax()]
    mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=smooth)
    return mesh


def align(mesh):
    """Y vers le haut, emprise alignée sur les axes (rectangle d'aire minimale), longueur sur x, posé en y = 0."""
    mesh.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
    mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0]))
    xz = mesh.vertices[:, [0, 2]]
    best = (1e18, 0)
    for deg in np.arange(0, 90, 1.0):
        t = math.radians(deg)
        R = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
        p = xz @ R.T
        area = np.ptp(p[:, 0]) * np.ptp(p[:, 1])
        if area < best[0]:
            best = (area, t)
    mesh.apply_transform(trimesh.transformations.rotation_matrix(best[1], [0, 1, 0]))
    ext = mesh.extents
    if ext[2] > ext[0]:
        mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0]))
    b = mesh.bounds
    mesh.apply_translation([-(b[0][0] + b[1][0]) / 2, -b[0][1], -(b[0][2] + b[1][2]) / 2])
    return mesh


def main():
    src, dst = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    os.makedirs(dst, exist_ok=True)
    torch.set_num_threads(os.cpu_count())
    model = TSR.from_pretrained('stabilityai/TripoSR', config_name='config.yaml', weight_name='model.ckpt')
    model.renderer.set_chunk_size(8192)
    model.to('cpu')
    files = sorted(os.listdir(src))
    log = {}
    for f in files:
        mid = os.path.splitext(f)[0]
        if only and mid not in only:
            continue
        out = os.path.join(dst, f'{mid}.glb')
        if os.path.exists(out):
            continue
        t0 = time.time()
        try:
            img = prepare(os.path.join(src, f))
            img.save(os.path.join(dst, f'{mid}.input.png'))
            with torch.no_grad():
                codes = model([img], device='cpu')
            mesh = model.extract_mesh(codes, True, resolution=192)[0]
            mesh = align(clean(mesh))
            mesh.export(out)
            log[mid] = {'faces': int(len(mesh.faces)), 'seconds': round(time.time() - t0, 1), 'extents': [round(x, 3) for x in mesh.extents]}
            print(mid, log[mid], flush=True)
        except Exception as e:  # noqa: BLE001
            print(mid, 'ERREUR', e, flush=True)
    with open(os.path.join(dst, 'log.json'), 'a') as fh:
        fh.write(json.dumps(log) + '\n')


if __name__ == '__main__':
    main()
