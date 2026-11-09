"""Texture peinte depuis le rendu officiel : dépliage UV (xatlas), projection, palette Wibit, export GLB texturé."""
import math, os, sys
import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from convert_triposr import WIBIT, HUES, _rot, align  # noqa: E402
import json
from finish import DIST, SIZE, project, silhouette_iou  # noqa: E402

NAMES = list(WIBIT)
PAL = np.array([WIBIT[k] for k in NAMES], np.float32)


def classify(rgb):
    """Vectorisé : indice de la teinte Wibit la plus proche (comme convert.wibit_color)."""
    c = rgb.astype(np.float32) / 255
    mx, mn = c.max(1), c.min(1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, 60 * (((g - b) / d) % 6), np.where(mx == g, 60 * ((b - r) / d + 2), 60 * ((r - g) / d + 4)))
    out = np.zeros(len(c), np.int64)
    hue_names = list(HUES)
    hd = np.stack([np.minimum(np.abs(h - HUES[k]), 360 - np.abs(h - HUES[k])) for k in hue_names], 1)
    out[:] = np.array([NAMES.index(k) for k in hue_names])[hd.argmin(1)]
    # reflets de la photo (clairs, peu saturés) : gardent leur teinte ; seuls les vrais neutres sont blanc / gris / noir
    out[(sat < 0.12) & (mx > 0.78)] = NAMES.index('white')
    out[(sat < 0.14) & (mx <= 0.78) & (mx > 0.36)] = NAMES.index('grey')
    out[(mx <= 0.22) & (sat < 0.45)] = NAMES.index('dark')
    return out


def sharpen(mesh, normal_iters=40, vertex_iters=15, sigma_r=0.55):
    """
    Débruitage qui préserve les arêtes (filtrage bilatéral des normales de faces, puis mise à jour des
    sommets) : faces planes vraiment planes, arêtes et plis nets, bruit de reconstruction retiré.
    """
    F = mesh.faces
    V = mesh.vertices.copy()
    adj = mesh.face_adjacency
    i, j = np.concatenate([adj[:, 0], adj[:, 1]]), np.concatenate([adj[:, 1], adj[:, 0]])
    area = mesh.area_faces
    edge = mesh.edges_unique_length.mean()
    sigma_s = 2.0 * edge
    N = mesh.face_normals.copy()
    for _ in range(normal_iters):
        C = V[F].mean(1)
        ws = np.exp(-((C[i] - C[j]) ** 2).sum(1) / (2 * sigma_s ** 2))
        wr = np.exp(-((N[i] - N[j]) ** 2).sum(1) / (2 * sigma_r ** 2))
        w = area[j] * ws * wr
        acc = N * area[:, None]
        np.add.at(acc, i, N[j] * w[:, None])
        N = acc / (np.linalg.norm(acc, axis=1, keepdims=True) + 1e-12)
    for _ in range(vertex_iters):
        C = V[F].mean(1)
        disp = np.zeros_like(V)
        cnt = np.zeros(len(V))
        for k in range(3):
            d = (N * ((C - V[F[:, k]]) * N).sum(1, keepdims=True))
            np.add.at(disp, F[:, k], d)
            np.add.at(cnt, F[:, k], 1)
        V += disp / np.maximum(cnt, 1)[:, None]
    return trimesh.Trimesh(vertices=V, faces=F, process=False)


