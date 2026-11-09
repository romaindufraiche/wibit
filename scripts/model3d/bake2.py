"""
Reconstruction géométrique des modules : la forme TripoSR sert d'ébauche, puis
- mise aux dimensions officielles (L x H x l) dans un repère métrique aligné sur les axes du module ;
- grille de voxels régulière en mètres, alignée sur les axes : faces planes et pans droits ;
- symétries détectées (longueur, largeur) et imposées quand le module est symétrique ;
- emprise stricte : rien ne dépasse le rectangle officiel ;
- texture projetée depuis le rendu officiel ; sur un module symétrique, la face cachée reprend en miroir
  les couleurs et détails de la face visible.

  python bake2.py <work> <sortie> [id ...]
"""
import json, math, os, sys, time
import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from convert_triposr import align  # noqa: E402
from finish import DIST, SIZE, project  # noqa: E402
from bake import DIMS, NAMES, PAL, classify, orient_by_dims, sharpen  # noqa: E402


# Symétries connues des modules Wibit (repère du module : x = longueur, z = largeur).
# BOTH : symétrique sur les deux axes ; WIDTH : symétrique gauche / droite (les deux bouts diffèrent).
# La mesure sur la reconstruction sert de confirmation ; un module absent des listes n'est symétrisé que si
# la reconstruction est elle-même presque parfaitement symétrique.
BOTH = set("""balancebar-l balancebar-s balancebeam bridge dipbars dome hop hurdle logroll plank roundabout target
trampoline-4 wiggleboard wigglebridge junction base bouncer-xxl monkeybars swing triplejump""".split())
WIDTH = set("""cliff slide slope quarterpipe peak takeoff step step6 guardtower startgate-sus launchgate comeback-sus
highroller flip twist targetjump quickjump quickjump-l y-connect t-connect-sus v-connect base-sus watchtopper
trampoline-2 levelpass matchball hangshake gapjump overclimb endrise mountain icetower-xxl springboard deck3
speedslide stepslide pologoal highbars""".split())


def symmetry_axes(mid, sym, dims):
    L, W, _ = dims
    if mid in BOTH:
        return [a for a, n in ((0, 'x'), (2, 'z')) if sym[n] >= 0.75]
    if mid in WIDTH:
        if abs(L - W) < 0.15 * max(L, W):  # module carré : l'axe de symétrie est celui que la mesure confirme le mieux
            n = max(('x', 'z'), key=lambda k: sym[k])
            return [0 if n == 'x' else 2] if sym[n] >= 0.75 else []
        return [2] if sym['z'] >= 0.75 else []
    return [a for a, n in ((0, 'x'), (2, 'z')) if sym[n] >= 0.92]


def metric_frame(raw, dims):
    """Transformation affine raw -> repère métrique du module (x = longueur, y = hauteur, z = largeur, sol en 0)."""
    probe = raw.copy()
    probe.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
    probe.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0]))
    tilt = orient_by_dims(probe, dims)
    al = align(raw.copy(), cam=(DIST, 0.0, 0.0), tilt=tilt)
    X = np.c_[raw.vertices, np.ones(len(raw.vertices))]
    M, *_ = np.linalg.lstsq(X, al.vertices, rcond=None)  # 4x3 : raw -> aligné
    A = np.eye(4)
    A[:3, :] = M.T
    L, W, H = dims
    ext = al.extents
    S = np.diag([L / ext[0], H / ext[1], W / ext[2], 1.0])
    return S @ A


