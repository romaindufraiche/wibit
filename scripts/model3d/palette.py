import sys, glob, numpy as np
from PIL import Image
px = []
for f in sorted(glob.glob(sys.argv[1] + '/*')):
    im = Image.open(f).convert('RGBA'); im.thumbnail((200, 200))
    a = np.asarray(im).reshape(-1, 4).astype(float)
    a = a[a[:, 3] > 200][:, :3]
    # fond blanc des JPEG et ombres grises exclus
    sat = a.max(1) - a.min(1)
    a = a[(sat > 40) | (a.mean(1) < 90)]
    px.append(a)
X = np.concatenate(px)
rng = np.random.default_rng(0)
X = X[rng.choice(len(X), min(len(X), 200000), replace=False)]
k = 8
C = X[rng.choice(len(X), k, replace=False)]
for _ in range(30):
    d = ((X[:, None] - C[None]) ** 2).sum(-1); lab = d.argmin(1)
    C = np.array([X[lab == i].mean(0) if (lab == i).any() else C[i] for i in range(k)])
cnt = np.bincount(lab, minlength=k)
for i in np.argsort(-cnt):
    r, g, b = C[i].round().astype(int)
    print(f'#{r:02x}{g:02x}{b:02x}  {cnt[i]/len(X)*100:5.1f} %')