def rebuild(mesh, res=192):
    """
    Surface propre, fermée et lisse : voxelisation pleine, ouverture (supprime voiles, lambeaux et
    artefacts internes), fermeture (bouche les creux parasites), puis isosurface d'un champ très lissé :
    l'aspect d'une toile gonflée et tendue.
    """
    from skimage.measure import marching_cubes
    pitch = mesh.extents.max() / res
    vox = mesh.voxelized(pitch).fill()
    pad = 8
    occ = np.pad(vox.matrix.astype(bool), pad)
    ball = ndimage.generate_binary_structure(3, 2)
    occ = ndimage.binary_opening(occ, structure=ball, iterations=1)
    occ = ndimage.binary_closing(occ, structure=ball, iterations=1)
    occ = ndimage.binary_fill_holes(occ)
    lab, n = ndimage.label(occ)
    if n > 1:
        sizes = ndimage.sum(occ, lab, range(1, n + 1))
        occ = np.isin(lab, 1 + np.flatnonzero(sizes > 0.03 * sizes.max()))
    field = ndimage.gaussian_filter(occ.astype(np.float32), 1.25)
    verts, faces_, _, _ = marching_cubes(field, 0.5)
    origin = vox.transform[:3, 3] - pad * pitch
    return trimesh.Trimesh(vertices=verts * pitch + origin, faces=faces_[:, ::-1], process=True)