def occupancy(mesh_m, dims, pitch):
    """Occupation pleine sur une grille centrée (x, z) et posée au sol (y), en mètres."""
    L, W, H = dims
    vox = mesh_m.voxelized(pitch).fill()
    m = vox.matrix.astype(bool)
    o = vox.transform[:3, 3]
    pad = 6
    nx, ny, nz = int(math.ceil(L / pitch)) + 2 * pad, int(math.ceil(H / pitch)) + 2 * pad, int(math.ceil(W / pitch)) + 2 * pad
    grid = np.zeros((nx, ny, nz), bool)
    origin = np.array([-nx * pitch / 2, -pad * pitch, -nz * pitch / 2])
    off = np.round((o - origin) / pitch).astype(int)
    sl = tuple(slice(max(0, off[k]), min(grid.shape[k], off[k] + m.shape[k])) for k in range(3))
    src = tuple(slice(sl[k].start - off[k], sl[k].stop - off[k]) for k in range(3))
    grid[sl] = m[src]
    return grid, origin


def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())


BASE_H = 0.3  # épaisseur des boudins de base Wibit (m)


def clean_footprint(mask, pitch, tol_m=0.12, snap_deg=15):
    """
    Contour de l'emprise en segments droits : polygone simplifié (Douglas-Peucker, tolérance ~12 cm),
    directions des segments ramenées aux multiples de 15° quand elles en sont proches, puis rastérisé.
    """
    from skimage import measure, draw
    out = np.zeros_like(mask)
    lab, n = ndimage.label(mask)
    for k in range(1, n + 1):
        comp = lab == k
        if comp.sum() < 30:
            continue
        cs = measure.find_contours(np.pad(comp, 1).astype(float), 0.5)
        if not cs:
            continue
        c = max(cs, key=len) - 1
        poly = measure.approximate_polygon(c, tolerance=tol_m / pitch)
        # redressement des segments presque alignés sur les multiples de 15°
        P = poly[:-1].copy()
        m = len(P)
        if m >= 3:
            for _ in range(2):
                for i in range(m):
                    a, b = P[i], P[(i + 1) % m]
                    d = b - a
                    ang = math.degrees(math.atan2(d[1], d[0]))
                    target = round(ang / snap_deg) * snap_deg
                    if abs(ang - target) < 6:
                        mid_ = (a + b) / 2
                        L_ = np.linalg.norm(d) / 2
                        t = math.radians(target)
                        u = np.array([math.cos(t), math.sin(t)])
                        P[i] = mid_ - u * L_
                        P[(i + 1) % m] = mid_ + u * L_
            rr, cc = draw.polygon(P[:, 0], P[:, 1], comp.shape)
            out[rr, cc] = True
        else:
            out |= comp
    # les trous intérieurs (anneaux, cadres) sont conservés tels quels
    holes = ndimage.binary_fill_holes(mask) & ~mask
    holes = ndimage.binary_opening(holes, iterations=2)
    return out & ~holes


