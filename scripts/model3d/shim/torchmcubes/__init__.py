"""Remplace torchmcubes (à compiler) par le marching cubes de scikit-image, même interface."""
import numpy as np
import torch
from skimage.measure import marching_cubes as _mc


def marching_cubes(vol, thresh):
    v = vol.detach().cpu().numpy().astype(np.float32)
    verts, faces, _, _ = _mc(v, level=thresh)
    # torchmcubes renvoie les sommets en (k, j, i) : TripoSR les remet ensuite en (i, j, k)
    verts = verts[:, ::-1].copy()
    return torch.from_numpy(verts.astype(np.float32)), torch.from_numpy(faces[:, ::-1].astype(np.int64).copy())
