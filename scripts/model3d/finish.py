"""
Étape 2 : finition d'un maillage TripoSR brut.
- nettoyage (fragments), lissage fort (surfaces gonflables), simplification ;
- couleurs projetées depuis le rendu officiel (caméra d'entrée TripoSR : (1,9 ; 0 ; 0), fov 40°, z en haut)
  sur les faces visibles, couleurs reconstruites ailleurs ; puis palette Wibit ;
- alignement (inclinaison de la prise de vue, emprise), couleurs en linéaire, GLB.

  python finish.py <work> <sortie> [id ...]
"""
import json, math, os, sys
import numpy as np
import trimesh
from PIL import Image
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from convert_triposr import align, wibit_color  # noqa: E402

DIST, FOV, SIZE = 1.9, 40.0, 512
TAN = math.tan(math.radians(FOV / 2))


def project(v, mirror):
    """Sommets (repère TripoSR) -> pixels de l'image d'entrée, profondeur."""
    depth = DIST - v[:, 0]
    sx = (-v[:, 1] if mirror else v[:, 1]) / depth / TAN
    sy = v[:, 2] / depth / TAN
    return (0.5 + 0.5 * sx) * SIZE, (0.5 - 0.5 * sy) * SIZE, depth


def silhouette_iou(mesh, alpha, mirror):
    px, py, _ = project(mesh.vertices, mirror)
    m = np.zeros_like(alpha, dtype=bool)
    ok = (px >= 0) & (px < SIZE) & (py >= 0) & (py < SIZE)
    m[py[ok].astype(int), px[ok].astype(int)] = True
    from scipy.ndimage import binary_closing, binary_fill_holes
    m = binary_fill_holes(binary_closing(m, iterations=3))
    a = alpha > 0.5
    return (m & a).sum() / max(1, (m | a).sum())


def rebuild(mesh, res=150, thin=1):
    """
    Surface propre et fermée : voxelisation pleine, suppression des parties trop fines (voiles et
    lambeaux de la reconstruction), puis isosurface lissée (aspect gonflable tendu).
    """
    from scipy import ndimage
    from skimage.measure import marching_cubes
    pitch = mesh.extents.max() / res
    vox = mesh.voxelized(pitch).fill()
    occ = vox.matrix.astype(bool)
    occ = np.pad(occ, 4)
    # ouverture morphologique : enlève ce qui fait moins de ~2 voxels d'épaisseur
    st = ndimage.generate_binary_structure(3, 1)
    opened = ndimage.binary_opening(occ, structure=st, iterations=thin)
    lab, n = ndimage.label(opened)
    if n > 1:
        sizes = ndimage.sum(opened, lab, range(1, n + 1))
        opened = np.isin(lab, 1 + np.flatnonzero(sizes > 0.02 * sizes.max()))
    field = ndimage.gaussian_filter(opened.astype(np.float32), 1.1)
    verts, faces_, _, _ = marching_cubes(field, 0.5)
    # retour dans le repère d'origine
    origin = vox.transform[:3, 3] - 4 * pitch
    verts = verts * pitch + origin
    return trimesh.Trimesh(vertices=verts, faces=faces_[:, ::-1], process=True)


def finish(raw_path, img_path, faces=22000):
    mesh = trimesh.load(raw_path, process=False)
    raw_colors = np.asarray(mesh.visual.vertex_colors[:, :3]).copy()
    raw_tree = cKDTree(mesh.vertices)
    mesh = rebuild(mesh)
    import fast_simplification
    if len(mesh.faces) > faces:
        v2, f2 = fast_simplification.simplify(mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), target_reduction=1 - faces / len(mesh.faces))
        mesh = trimesh.Trimesh(vertices=v2, faces=f2, process=True)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=6)
    v = mesh.vertices
    # image officielle (fond gris composé par prepare) : couleurs et masque
    im = np.asarray(Image.open(img_path).convert('RGB')).astype(np.float32)
    alpha = (np.abs(im - 127.5).max(-1) > 6).astype(np.float32)
    mirror = silhouette_iou(mesh, alpha, True) > silhouette_iou(mesh, alpha, False)
    px, py, depth = project(v, mirror)
    # visibilité : tampon de profondeur par projection des sommets (grille 256), et faces tournées vers la caméra
    G = 256
    gx = np.clip((px / SIZE * G).astype(int), 0, G - 1)
    gy = np.clip((py / SIZE * G).astype(int), 0, G - 1)
    zbuf = np.full((G, G), np.inf)
    np.minimum.at(zbuf, (gy, gx), depth)
    from scipy.ndimage import minimum_filter
    zbuf = minimum_filter(zbuf, size=3)
    normals = mesh.vertex_normals
    to_cam = np.stack([DIST - v[:, 0], -v[:, 1], -v[:, 2]], 1)
    to_cam /= np.linalg.norm(to_cam, axis=1, keepdims=True)
    facing = (normals * to_cam).sum(1)
    inside = (px >= 1) & (px < SIZE - 1) & (py >= 1) & (py < SIZE - 1)
    visible = inside & (depth <= zbuf[gy, gx] + 0.025) & (facing > 0.15)
    xi, yi = np.clip(px.astype(int), 0, SIZE - 1), np.clip(py.astype(int), 0, SIZE - 1)
    visible &= alpha[yi, xi] > 0.5
    img_col = im[yi, xi]
    _, idx = raw_tree.query(v)
    colors = raw_colors[idx].astype(np.float32)
    colors[visible] = img_col[visible]
    # palette Wibit
    cache = {}
    out = np.zeros((len(v), 3), np.uint8)
    for i, c in enumerate(colors):
        key = tuple(int(x) // 6 for x in c)
        if key not in cache:
            cache[key] = wibit_color(c)
        out[i] = cache[key]
    # nettoyage des taches : 2 passes de vote majoritaire (les zones visibles comptent double)
    nb = mesh.vertex_neighbors
    for _ in range(2):
        nxt = out.copy()
        for i, n in enumerate(nb):
            if not n:
                continue
            ids = [i, *n]
            w = np.where(visible[ids], 2, 1)
            vals, inv = np.unique(out[ids], axis=0, return_inverse=True)
            score = np.bincount(inv.ravel(), weights=w)
            nxt[i] = vals[score.argmax()]
        out = nxt
    lin = out.astype(np.float64) / 255
    lin = np.where(lin <= 0.04045, lin / 12.92, ((lin + 0.055) / 1.055) ** 2.4)
    rgba = np.concatenate([(lin * 255).round(), np.full((len(v), 1), 255)], 1).astype(np.uint8)
    mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=rgba)
    mesh = align(mesh)
    return mesh, {'mirror': bool(mirror), 'visible': round(float(visible.mean()), 2), 'faces': int(len(mesh.faces))}


if __name__ == '__main__':
    work, dst = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    os.makedirs(dst, exist_ok=True)
    for f in sorted(os.listdir(f'{work}/raw')):
        mid = os.path.splitext(f)[0]
        if only and mid not in only:
            continue
        try:
            mesh, info = finish(f'{work}/raw/{f}', f'{work}/input/{mid}.png')
            mesh.export(f'{dst}/{mid}.glb')
            print(mid, info, flush=True)
        except Exception as e:  # noqa: BLE001
            print(mid, 'ERREUR', repr(e), flush=True)