def rebuild_metric(mid, raw, A, dims, res=170):
    L, W, H = dims
    mesh_m = raw.copy()
    mesh_m.apply_transform(A)
    pitch = max(L, W, H) / res
    occ, origin = occupancy(mesh_m, dims, pitch)
    ball = ndimage.generate_binary_structure(3, 2)
    occ = ndimage.binary_opening(occ, structure=ball, iterations=1)
    occ = ndimage.binary_closing(occ, structure=ball, iterations=1)
    occ = ndimage.binary_fill_holes(occ)
    # symétries : mesurées sur les projections (vue de dessus, vue de face / de profil), plus robustes que le
    # volume face aux imperfections de la reconstruction ; plan médian de la longueur (x) et de la largeur (z)
    top = occ.any(1)          # (x, z)
    side_xy = occ.any(2)      # (x, y)
    side_zy = occ.any(0)      # (y, z)
    sym = {
        'x': round(float(0.5 * (iou(top, np.flip(top, 0)) + iou(side_xy, np.flip(side_xy, 0)))), 2),
        'z': round(float(0.5 * (iou(top, np.flip(top, 1)) + iou(side_zy, np.flip(side_zy, 1)))), 2),
    }
    mirrored = symmetry_axes(mid, sym, dims)
    # base : emprise en segments droits, boudins de base pleins sur 30 cm (ou toute la hauteur d'un module plat)
    ys_c = origin[1] + (np.arange(occ.shape[1]) + 0.5) * pitch
    base_rows = (ys_c >= 0) & (ys_c <= min(BASE_H, H))
    flat = H <= 0.6  # modules plats (bases, jonctions, poutres) : emprise en segments droits, volume extrudé
    foot = occ[:, base_rows, :].any(1)
    for axis in mirrored:
        a2 = 0 if axis == 0 else 1
        foot = foot | np.flip(foot, a2)
    if flat:
        foot = clean_footprint(foot, pitch)
    for axis in mirrored:
        a2 = 0 if axis == 0 else 1
        foot = foot & np.flip(foot, a2)
    if flat:
        occ[:, base_rows, :] = foot[:, None, :]
        occ &= ndimage.binary_dilation(foot, iterations=2)[:, None, :]
        field = ndimage.gaussian_filter(occ.astype(np.float32), 0.8)
    else:
        field = ndimage.gaussian_filter(occ.astype(np.float32), 1.0)
        for axis in mirrored:
            field = 0.5 * (field + np.flip(field, axis))
    for axis in mirrored:
        field = 0.5 * (field + np.flip(field, axis))
    # emprise stricte : rien hors du rectangle officiel ni sous l'eau
    xs = origin[0] + (np.arange(field.shape[0]) + 0.5) * pitch
    ys = origin[1] + (np.arange(field.shape[1]) + 0.5) * pitch
    zs = origin[2] + (np.arange(field.shape[2]) + 0.5) * pitch
    field[np.abs(xs) > L / 2] = 0
    field[:, ys < 0] = 0
    field[:, ys > H] = 0
    field[:, :, np.abs(zs) > W / 2] = 0
    field = ndimage.gaussian_filter(field, 0.6)
    from skimage.measure import marching_cubes
    verts, faces, _, _ = marching_cubes(field, 0.5)
    verts = verts * pitch + origin + pitch / 2
    mesh = trimesh.Trimesh(vertices=verts, faces=faces[:, ::-1], process=True)
    parts = mesh.split(only_watertight=False)
    if len(parts) > 1:
        big = max(len(p.faces) for p in parts)
        mesh = trimesh.util.concatenate([p for p in parts if len(p.faces) > 0.03 * big])
    # dimensions officielles exactes après symétrisation (centré en x / z, posé en y = 0)
    b = mesh.bounds
    ext = np.maximum(b[1] - b[0], 1e-6)
    v = mesh.vertices.copy()
    v[:, 0] = (v[:, 0] - (b[0][0] + b[1][0]) / 2) * L / ext[0]
    v[:, 1] = (v[:, 1] - b[0][1]) * H / ext[1]
    v[:, 2] = (v[:, 2] - (b[0][2] + b[1][2]) / 2) * W / ext[2]
    mesh.vertices = v
    return mesh, sym, mirrored


