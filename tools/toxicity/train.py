"""Train and score the chat toxicity model on the prepared features.

    python -I tools/toxicity/train.py <prepared dir> [--bits 16] [--epochs 2] [--save name]
                                      [--arc <private dir> --arc-weight 10] [--stream]

The model is one weight row per hash bucket, five outputs (toxic,
discrimination, sexual, hostility, profanity), trained with soft labels: the
share of annotators who said yes. A label a source does not give is masked out
of the loss. Scores are reported on the public test split per category,
against today's word list on the same lines, and after int8 rounding, since
int8 is what ships.

With --arc (the private folder from prep_archive.py) the server's own chat is
used too. One model is trained per fold of sessions with that fold held out,
so every archive line is scored by a model that never saw its session; the
levels are set on those scores, and a final model is trained on everything.
The archive labels come from a local model and are NOT checked by a person:
those numbers say how well this model copies its teacher. Nothing here prints
or keeps an archive line.

The per-piece value MUST match channelScale() in core/toxfeatures.js: one over
the square root of the channel's count for letters, words and squashed, and 1
for shape. --scale none drops the square root, for comparison only.
"""
import argparse
import json
import re
import site
import sys
import time
from pathlib import Path

sys.path.append(site.getusersitepackages())
import numpy as np
import torch
import torch.nn.functional as F

LABELS = ["toxic", "discrimination", "sexual", "hostility", "profanity"]
# chatfilter.js categories in its order, and the model output each one matches.
WORDLIST = [("discrimination", 1), ("sexual", 2), ("hostility", 3), ("profanity", 4)]
IDENTITY = {
    "gay": r"\b(gay|lesbian|homosexual|lgbt\w*|queer)\b", "trans": r"\btrans(gender)?\b",
    "black": r"\bblacks?\b", "white": r"\bwhites?\b", "muslim": r"\b(muslims?|islam\w*)\b",
    "jewish": r"\b(jews?|jewish)\b", "women": r"\b(wom[ae]n|girls?|female)\b",
}
TARGETS = (0.95, 0.85, 0.70)      # precision for the Low, Medium and High levels
MIN_ARCHIVE_POSITIVES = 15        # flagged archive lines an output needs before its levels come from the archive

ap = argparse.ArgumentParser()
ap.add_argument("dir")
ap.add_argument("--bits", type=int, default=16)
ap.add_argument("--scale", choices=["sqrt", "none"], default="sqrt")
ap.add_argument("--epochs", type=int, default=2)
ap.add_argument("--batch", type=int, default=2048)
ap.add_argument("--lr", type=float, default=0.05)
ap.add_argument("--l2", type=float, default=0.0)
ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
ap.add_argument("--save", default="")
ap.add_argument("--arc", default="", help="private folder with archive_all (prep_archive.py)")
ap.add_argument("--arc-weight", type=float, default=0.0, help="how much one archive line counts against one public line; 0 = score on the archive only")
ap.add_argument("--limit-train", type=int, default=0, help="use only the first N public training rows (quick checks)")
ap.add_argument("--stream", action="store_true", help="keep the training pieces in RAM and send each batch to the GPU, so training fits beside another GPU job")
args = ap.parse_args()
D = Path(args.dir)
dev = torch.device(args.device)
torch.manual_seed(1)
K = len(LABELS)


FEATURES_SEEN = set()   # the feature version of every split loaded


