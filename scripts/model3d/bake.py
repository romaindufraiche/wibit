"""Texture peinte depuis le rendu officiel : dépliage UV (xatlas), projection, palette Wibit, export GLB texturé."""
import math, os, sys
import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from convert_triposr import WIBIT, HUES, align  # noqa: E402
from finish import DIST, SIZE, project, rebuild, silhouette_iou  # noqa: E402

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
    neutral = (sat < 0.22) | (mx < 0.12)
    out[neutral & (mx > 0.68)] = NAMES.index('white')
    out[neutral & (mx <= 0.68) & (mx > 0.34)] = NAMES.index('grey')
    out[neutral & (mx <= 0.34)] = NAMES.index('dark')
    return out


def bake(raw_path, img_path, faces=20000, tex=1024):
    raw = trimesh.load(raw_path, process=False)
    raw_tree = cKDTree(raw.vertices)
    raw_cls = classify(np.asarray(raw.visual.vertex_colors[:, :3]))
    mesh = rebuild(raw)
    import fast_simplification
    if len(mesh.faces) > faces:
        v2, f2 = fast_simplification.simplify(mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), target_reduction=1 - faces / len(mesh.faces))
        mesh = trimesh.Trimesh(vertices=v2, faces=f2, process=True)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=6)
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
    fine = np.stack([ndimage.uniform_filter((lab == k).astype(np.float32), 3) for k in range(len(NAMES))], -1).argmax(-1)
    coarse = np.stack([ndimage.uniform_filter((lab == k).astype(np.float32), 15) for k in range(len(NAMES))], -1).argmax(-1)
    lab2 = np.where(filled, np.where(vis, fine, coarse), -1)
    _, ind = ndimage.distance_transform_edt(lab2 < 0, return_indices=True)
    lab2 = lab2[ind[0], ind[1]]
    img = PAL[lab2].astype(np.uint8)
    texture = Image.fromarray(img).transpose(Image.FLIP_TOP_BOTTOM)
    textured = trimesh.Trimesh(vertices=V, faces=F, process=False)
    textured.visual = trimesh.visual.TextureVisuals(uv=uvs, material=trimesh.visual.material.PBRMaterial(baseColorTexture=texture, metallicFactor=0.0, roughnessFactor=0.45))
    textured = align(textured, cam=(DIST, 0.0, 0.0))
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
            mesh, info = bake(f'{work}/raw/{f}', f'{work}/input/{mid}.png')
            mesh.export(f'{dst}/{mid}.glb', include_normals=True)
            info['s'] = round(time.time() - t0, 1)
            print(mid, info, flush=True)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            print(mid, 'ERREUR', repr(e), flush=True)