def bake2(mid, raw_path, img_path, faces=30000, tex=2048):
    dims = DIMS[mid]
    raw = trimesh.load(raw_path, process=False)
    raw_tree = cKDTree(raw.vertices)
    raw_cls = classify(np.asarray(raw.visual.vertex_colors[:, :3]))
    A = metric_frame(raw, dims)
    Ainv = np.linalg.inv(A)
    mesh, sym, mirrored = rebuild_metric(mid, raw, A, dims)
    import fast_simplification
    if len(mesh.faces) > faces:
        v2, f2 = fast_simplification.simplify(mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), target_reduction=1 - faces / len(mesh.faces))
        mesh = trimesh.Trimesh(vertices=v2, faces=f2, process=True)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=4)
    thin = dims[2] < 0.6
    mesh = sharpen(mesh, normal_iters=20 if thin else 40, vertex_iters=4 if thin else 15, sigma_r=0.45)
    # symétrie exacte des sommets : chaque sommet rejoint la moyenne avec son reflet le plus proche
    for axis in []:  # le champ est déjà symétrique ; l'appariement de sommets abîmait les modules minces
        v = mesh.vertices.copy()
        refl = v.copy()
        refl[:, axis] *= -1
        d, j = cKDTree(v).query(refl)
        close = d < 0.02 * max(dims)
        v2 = v.copy()
        v2[close] = 0.5 * (v[close] + refl[j[close]])
        mesh.vertices = v2
    # dépliage UV et texels
    import xatlas
    vmap, idx, uvs = xatlas.parametrize(mesh.vertices, mesh.faces)
    V, N, F = mesh.vertices[vmap], mesh.vertex_normals[vmap], idx
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
        Wt = np.stack([w0, w1, w2], 1)[ok]
        X, Y = xs.ravel()[ok], ys.ravel()[ok]
        inb = (X >= 0) & (X < T) & (Y >= 0) & (Y < T)
        pos[Y[inb], X[inb]] = Wt[inb] @ V[tri]
        nrm[Y[inb], X[inb]] = Wt[inb] @ N[tri]
    filled = ~np.isnan(pos[..., 0])
    P3m = pos[filled].astype(np.float64)
    N3m = nrm[filled].astype(np.float64)
    N3m /= np.linalg.norm(N3m, axis=1, keepdims=True) + 1e-9
    im = np.asarray(Image.open(img_path).convert('RGB'))
    alpha = np.abs(im.astype(np.float32) - 127.5).max(-1) > 6

    def sample(Pm, Nm):
        """Classe de couleur vue sur le rendu officiel pour des points du repère métrique (-1 si invisible)."""
        Pr = (np.c_[Pm, np.ones(len(Pm))] @ Ainv.T)[:, :3]
        Nr = Nm @ np.linalg.inv(Ainv[:3, :3])  # normales : inverse transposée de la transformation des points
        Nr /= np.linalg.norm(Nr, axis=1, keepdims=True) + 1e-9
        px, py, depth = project(Pr, False)
        return Pr, Nr, px, py, depth

    Pr, Nr, px, py, depth = sample(P3m, N3m)
    G = 384
    gx = np.clip((px / SIZE * G).astype(int), 0, G - 1)
    gy = np.clip((py / SIZE * G).astype(int), 0, G - 1)
    zbuf = np.full((G, G), np.inf)
    np.minimum.at(zbuf, (gy, gx), depth)
    zbuf = ndimage.minimum_filter(zbuf, size=3)

    def visible_at(Pr_, Nr_, px_, py_, depth_):
        gx_ = np.clip((px_ / SIZE * G).astype(int), 0, G - 1)
        gy_ = np.clip((py_ / SIZE * G).astype(int), 0, G - 1)
        to_cam = np.stack([DIST - Pr_[:, 0], -Pr_[:, 1], -Pr_[:, 2]], 1)
        to_cam /= np.linalg.norm(to_cam, axis=1, keepdims=True)
        xi = np.clip(px_.astype(int), 0, SIZE - 1)
        yi = np.clip(py_.astype(int), 0, SIZE - 1)
        vis = (depth_ <= zbuf[gy_, gx_] + 0.012) & ((Nr_ * to_cam).sum(1) > 0.12) & alpha[yi, xi]
        return vis, xi, yi

    visible, xi, yi = visible_at(Pr, Nr, px, py, depth)
    cls = raw_cls[raw_tree.query(Pr)[1]]
    cls[visible] = classify(im[yi[visible], xi[visible]])
    vis_any = visible.copy()
    # symétrie : la face cachée reprend la couleur vue sur son reflet
    for axis in ([] if True else mirrored):
        Pm2, Nm2 = P3m.copy(), N3m.copy()
        Pm2[:, axis] *= -1
        Nm2[:, axis] *= -1
        Pr2, Nr2, px2, py2, d2 = sample(Pm2, Nm2)
        vis2, xi2, yi2 = visible_at(Pr2, Nr2, px2, py2, d2)
        use = ~vis_any & vis2
        cls[use] = classify(im[yi2[use], xi2[use]])
        vis_any |= use
    # lissage des grands aplats dans l'espace 3D (et non dans la texture, où les îlots UV sont morcelés) :
    # chaque texel prend la teinte principale majoritaire autour de lui, dans un rayon d'environ 25 cm
    bigc = np.array([NAMES.index(k) for k in ('yellow', 'green', 'blue')])
    isbig = np.isin(cls, bigc)
    rng = np.random.default_rng(0)
    ref = np.flatnonzero(isbig)
    ref = ref[rng.choice(len(ref), min(len(ref), 150000), replace=False)]
    tree = cKDTree(P3m[ref])
    _, nn = tree.query(P3m, k=48, distance_upper_bound=0.25 * max(1.0, max(dims) / 6))
    valid = nn < len(ref)
    nn_cls = np.where(valid, cls[ref][np.minimum(nn, len(ref) - 1)], -1)
    votes = np.stack([(nn_cls == c).sum(1) for c in bigc], 1)
    smooth_big = bigc[votes.argmax(1)]
    has = votes.sum(1) > 0
    # les détails réellement vus (logos, prises) restent ; tout le reste prend la teinte lissée
    keep_detail = visible & ~isbig
    cls = np.where(keep_detail | ~has, cls, smooth_big)
    # carte des teintes (mêmes règles que bake.py : fond en trois teintes, détails nets, petites taches retirées)
    lab = np.full((T, T), -1, np.int64)
    lab[filled] = cls
    vis = np.zeros((T, T), bool)
    vis[filled] = vis_any
    K = len(NAMES)
    big = [NAMES.index(k) for k in ('yellow', 'green', 'blue')]

    def mode(lbl, size, classes):
        return np.array(classes)[np.stack([ndimage.uniform_filter((lbl == k).astype(np.float32), size) for k in classes], -1).argmax(-1)]

    base = np.where(vis, mode(lab, 17, big), mode(lab, 31, big))
    base = mode(base, 9, big)
    fine = mode(lab, 3, list(range(K)))
    seen = np.zeros((T, T), bool)
    seen[filled] = visible
    detail = seen & ~np.isin(fine, big) & (ndimage.uniform_filter((lab == fine).astype(np.float32), 3) > 0.55)
    red = NAMES.index('red')
    detail &= ~((fine == red) & (ndimage.uniform_filter((lab == red).astype(np.float32), 15) > 0.5))
    lab2 = np.where(filled, np.where(detail, fine, base), -1)
    min_big = int(0.003 * T * T)
    for k in range(K):
        comp, n = ndimage.label(lab2 == k)
        if not n:
            continue
        sizes = np.bincount(comp.ravel())
        small = sizes < (min_big if k in big else 60)
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
    out = trimesh.Trimesh(vertices=V, faces=F, process=False)
    out.visual = trimesh.visual.TextureVisuals(uv=uvs, material=trimesh.visual.material.PBRMaterial(baseColorTexture=texture, metallicFactor=0.0, roughnessFactor=0.45))
    return out, {'sym': sym, 'mirrored': ['xz'[a // 2] for a in mirrored], 'visible': round(float(vis_any.mean()), 2), 'ext': [round(x, 2) for x in out.extents]}


if __name__ == '__main__':
    work, dst = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    os.makedirs(dst, exist_ok=True)
    for f in sorted(os.listdir(f'{work}/raw')):
        mid = os.path.splitext(f)[0]
        if (only and mid not in only) or mid not in DIMS:
            continue
        t0 = time.time()
        try:
            mesh, info = bake2(mid, f'{work}/raw/{f}', f'{work}/input/{mid}.png')
            mesh.export(f'{dst}/{mid}.glb', include_normals=True)
            info['s'] = round(time.time() - t0, 1)
            print(mid, info, flush=True)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            print(mid, 'ERREUR', repr(e), flush=True)