def load(split, d=None, keep_text=True):
    d = Path(d) if d else D
    meta = json.loads((d / f"{split}.meta.json").read_text())
    FEATURES_SEEN.add(meta.get("featureVersion"))
    hashes = np.fromfile(d / f"{split}.hash.u32", dtype=np.uint32)
    counts = np.fromfile(d / f"{split}.cnt.u16", dtype=np.uint16).reshape(-1, 4).astype(np.int64)
    assert len(hashes) == meta["total"] and len(counts) == meta["rows"], split
    y, w, src, text, fold = [], [], [], [], []
    with open(d / f"{split}.jsonl", encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            y.append([np.nan if v is None else v for v in r["y"]])
            w.append(r["w"])
            src.append(r["s"])
            fold.append(r.get("f", -1))
            # Archive text is never kept: nothing here may print or return a line.
            text.append(r["t"] if keep_text and split != "train" else "")
    if args.scale == "sqrt":
        per = np.where(counts > 0, 1 / np.sqrt(np.maximum(counts, 1)), 0.0)
        per[:, 3] = 1.0
    else:
        per = np.ones_like(counts, dtype=np.float64)
    vals = np.repeat(per.reshape(-1).astype(np.float32), counts.reshape(-1))
    vals *= (1 - 2 * (hashes >> 31).astype(np.int8)).astype(np.float32)
    idx = (hashes & ((1 << args.bits) - 1)).astype(np.int32)
    offsets = np.zeros(len(counts) + 1, dtype=np.int64)
    np.cumsum(counts.sum(axis=1), out=offsets[1:])
    return dict(idx=idx, vals=vals, off=offsets, y=np.array(y, dtype=np.float32), w=np.array(w, dtype=np.float32),
                src=np.array(src), text=text, f=np.array(fold))


def subset(d, rows):
    rows = np.asarray(rows)
    starts, ends = d["off"][rows], d["off"][rows + 1]
    off = np.zeros(len(rows) + 1, dtype=np.int64)
    np.cumsum(ends - starts, out=off[1:])
    return dict(idx=np.concatenate([d["idx"][s:e] for s, e in zip(starts, ends)]),
                vals=np.concatenate([d["vals"][s:e] for s, e in zip(starts, ends)]),
                off=off, y=d["y"][rows], w=d["w"][rows], src=d["src"][rows], text=[""] * len(rows), f=d["f"][rows])


def to_dev(d, where=None):
    where = where or dev
    return dict(idx=torch.from_numpy(d["idx"]).to(where), vals=torch.from_numpy(d["vals"]).to(where),
                off=torch.from_numpy(d["off"]).to(where))


def extra_of(d):
    return dict(dev=to_dev(d), n=len(d["w"]), y=torch.from_numpy(np.nan_to_num(d["y"])).to(dev),
                m=torch.from_numpy((~np.isnan(d["y"])).astype(np.float32)).to(dev), w=torch.from_numpy(d["w"]).to(dev))


def logits_of(W, b, dd, lo, hi):
    # Slices move to the weights' device; a no-op unless the pieces stay in RAM (--stream).
    p0, p1 = int(dd["off"][lo]), int(dd["off"][hi])
    offs = (dd["off"][lo:hi] - p0).to(torch.int32).to(W.device)
    bag = F.embedding_bag(dd["idx"][p0:p1].to(W.device), W, offs, mode="sum",
                          per_sample_weights=dd["vals"][p0:p1].to(W.device))
    return bag + b


def predict(W, b, dd, rows):
    out = []
    with torch.no_grad():
        for lo in range(0, rows, 16384):
            out.append(logits_of(W, b, dd, lo, min(rows, lo + 16384)).float().cpu())
    return torch.cat(out).numpy() if out else np.zeros((0, K), dtype=np.float32)


# ---------------------------------------------------------------- metrics

def auc(score, label):
    pos = label.sum()
    neg = len(label) - pos
    if pos == 0 or neg == 0:
        return float("nan")
    order = np.argsort(score, kind="mergesort")
    ranks = np.empty(len(score))
    ranks[order] = np.arange(1, len(score) + 1)
    s = score[order]
    edges = np.flatnonzero(np.diff(s)) + 1
    starts = np.concatenate([[0], edges])
    ends = np.concatenate([edges, [len(s)]])
    for a, z in zip(starts, ends):
        if z - a > 1:
            ranks[order[a:z]] = (a + 1 + z) / 2
    return float((ranks[label].sum() - pos * (pos + 1) / 2) / (pos * neg))


def pr_curve(score, label):
    order = np.argsort(-score, kind="mergesort")
    l = label[order]
    tp = np.cumsum(l)
    fp = np.cumsum(~l)
    return tp / np.maximum(tp + fp, 1), tp / max(l.sum(), 1), score[order]


def avg_precision(score, label):
    if label.sum() == 0:
        return float("nan")
    p, _, _ = pr_curve(score, label)
    return float(p[label[np.argsort(-score, kind="mergesort")]].mean())


def recall_at_precision(score, label, target):
    p, r, s = pr_curve(score, label)
    ok = np.flatnonzero(p >= target)
    return (float(r[ok[-1]]), float(s[ok[-1]])) if len(ok) else (0.0, float("inf"))


def precision_at_recall(score, label, target):
    p, r, _ = pr_curve(score, label)
    ok = np.flatnonzero(r >= target)
    return float(p[ok[0]]) if len(ok) else 0.0


# ---------------------------------------------------------------- train

t0 = time.time()
train, val, test = load("train"), load("val"), load("test")
if args.limit_train:
    n = args.limit_train
    train = subset(train, np.arange(n))
print(f"loaded in {time.time() - t0:.0f} s: train {len(train['w']):,} rows, {len(train['idx']):,} pieces")
dtr = to_dev(train, torch.device("cpu") if args.stream else dev)
dva, dte = to_dev(val), to_dev(test)
ytr = torch.from_numpy(np.nan_to_num(train["y"])).to(dev)
mtr = torch.from_numpy((~np.isnan(train["y"])).astype(np.float32)).to(dev)
wtr = torch.from_numpy(train["w"]).to(dev)
ROWS = len(train["w"])
BATCHES = (ROWS + args.batch - 1) // args.batch
BASE = np.nanmean(train["y"], axis=0).clip(1e-3, 1 - 1e-3)


def val_aucs(W, b):
    lv = predict(W, b, dva, len(val["w"]))
    out = []
    for k in range(K):
        m = ~np.isnan(val["y"][:, k])
        out.append(auc(lv[m, k], val["y"][m, k] >= 0.5))
    return out


def fit(extra=None, label=""):
    """Train one model; `extra` mixes a slice of archive lines into every step.
    The last epoch is kept (the learning rate ends near zero)."""
    W = torch.zeros((1 << args.bits, K), device=dev, requires_grad=True)
    b = torch.tensor(np.log(BASE / (1 - BASE)), dtype=torch.float32, device=dev, requires_grad=True)
    opt = torch.optim.Adam([W, b], lr=args.lr)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.epochs * BATCHES, pct_start=0.1)
    for epoch in range(args.epochs):
        t1 = time.time()
        total = 0.0
        for step, bi in enumerate(torch.randperm(BATCHES).tolist()):
            lo, hi = bi * args.batch, min(ROWS, (bi + 1) * args.batch)
            z = logits_of(W, b, dtr, lo, hi)
            el = F.binary_cross_entropy_with_logits(z, ytr[lo:hi], reduction="none") * mtr[lo:hi]
            num = (el.sum(dim=1) * wtr[lo:hi]).sum()
            den = (mtr[lo:hi].sum(dim=1) * wtr[lo:hi]).sum()
            if extra is not None and extra["n"] and args.arc_weight > 0:
                # A slice of the archive rides along in every step: about one
                # pass over it per epoch, mixed in rather than bunched at the end.
                per = max(1, -(-extra["n"] // BATCHES))
                a0 = (step * per) % extra["n"]
                a1 = min(extra["n"], a0 + per)
                za = logits_of(W, b, extra["dev"], a0, a1)
                la = F.binary_cross_entropy_with_logits(za, extra["y"][a0:a1], reduction="none") * extra["m"][a0:a1]
                num = num + args.arc_weight * (la.sum(dim=1) * extra["w"][a0:a1]).sum()
                den = den + args.arc_weight * (extra["m"][a0:a1].sum(dim=1) * extra["w"][a0:a1]).sum()
            loss = num / den.clamp(min=1)
            if args.l2:
                loss = loss + args.l2 * (W * W).sum()
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            total += float(loss)
        if label is not None:
            a = val_aucs(W, b)
            print(f"{label}epoch {epoch + 1}: loss {total / BATCHES:.4f}, public val AUC " +
                  " ".join(f"{LABELS[k][:4]} {a[k]:.4f}" for k in range(K)) + f", {time.time() - t1:.0f} s")
    return W.detach().clone(), b.detach().clone()


allx, oof = None, None
if args.arc:
    allx = load("archive_all", args.arc, keep_text=False)
    folds = sorted(set(allx["f"].tolist()))
    print(f"archive: {len(allx['w']):,} lines in {len(folds)} folds of sessions; weight {args.arc_weight:g}")
    oof = np.zeros((len(allx["w"]), K), dtype=np.float32)
    if args.arc_weight > 0:
        for f in folds:
            keep, held = np.flatnonzero(allx["f"] != f), np.flatnonzero(allx["f"] == f)
            Wk, bk = fit(extra_of(subset(allx, keep)), label=None)
            oof[held] = predict(Wk, bk, to_dev(subset(allx, held)), len(held))
            print(f"   fold {f}: {len(held):,} lines scored by a model that never saw them")
        Wf, bf = fit(extra_of(allx), label="final ")
    else:
        Wf, bf = fit(None)
        oof[:] = predict(Wf, bf, to_dev(allx), len(allx["w"]))
else:
    Wf, bf = fit(None)


# ---------------------------------------------------------------- report

def quantise(Wt):
    scale = Wt.abs().amax(dim=0) / 127
    return torch.round(Wt / scale).clamp(-127, 127) * scale


Wq = quantise(Wf)
lt = predict(Wf, bf, dte, len(test["w"]))
ltq = predict(Wq, bf, dte, len(test["w"]))
lv = predict(Wf, bf, dva, len(val["w"]))
yt, src = test["y"], test["src"]
lengths = np.array([len(t) for t in test["text"]])
# Every split must come from the same feature code, or the weights would be
# trained on one reading of the text and scored on another.
assert len(FEATURES_SEEN) == 1, f"splits were featurized by different feature versions: {FEATURES_SEEN}; rerun featurize.mjs"
report = {"args": vars(args), "featureVersion": next(iter(FEATURES_SEEN)), "categories": {}}

print("\nPUBLIC TEST, per category (label = at least half the annotators said yes)")
print(f"{'category':15} {'AUC':>7} {'int8':>7} {'AP':>6} {'cc':>7} {'cc<=64':>7} {'mhs':>7} {'hx':>7}  recall@precision at levels from public val")
for k, lab in enumerate(LABELS):
    m = ~np.isnan(yt[:, k])
    y = yt[:, k] >= 0.5
    row = {"auc": auc(lt[m, k], y[m]), "auc_int8": auc(ltq[m, k], y[m]), "ap": avg_precision(lt[m, k], y[m])}
    for name, sel in [("cc", src == "cc"), ("cc<=64", (src == "cc") & (lengths <= 64)), ("mhs", src == "mhs"), ("hx", src == "hx")]:
        s = m & sel
        row[name] = auc(lt[s, k], y[s]) if s.sum() and y[s].any() else float("nan")
    mv = ~np.isnan(val["y"][:, k])
    levels = {}
    for target in TARGETS:
        _, thr = recall_at_precision(lv[mv, k], val["y"][mv, k] >= 0.5, target)
        held = lt[m, k] >= thr
        tp = (held & y[m]).sum()
        levels[target] = {"threshold": thr, "precision": float(tp / max(held.sum(), 1)),
                          "recall": float(tp / max(y[m].sum(), 1)), "held_share": float(held.mean())}
    row["levels"] = levels
    report["categories"][lab] = row
    lv_txt = " ".join(f"{levels[t]['recall']:.2f}@{levels[t]['precision']:.2f}" for t in TARGETS)
    print(f"{lab:15} {row['auc']:7.4f} {row['auc_int8']:7.4f} {row['ap']:6.3f} " +
          " ".join(f"{row[n]:7.4f}" for n in ["cc", "cc<=64", "mhs", "hx"]) + f"  {lv_txt}")

wl = np.fromfile(D / "test.wl.u16", dtype=np.uint16)
print("\nWORD LIST (shipped terms only) vs MODEL on the same public test lines")
print(f"{'category':15} {'level':>5} {'held':>6} {'list P':>7} {'list R':>7} | {'model R at list P':>17} {'model P at list R':>17}")
report["wordlist"] = {}
for ci, (lab, k) in enumerate(WORDLIST):
    m = ~np.isnan(yt[:, k])
    y = yt[m, k] >= 0.5
    for level in (1, 2, 3):
        hit = ((wl[m] >> (ci * 3 + level - 1)) & 1).astype(bool)
        if not hit.any():
            print(f"{lab:15} {level:5} {0:6} {'-':>7} {0:7.3f} | (the shipped list has no terms here)")
            continue
        tp = (hit & y).sum()
        P, R = tp / hit.sum(), tp / max(y.sum(), 1)
        mR, _ = recall_at_precision(lt[m, k], y, P)
        mP = precision_at_recall(lt[m, k], y, R)
        report["wordlist"][f"{lab}-{level}"] = dict(held=int(hit.sum()), P=float(P), R=float(R), model_R_at_P=mR, model_P_at_R=mP)
        print(f"{lab:15} {level:5} {int(hit.sum()):6} {P:7.3f} {R:7.3f} | {mR:17.3f} {mP:17.3f}")

tpl = src == "tpl"
neg = tpl & (np.nansum(yt, axis=1) == 0)
print(f"\nTRAPS: {neg.sum()} held-out template lines with no label; share each category would hold at precision .85 / .70:")
for k, lab in enumerate(LABELS):
    t85 = report["categories"][lab]["levels"][0.85]["threshold"]
    t70 = report["categories"][lab]["levels"][0.70]["threshold"]
    print(f"   {lab:15} {np.mean(lt[neg, k] >= t85):.1%} / {np.mean(lt[neg, k] >= t70):.1%}")

print("\nIDENTITY on Civil Comments test, toxic: subgroup AUC, BPSN (low = false alarms on mentions), BNSP")
cc = src == "cc"
y0 = yt[:, 0] >= 0.5
lower = np.array([t.lower() for t in test["text"]])
report["identity"] = {}
for g, pat in IDENTITY.items():
    rx = re.compile(pat)
    has = np.array([bool(rx.search(t)) for t in lower]) & cc
    if has.sum() < 50 or not y0[has].any():
        continue
    sub = auc(lt[has, 0], y0[has])
    bpsn_sel = cc & ((has & ~y0) | (~has & y0))
    bnsp_sel = cc & ((has & y0) | (~has & ~y0))
    bpsn, bnsp = auc(lt[bpsn_sel, 0], y0[bpsn_sel]), auc(lt[bnsp_sel, 0], y0[bnsp_sel])
    report["identity"][g] = dict(n=int(has.sum()), subgroup=sub, bpsn=bpsn, bnsp=bnsp)
    print(f"   {g:8} n={has.sum():5}  subgroup {sub:.3f}  BPSN {bpsn:.3f}  BNSP {bnsp:.3f}")

if allx is not None:
    ya = allx["y"]
    wla = np.fromfile(Path(args.arc) / "archive_all.wl.u16", dtype=np.uint16)
    print(f"\nARCHIVE: all {len(ya):,} lines, each scored by a model that never saw its session. Labels from the local model, NOT checked by a person.")
    print(f"{'category':15} {'flagged':>7} {'AUC':>7} {'AP':>6}  held / rightly held at levels set on these scores (.95 / .85 / .70) | at the public Medium level")
    report["archive"], arc_levels = {}, {}
    for k, lab in enumerate(LABELS):
        yk = ya[:, k] >= 0.5
        row = {"flagged": int(yk.sum()), "auc": auc(oof[:, k], yk), "ap": avg_precision(oof[:, k], yk)}
        levels = {}
        for target in TARGETS:
            rec, thr = recall_at_precision(oof[:, k], yk, target) if yk.any() else (0.0, float("inf"))
            held = oof[:, k] >= thr
            levels[target] = {"threshold": thr, "held": int(held.sum()), "right": int((held & yk).sum()), "recall": rec}
        pub = report["categories"][lab]["levels"][0.85]["threshold"]
        pub_held = oof[:, k] >= pub
        row["levels"], row["public_medium"] = levels, {"held": int(pub_held.sum()), "right": int((pub_held & yk).sum())}
        arc_levels[lab] = levels
        report["archive"][lab] = row
        cells = "   ".join(f"{levels[t]['held']}/{levels[t]['right']}" for t in TARGETS)
        print(f"{lab:15} {int(yk.sum()):7} {row['auc']:7.4f} {row['ap']:6.3f}  {cells} | {int(pub_held.sum())}/{int((pub_held & yk).sum())}")
    # What the teacher said about the lines this model rates highest, as counts:
    # mostly "mild" means the two disagree about banter; mostly "none" means
    # this model flags innocent lines.
    print("The 50 lines each output rates highest, by the local model's severity (none / mild / clear / severe):")
    report["archive_top50"] = {}
    for k, lab in enumerate(LABELS):
        top = np.argsort(-oof[:, k], kind="mergesort")[:50]
        sev = ya[top, k]
        c = [int(np.sum(np.isclose(sev, v))) for v in (0.0, 0.3, 0.8, 1.0)]
        report["archive_top50"][lab] = c
        print(f"   {lab:15} {c[0]:3} / {c[1]:3} / {c[2]:3} / {c[3]:3}")
    print("Word list on the same archive lines (shipped terms, level 2), held / rightly held:")
    report["archive_wordlist"] = {}
    for ci, (lab, k) in enumerate(WORDLIST):
        hit = ((wla >> (ci * 3 + 1)) & 1).astype(bool)
        yk = ya[:, k] >= 0.5
        tp = int((hit & yk).sum())
        if hit.any() and yk.any():
            P, R = tp / hit.sum(), tp / yk.sum()
            mR = recall_at_precision(oof[:, k], yk, P)[0]
            mP = precision_at_recall(oof[:, k], yk, R) if R > 0 else float("nan")
        else:
            P = R = mR = mP = float("nan")
        report["archive_wordlist"][lab] = dict(held=int(hit.sum()), right=tp, model_R_at_P=mR, model_P_at_R=mP)
        print(f"   {lab:15} list {int(hit.sum())}/{tp}, recall {tp / max(int(yk.sum()), 1):.2f}; model recall at the list's precision {mR:.2f}, model precision at the list's recall {mP:.2f}")
    # An output with too few flagged archive lines keeps its public levels: a
    # level set on a handful of lines is noise, and no level at all would mean
    # that output never holds anything in game.
    report["export_levels"], report["levels_from"] = {}, {}
    for lab in LABELS:
        if report["archive"][lab]["flagged"] >= MIN_ARCHIVE_POSITIVES:
            report["export_levels"][lab] = {str(t): v["threshold"] for t, v in arc_levels[lab].items()}
            report["levels_from"][lab] = "archive"
        else:
            report["export_levels"][lab] = {str(t): report["categories"][lab]["levels"][t]["threshold"] for t in TARGETS}
            report["levels_from"][lab] = "public"
    print("levels come from: " + ", ".join(f"{lab} {s}" for lab, s in report["levels_from"].items()))

nz = int((Wf.abs().sum(dim=1) > 0).sum())
print(f"\nbuckets used {nz:,} of {1 << args.bits:,}; int8 weights {((1 << args.bits) * K) / 1024:.0f} KiB raw")
if args.save:
    out = D.parent / "models" / args.save
    out.mkdir(parents=True, exist_ok=True)
    np.savez(out / "model.npz", W=Wf.cpu().numpy(), b=bf.cpu().numpy(), bits=args.bits)
    (out / "report.json").write_text(json.dumps(report, indent=1, default=float))
    print("saved", out)