DIMS = {}
_dims_path = os.environ.get('MODULE_DIMS', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dims.json'))
if os.path.exists(_dims_path):
    for row in json.load(open(_dims_path)):
        DIMS[row[0]] = (row[2], row[3], row[4])  # L, W, H


def _aligned_extents(v):
    """Emprise alignée (lacet optimal) : (long, court, hauteur)."""
    best = None
    for deg in np.arange(0, 90, 5.0):
        p = v @ _rot([0, 1, 0], deg).T
        ex, ey, ez = np.ptp(p[:, 0]), np.ptp(p[:, 1]), np.ptp(p[:, 2])
        if best is None or ex * ez < best[0]:
            best = (ex * ez, max(ex, ez), min(ex, ez), ey)
    return best[1:]


def orient_by_dims(mesh, dims):
    """
    Bonne position du module d'après sa fiche (L, l, H) : parmi les inclinaisons possibles (±90° autour des
    axes horizontaux), celle dont les proportions (hauteur / longueur, largeur / longueur) collent le mieux,
    à compacité égale. Indispensable pour les modules plats, vus presque par la tranche sur les rendus.
    """
    L, W, H = dims
    R1, R2 = H / max(L, W), min(L, W) / max(L, W)
    v = mesh.vertices[np.random.default_rng(0).choice(len(mesh.vertices), min(2000, len(mesh.vertices)), replace=False)]
    def cost(ax, az):
        R = _rot([0, 0, 1], az) @ _rot([1, 0, 0], ax)
        lo, sh, h = _aligned_extents(v @ R.T)
        e = np.log(max(h / lo, 1e-3) / R1) ** 2 + 0.5 * np.log(max(sh / lo, 1e-3) / R2) ** 2
        return e + 0.02 * (abs(ax - 30) + abs(az)) / 30  # à égalité, l'inclinaison attendue (~30°) l'emporte
    best = (1e9, 30.0, 0.0)
    for ax in np.arange(-90, 91, 10):
        for az in np.arange(-90, 91, 10):
            c = cost(ax, az)
            if c < best[0]:
                best = (c, ax, az)
    for ax in np.arange(best[1] - 8, best[1] + 9, 2):
        for az in np.arange(best[2] - 8, best[2] + 9, 2):
            c = cost(ax, az)
            if c < best[0]:
                best = (c, ax, az)
    return best[1], best[2]


def bake(raw_path, img_path, faces=30000, tex=2048, dims=None):
    raw = trimesh.load(raw_path, process=False)
    raw_tree = cKDTree(raw.vertices)
    raw_cls = classify(np.asarray(raw.visual.vertex_colors[:, :3]))
    mesh = rebuild(raw)
    import fast_simplification
    if len(mesh.faces) > faces:
        v2, f2 = fast_simplification.simplify(mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), target_reduction=1 - faces / len(mesh.faces))
        mesh = trimesh.Trimesh(vertices=v2, faces=f2, process=True)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=6)
    mesh = sharpen(mesh)
    # dépliage UV
    import xatlas
    vmap, idx, uvs = xatlas.parametrize(mesh.vertices, mesh.faces)
    V = mesh.vertices[vmap]
    N = mesh.vertex_normals[vmap]
    F = idx
    # rasterisation des triangles dans l'espace UV : position 3D et normale de chaque texel
    T = tex
    uvp = uvs * (T - 1)
    pos = np.full((T, T, 3), np.nan, np.float32)
    nrm = np.zeros((T, T, 3), np.float32)
    for tri in F:
        p = uvp[tri]
        x0, y0 = np.floor(p.min(0)).astype(int)
        x1, y1 = np.ceil(p.max(0)).astype(int)
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        P = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], 1)
        a, b, c = p
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (P[:, 0] - c[0]) + (c[0] - b[0]) * (P[:, 1] - c[1])) / den
        w1 = ((c[1] - a[1]) * (P[:, 0] - c[0]) + (a[0] - c[0]) * (P[:, 1] - c[1])) / den
        w2 = 1 - w0 - w1
        ok = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not ok.any():
            continue
        W = np.stack([w0, w1, w2], 1)[ok]
        X, Y = xs.ravel()[ok], ys.ravel()[ok]
        inb = (X >= 0) & (X < T) & (Y >= 0) & (Y < T)
        X, Y, W = X[inb], Y[inb], W[inb]
        pos[Y, X] = W @ V[tri]
        nrm[Y, X] = W @ N[tri]
    filled = ~np.isnan(pos[..., 0])
    P3 = pos[filled]
    N3 = nrm[filled]
    N3 /= np.linalg.norm(N3, axis=1, keepdims=True) + 1e-9
    # projection dans le rendu officiel + visibilité (tampon de profondeur des texels)
    im = np.asarray(Image.open(img_path).convert('RGB'))
    alpha = (np.abs(im.astype(np.float32) - 127.5).max(-1) > 6)
    mirror = silhouette_iou(mesh, alpha.astype(np.float32), True) > silhouette_iou(mesh, alpha.astype(np.float32), False)
    px, py, depth = project(P3, mirror)
    G = 384
    gx = np.clip((px / SIZE * G).astype(int), 0, G - 1)
    gy = np.clip((py / SIZE * G).astype(int), 0, G - 1)
    zbuf = np.full((G, G), np.inf)
    np.minimum.at(zbuf, (gy, gx), depth)
    zbuf = ndimage.minimum_filter(zbuf, size=3)
    to_cam = np.stack([DIST - P3[:, 0], -P3[:, 1], -P3[:, 2]], 1)
    to_cam /= np.linalg.norm(to_cam, axis=1, keepdims=True)
    facing = (N3 * to_cam).sum(1)
    xi = np.clip(px.astype(int), 0, SIZE - 1)
    yi = np.clip(py.astype(int), 0, SIZE - 1)
    visible = (depth <= zbuf[gy, gx] + 0.012) & (facing > 0.12) & alpha[yi, xi]
    cls = raw_cls[raw_tree.query(P3)[1]]
    cls[visible] = classify(im[yi[visible], xi[visible]])
    # carte des teintes, nettoyée (vote majoritaire 5x5), bords des îlots UV étendus (pas de coutures)
    lab = np.full((T, T), -1, np.int64)
    lab[filled] = cls
    vis = np.zeros((T, T), bool)
    vis[filled] = visible
    K = len(NAMES)
    def mode(lbl, size):
        return np.stack([ndimage.uniform_filter((lbl == k).astype(np.float32), size) for k in range(K)], -1).argmax(-1)
    big = [NAMES.index(k) for k in ('yellow', 'green', 'blue')]
    # grands aplats (jaune, vert, bleu) : contours adoucis ; faces cachées : très lissées
    def mode_big(lbl, size):
        return np.array(big)[np.stack([ndimage.uniform_filter((lbl == k).astype(np.float32), size) for k in big], -1).argmax(-1)]
    # fond : uniquement les trois teintes principales (jaune, vert, bleu), les détails sont posés par-dessus
    base = np.where(vis, mode_big(lab, 9), mode_big(lab, 21))
    # détails sur la face visible (logos, prises, cordes, numéros) : gardés nets
    fine = mode(lab, 3)
    detail = vis & ~np.isin(fine, big) & (ndimage.uniform_filter((lab == fine).astype(np.float32), 3) > 0.55)
    # rouge : un lettrage est fin (mêlé au fond) ; une zone rouge dense vient d'un texte fondu par la photo
    red = NAMES.index('red')
    detail &= ~((fine == red) & (ndimage.uniform_filter((lab == red).astype(np.float32), 15) > 0.5))
    lab2 = np.where(filled, np.where(detail, fine, base), -1)
    # faces cachées : uniquement les trois teintes principales (pas de détails inventés)
    big_mode = np.stack([ndimage.uniform_filter((lab2 == k).astype(np.float32), 31) for k in big], -1).argmax(-1)
    hidden_bad = filled & ~vis & ~np.isin(lab2, big)
    lab2[hidden_bad] = np.array(big)[big_mode[hidden_bad]]
    # petites taches : îlots trop petits absorbés par leur entourage (aplats propres et homogènes)
    min_big = int(0.0006 * T * T)
    for k in range(K):
        comp, n = ndimage.label(lab2 == k)
        if not n:
            continue
        sizes = np.bincount(comp.ravel())
        limit = min_big if k in big else 60
        small = (sizes < limit)
        # rouge : lettrages et logos sont petits ; une grande plaque rouge vient d'un texte fondu par la photo
        if NAMES[k] == 'red':
            small |= sizes > int(0.0012 * T * T)
        small[0] = False
        lab2[small[comp]] = -1
    lab2[~filled] = -1
    _, ind = ndimage.distance_transform_edt(lab2 < 0, return_indices=True)
    lab2 = lab2[ind[0], ind[1]]
    img = PAL[lab2].astype(np.uint8)
    img = np.asarray(Image.fromarray(img).resize((T // 2, T // 2), Image.LANCZOS))
    texture = Image.fromarray(img).transpose(Image.FLIP_TOP_BOTTOM)
    textured = trimesh.Trimesh(vertices=V, faces=F, process=False)
    textured.visual = trimesh.visual.TextureVisuals(uv=uvs, material=trimesh.visual.material.PBRMaterial(baseColorTexture=texture, metallicFactor=0.0, roughnessFactor=0.45))
    tilt = None
    if dims:
        # mêmes rotations initiales que align (repère y en haut), puis inclinaison choisie d'après la fiche
        probe = textured.copy()
        probe.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
        probe.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0]))
        tilt = orient_by_dims(probe, dims)
    textured = align(textured, cam=(DIST, 0.0, 0.0), tilt=tilt)
    # assise plate : le dessous (4 % de la hauteur) est aplani sur la ligne d'eau
    v = textured.vertices.copy()
    floor = 0.04 * textured.extents[1]
    v[:, 1] = np.maximum(v[:, 1], floor) - floor
    textured.vertices = v
    return textured, {'mirror': bool(mirror), 'visible': round(float(visible.mean()), 2), 'faces': int(len(F))}


if __name__ == '__main__':
    work, dst = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    os.makedirs(dst, exist_ok=True)
    import time
    for f in sorted(os.listdir(f'{work}/raw')):
        mid = os.path.splitext(f)[0]
        if only and mid not in only:
            continue
        t0 = time.time()
        try:
            mesh, info = bake(f'{work}/raw/{f}', f'{work}/input/{mid}.png', dims=DIMS.get(mid))
            mesh.export(f'{dst}/{mid}.glb', include_normals=True)
            info['s'] = round(time.time() - t0, 1)
            print(mid, info, flush=True)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            print(mid, 'ERREUR', repr(e), flush=True)
