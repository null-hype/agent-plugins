"""yoars run -> delta-zero --summarize / --full JSON, one pair per handoff.

usage: python3 -I adapters/yoars.py RUN_DIR SEQ OUT_PREFIX
       python3 -I adapters/yoars.py RUN_DIR SEQ OUT_PREFIX --cap 1500

RUN_DIR is one run of the yoars corpus (Zenodo 23755352, CC BY 4.0), e.g.
runs/deepseek-flash-225035. SEQ is the `seq` of a room-ledger message in
messages.json. The ledger message is the "summary": the sender's own condensed
account, posted to the other agents. The "full" is the sender's session
(session-<role>.jsonl) from its start up to the moment it posted that message.

Nothing is generated here. The summary is the sender's own ledger text, and the
full is the sender's own session, in order:
  USER      the prompt or a harness message
  AGENT     assistant text
  AGENT     "[tool] name {args}" for each tool call (the call that posted the
            ledger message itself is left out)
  USER      "[result] ..." tool output, cut to --cap characters (default 1500)
Thinking blocks and bookkeeping records ("custom") are not included.
"""
import argparse, json, os, sys


def load(p):
    with open(p) as fh:
        return json.load(fh)


def entries(path):
    for line in open(path):
        d = json.loads(line)
        if d.get("type") != "message":
            continue
        m = d["message"]
        c = m["content"]
        if isinstance(c, str):
            c = [{"type": "text", "text": c}]
        yield d["timestamp"], m["role"], c


def session_messages(path, until, body, cap):
    out = []
    for ts, role, parts in entries(path):
        if ts >= until:
            break
        for p in parts:
            t = p.get("type")
            if t == "text" and p.get("text", "").strip():
                if role == "assistant":
                    out.append(("assistant", p["text"].strip(), ts))
                elif role == "toolResult":
                    s = p["text"].strip()
                    out.append(("user", "[result] " + (s if len(s) <= cap else s[:cap] + " ...[cut]"), ts))
                else:
                    out.append(("user", p["text"].strip(), ts))
            elif t == "toolCall":
                a = p.get("arguments") or {}
                if body[:60] and str(a.get("body", "")).startswith(body[:60]):
                    continue
                out.append(("assistant", f"[tool] {p.get('name')} {json.dumps(a)}", ts))
    return out


def build(run, seq, cap=1500):
    msgs = load(os.path.join(run, "messages.json"))
    handles = {x["principal_id"]: x["handle"] for x in load(os.path.join(run, "principals.json"))}
    m = next(x for x in msgs if x["seq"] == seq)
    role = handles[m["sender_principal_id"]].rsplit("/", 1)[-1]
    until = m["created_at"].replace("+00:00", "Z")
    sess = session_messages(os.path.join(run, f"session-{role}.jsonl"), until, m["body"], cap)
    name = f"yoars {os.path.basename(run.rstrip('/'))}: {role} ledger message {seq}"
    mid = f"yoars-{os.path.basename(run.rstrip('/'))}-{seq}"
    buf, mlist, n = "", [], 0
    for i, (r, text, ts) in enumerate(sess, 1):
        b = len(buf.encode())
        buf += text
        mlist.append({"number": i, "role": "user" if r == "user" else "assistant",
                      "start_byte": b, "end_byte": len(buf.encode()), "created_at_utc": ts})
    full = [{"id": mid, "name": name, "buffer": buf, "transcript_sections": [],
             "generated_title": name, "summary": m["body"], "comments": [], "participant_names": [role],
             "messages": mlist}]
    summ = [{"id": mid, "name": name, "transcript": f"--------\nAGENT\n--------\n{m['body']}\n\n",
             "messages": [{"number": 1, "role": "assistant", "start_byte": 1, "end_byte": len(m["body"].encode()) + 1,
                           "created_at_utc": m["created_at"]}],
             "generated_title": name, "summary": m["body"], "keywords": [], "intents": [],
             "summary_is_fresh": True}]
    return summ, full, role


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("run"); ap.add_argument("seq", type=int); ap.add_argument("prefix")
    ap.add_argument("--cap", type=int, default=1500)
    a = ap.parse_args()
    s, f, role = build(a.run, a.seq, a.cap)
    os.makedirs(os.path.dirname(os.path.abspath(a.prefix)), exist_ok=True)
    json.dump(s, open(a.prefix + "-summarize.json", "w"), indent=1)
    json.dump(f, open(a.prefix + "-full.json", "w"), indent=1)
    print(f"{role} -> {len(f[0]['messages'])} session messages, summary {len(s[0]['summary'])} chars")
