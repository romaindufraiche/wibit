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
    if sat < 0.22 or mx < 0.12:
        return WIBIT['white'] if mx > 0.68 else WIBIT['grey'] if mx > 0.34 else WIBIT['dark']
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


def clean(mesh, faces=12000):
    # fragments isolés : on garde les composantes significatives
    parts = mesh.split(only_watertight=False)
    if len(parts) > 1:
        big = max(len(p.faces) for p in parts)
        mesh = trimesh.util.concatenate([p for p in parts if len(p.faces) > 0.03 * big])
    colors = mesh.visual.vertex_colors[:, :3].copy()
    # lissage de surface (filtre de Taubin : garde le volume, retire les « marches » du marching cubes)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=12)
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
    for _ in range(4):
        smooth = out.copy()
        for i, n in enumerate(nb):
            if not n:
                continue
            vals, cnt = np.unique(out[[i, *n], :3], axis=0, return_counts=True)
            smooth[i, :3] = vals[cnt.argmax()]
        out = smooth
    lin = out.astype(np.float64) / 255
    lin[:, :3] = np.where(lin[:, :3] <= 0.04045, lin[:, :3] / 12.92, ((lin[:, :3] + 0.055) / 1.055) ** 2.4)
    mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=(lin * 255).round().astype(np.uint8))
    return mesh


def _rot(ax, deg):
    return trimesh.transformations.rotation_matrix(math.radians(deg), ax)[:3, :3]


def _box_volume(v):
    """Volume de la boîte englobante, l'emprise étant alignée au mieux (lacet optimal)."""
    best = 1e18
    for deg in np.arange(0, 90, 6.0):
        p = v @ _rot([0, 1, 0], deg).T
        best = min(best, np.ptp(p[:, 0]) * np.ptp(p[:, 1]) * np.ptp(p[:, 2]))
    return best


def align(mesh, cam=None):
    """Y vers le haut, inclinaison de la prise de vue corrigée, emprise alignée sur les axes, longueur sur x, posé en y = 0."""
    mats = [trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]), trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0])]
    for M in mats:
        mesh.apply_transform(M)
    v = mesh.vertices[np.random.default_rng(0).choice(len(mesh.vertices), min(2500, len(mesh.vertices)), replace=False)]
    # inclinaison : rotations autour des deux axes horizontaux (±45°) qui rendent la boîte englobante la plus compacte
    best = (_box_volume(v), 0.0, 0.0)
    for step, span in ((5, 45), (1, 5)):
        cx, cz = best[1], best[2]
        for ax_deg in np.arange(cx - span, cx + span + 0.1, step):
            for az_deg in np.arange(cz - span, cz + span + 0.1, step):
                R = _rot([0, 0, 1], az_deg) @ _rot([1, 0, 0], ax_deg)
                vol = _box_volume(v @ R.T)
                if vol < best[0] * 0.999:
                    best = (vol, ax_deg, az_deg)
    T = np.eye(4)
    T[:3, :3] = _rot([0, 0, 1], best[2]) @ _rot([1, 0, 0], best[1])
    mesh.apply_transform(T)
    mats.append(T)
    xz = mesh.vertices[:, [0, 2]]
    yaw = (1e18, 0)
    for deg in np.arange(0, 90, 1.0):
        t = math.radians(deg)
        R = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
        p = xz @ R.T
        area = np.ptp(p[:, 0]) * np.ptp(p[:, 1])
        if area < yaw[0]:
            yaw = (area, t)
    mesh.apply_transform(trimesh.transformations.rotation_matrix(yaw[1], [0, 1, 0]))
    mats.append(trimesh.transformations.rotation_matrix(yaw[1], [0, 1, 0]))
    print('  inclinaison corrigée :', round(best[1]), '°,', round(best[2]), '°', flush=True)
    ext = mesh.extents
    if ext[2] > ext[0]:
        mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0]))
        mats.append(trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0]))
    if cam is not None:
        c = np.array([*cam, 0.0])
        for M in mats:
            c = M @ c
        # la face vue sur le rendu officiel regarde vers +x / +z (comme la caméra du catalogue)
        if c[0] + c[2] < 0:
            mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [0, 1, 0]))
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
            mesh = model.extract_mesh(codes, True, resolution=256)[0]
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
