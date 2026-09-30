import json
import glob
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TRACES = sorted(glob.glob(os.path.join(HERE, "..", "traces", "*.json")))
DATA = os.path.join(HERE, "error_discovery_data")
os.makedirs(DATA, exist_ok=True)

records = []
for f in TRACES:
    with open(f) as fh:
        r = json.load(fh)
    d = r["diagnosis"]
    records.append({
        "id": f.split("/")[-1].replace(".json", ""),
        "rec": r,
        "top": d["hypotheses"][0]["category"] if d["hypotheses"] else "abstain",
        "disp": r["extraction"]["disposition"],
    })

FIXTURES = ["healthy", "missing-prod-config", "bad-start-port", "multi-drift"]
STYLES = ["precise-technical", "vague-urgent", "multi-symptom", "accusatory-demanding", "pasted-log-dump", "non-native-terse"]


def feats(r):
    rec = r["rec"]
    v = [len(rec["ticket"]), len(rec["observations"]), len(rec["diagnosis"]["hypotheses"]), len(rec["diffs"])]
    v += [1.0 if r["disp"] == d else 0.0 for d in ("ready", "needs-evidence", "conflicted")]
    v += [1.0 if rec["meta"]["fixtureId"] == f else 0.0 for f in FIXTURES]
    v += [1.0 if rec["meta"]["style"] == s else 0.0 for s in STYLES]
    return v


X = [feats(r) for r in records]
n, m = len(X), len(X[0])
means = [sum(X[i][j] for i in range(n)) / n for j in range(m)]
sds = []
for j in range(m):
    var = sum((X[i][j] - means[j]) ** 2 for i in range(n)) / n
    sds.append(math.sqrt(var) or 1.0)
Z = [[(X[i][j] - means[j]) / sds[j] for j in range(m)] for i in range(n)]

lens = sorted(len(r["rec"]["ticket"]) for r in records)
hi, lo = lens[-2], lens[1]


def power(mat, iters=200):
    v = [1.0] * len(mat)
    for _ in range(iters):
        v = [sum(mat[i][j] * v[j] for j in range(len(v))) for i in range(len(mat))]
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        v = [x / norm for x in v]
    return v


def project():
    cov = [[sum(Z[i][a] * Z[i][b] for i in range(n)) / n for b in range(m)] for a in range(m)]
    v1 = power(cov)
    lam1 = sum(v1[a] * sum(cov[a][b] * v1[b] for b in range(m)) for a in range(m))
    cov2 = [[cov[a][b] - lam1 * v1[a] * v1[b] for b in range(m)] for a in range(m)]
    v2 = power(cov2)
    p1 = [sum(Z[i][j] * v1[j] for j in range(m)) for i in range(n)]
    p2 = [sum(Z[i][j] * v2[j] for j in range(m)) for i in range(n)]

    def norm(vals):
        a, b = min(vals), max(vals)
        return [(x - a) / (b - a or 1.0) for x in vals]

    return norm(p1), norm(p2)


xs, ys = project()

order = ["s13", "s18", "s06", "s10", "s15", "s05", "s20", "s04", "s07", "s12", "s17", "s08", "s11", "s14", "s16", "s19", "s01", "s02", "s03", "s09"]
by_id = {r["id"]: r for r in records}
samples = []
for sid in order:
    r = by_id[sid]
    rec = r["rec"]
    flags = []
    if len(rec["ticket"]) >= hi:
        flags.append("long ticket")
    if len(rec["ticket"]) <= lo:
        flags.append("short ticket")
    if len(rec["diagnosis"]["hypotheses"]) > 1:
        flags.append("2 hypotheses")
    if rec["diagnosis"]["injectionFlagged"]:
        flags.append("injection flagged")
    samples.append({
        "id": sid,
        "style": rec["meta"]["style"],
        "evidence": rec["meta"]["evidence"],
        "distractor": rec["meta"]["distractor"],
        "fixture": rec["meta"]["fixtureId"],
        "ticket": rec["ticket"],
        "disposition": r["disp"],
        "top": r["top"],
        "expected": rec["extraction"]["expected"],
        "actual": rec["extraction"]["actual"],
        "missing": ", ".join(rec["extraction"]["evidenceRequest"]),
        "nobs": len(rec["observations"]),
        "obs": [{"check": o["checkName"], "outcome": o["outcome"], "detail": o["detail"]} for o in rec["observations"]],
        "diag": rec["diagnosis"],
        "abstention": rec["diagnosis"]["abstention"],
        "flags": flags,
    })

with open(os.path.join(DATA, "samples.json"), "w") as f:
    json.dump(samples, f)

with open(os.path.join(DATA, "graph.json"), "w") as f:
    json.dump({"nodes": [
        {"id": r["id"], "x": xs[i], "y": ys[i], "top": r["top"], "inSample": True}
        for i, r in enumerate(records)
    ]}, f)

suggestions = [
    {"sample": "s10", "quote": "published login broken since today", "text": "Possible over-confidence: vague ticket + only wrong-deployment logs, yet pipeline diagnoses missing-production-config. All supporting evidence is pipeline-generated (probe); none customer-supplied. Should vague tickets cap at needs-evidence until a check runs?", "resolved": False},
    {"sample": "s13", "quote": "Unsure which issue is primary", "text": "Possible over-conservatism: one log conflict discards everything, including uncontested startup-drift evidence (diffs + audit). Should conflict scope to the contested claim instead of blanketing the case?", "resolved": False},
    {"sample": "s18", "quote": "GET / 200 ok (retry)", "text": "Same pattern as s13: a single retry-200 amid timeouts/audit-fail triggers full abstention. Is a lone success log enough to veto two failing signals?", "resolved": False},
    {"sample": "s15", "quote": "you charged my card twice", "text": "Scoping gap: abstention addresses the publishing defect but the billing complaint goes unacknowledged. Should the reply explicitly scope out non-publishing issues?", "resolved": False},
]
with open(os.path.join(DATA, "suggestions.json"), "w") as f:
    json.dump(suggestions, f)

with open(os.path.join(DATA, "patterns.json"), "w") as f:
    json.dump({"candidates": ["over-confidence on vague tickets", "conflict over-conservatism", "out-of-scope scoping gap", "distractor robustness"]}, f)

with open(os.path.join(DATA, "annotations.json"), "w") as f:
    json.dump([], f)

print(f"{len(samples)} samples, {len(suggestions)} suggestions, graph nodes={len(records)}")
