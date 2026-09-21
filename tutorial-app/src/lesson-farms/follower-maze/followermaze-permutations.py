from itertools import permutations

# world: connected {10,20}
# seq1 F 10->20 ; seq2 S 20 ; seq3 U 10->20 ; seq4 S 20
EVENTS = {
    1: ("F", 10, 20),
    2: ("S", 20, None),
    3: ("U", 10, 20),
    4: ("S", 20, None),
}
CONNECTED = {10, 20}

def run(order):
    """Apply corpus semantics in the given processing order."""
    followers = {}  # followed -> set(followers)
    out = []
    for s in order:
        kind, a, b = EVENTS[s]
        if kind == "F":
            followers.setdefault(b, set()).add(a)
            if b in CONNECTED: out.append((b, s))
        elif kind == "U":
            followers.setdefault(b, set()).discard(a)
        elif kind == "S":
            for u in sorted(followers.get(a, set())):
                if u in CONNECTED: out.append((u, s))
    return sorted(out)

required = run([1,2,3,4])          # sequence order = entailed trace
print("required:", required)

rows = []
for p in permutations([1,2,3,4]):
    naive = run(list(p))           # process-on-arrival
    missing  = [d for d in required if d not in naive]
    forbidden= [d for d in naive if d not in required]
    flags = []
    flags += [f"fm-missing-delivery(seq={s},user={u})"   for u,s in missing]
    flags += [f"fm-forbidden-delivery(seq={s},user={u})" for u,s in forbidden]
    rows.append((p, flags))

passes = [p for p,f in rows if not f]
fails  = [(p,f) for p,f in rows if f]
print(f"\nnaive (process-on-arrival): {len(passes)} pass / {len(fails)} fail of 24")
print("passing permutations:", passes)

from collections import Counter
c = Counter(f.split("(")[0] for _,fl in rows for f in fl)
print("\nflag kinds raised:", dict(c))
print("\nbaseline [1,2,3,4] naive flags:", dict(rows)[(1,2,3,4)])
print("report's case [4,2,3,1] naive flags:", dict(rows)[(4,2,3,1)])

# sanity: correct (sequence-aware) impl over every arrival order
print("\ncorrect impl passes all 24:", all(run(sorted(p))==required for p in permutations([1,2,3,4])))

print("\n--- per-permutation categories ---")
cat = {"pass":[], "missing":[], "forbidden":[], "both":[]}
for p, fl in rows:
    m = any("missing" in f for f in fl)
    fb = any("forbidden" in f for f in fl)
    k = "both" if (m and fb) else "missing" if m else "forbidden" if fb else "pass"
    cat[k].append("".join(map(str,p)))
for k,v in cat.items():
    print(f"{k:9} {len(v):2}  {v}")
