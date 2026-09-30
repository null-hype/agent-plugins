"""Execution/filesystem adapter for the evidence contract.

Pkl (pkl/Evidence.pkl, pkl/Scenario.pkl) is authoritative for the SHAPE of
evidence and for scenario data. This module only does what Pkl cannot: run
the pkl binary, check grounding against a real directory, transform validated
evidence into the state sent to Jev, invoke the installed `jev` client, and
enforce which execution modes may spend money. Standard library only.

Execution modes (never selected by credentials):
  deterministic     canned evidence + mock Jev. Default. Any real call fails.
  live-jev          canned evidence + real Jev.  Needs CONTRACT_ALLOW_REAL_JEV=1.
  full-experiment   agent-collected evidence + real Jev. Needs
                    CONTRACT_ALLOW_REAL_JEV=1, CONTRACT_ALLOW_REASONING_AGENT=1
                    and a runner (REASONING_AGENT_RUNNER).
"""
import json
import os
import shutil
import subprocess
import sys

MODES = ("deterministic", "live-jev", "full-experiment")
MAX_REPEATS = 5
_HERE = os.path.dirname(os.path.abspath(__file__))
_INSTALLED = "/usr/local/share/evidence"


def _first_existing(*paths):
    for p in paths:
        if p and os.path.isdir(p):
            return p
    return paths[-1]


PKL_DIR = _first_existing(os.environ.get("EVIDENCE_PKL"), os.path.join(_INSTALLED, "pkl"),
                          os.path.join(_HERE, "..", "pkl"))


class Rejected(Exception):
    """Evidence failed format or grounding; raised before any Jev call."""

    def __init__(self, errors):
        super().__init__("; ".join(errors))
        self.errors = errors


class RealCallForbidden(Exception):
    """A real (paid) call was attempted where it is not permitted."""


class BoundNotEnforceable(Exception):
    """A requested spend/token bound cannot be enforced by the backend."""


# --- pkl -------------------------------------------------------------------

def pkl_eval(module, expression=None, props=None):
    """Evaluate a module to JSON. Returns (ok, parsed_json_or_None, stderr)."""
    cmd = ["pkl", "eval", "-f", "json", "--module-path", PKL_DIR]
    for k, v in (props or {}).items():
        cmd += ["-p", "%s=%s" % (k, v)]
    if expression:
        cmd += ["-x", expression]
    cmd.append(module)
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    except OSError as e:
        return False, None, "cannot run pkl: %s" % e
    if proc.returncode != 0:
        return False, None, proc.stderr.strip()
    return True, (json.loads(proc.stdout) if proc.stdout.strip() else None), ""


def scenario_view(module, prop):
    ok, val, err = pkl_eval(module, expression="new JsonRenderer {}.renderValue(%s)" % prop)
    if not ok:
        raise RuntimeError("pkl failed evaluating %s of %s: %s" % (prop, module, err))
    return val


# --- format + grounding ----------------------------------------------------

def format_errors(path):
    """Structural validation by Pkl. Returns (errors, normalized evidence dict)."""
    if not os.path.isfile(path):
        return ["cannot read %s" % path], None
    uri = "file://" + os.path.abspath(path)
    ok, doc, err = pkl_eval(os.path.join(PKL_DIR, "Validate.pkl"), props={"evidence.uri": uri})
    if not ok:
        return [l for l in err.splitlines() if l.strip()] or ["invalid evidence"], None
    return [], doc


def grounding_errors(doc, root):
    errs = []
    real_root = os.path.realpath(root)
    for i, f in enumerate(doc["findings"]):
        at = "findings[%d]" % i
        path = os.path.realpath(os.path.join(real_root, f["source_path"].lstrip("/")))
        if os.path.commonpath([real_root, path]) != real_root:
            errs.append("%s: source_path %r escapes the image root" % (at, f["source_path"]))
        elif not os.path.isfile(path):
            errs.append("%s: no such file %r in the image" % (at, f["source_path"]))
        else:
            with open(path, encoding="utf-8", errors="replace") as fh:
                if f["excerpt"] not in fh.read():
                    errs.append("%s: excerpt not found verbatim in %r" % (at, f["source_path"]))
    return errs


def validate(path, root=None):
    """(errors, normalized evidence). Grounding only runs on well-formed evidence."""
    errs, doc = format_errors(path)
    if not errs and root is not None:
        errs = grounding_errors(doc, root)
    return errs, doc


# --- evidence -> Jev state -------------------------------------------------

def evidence_to_state(doc, root):
    """Transform VALIDATED, grounded evidence into the state sent to Jev.

    The state is derived only from the evidence and the grounded files it
    cites. Questions are not touched here, and nothing evaluator-only is
    available to this function.
    """
    real_root = os.path.realpath(root)
    diff_items, files = [], {}
    for f in doc["findings"]:
        diff_items.append({"component": f["component"], "kind": "stated_never",
                           "never": f["never"], "enforced": f["enforced"],
                           "source_path": f["source_path"], "excerpt": f["excerpt"]})
        if f["source_path"] not in files:
            with open(os.path.join(real_root, f["source_path"].lstrip("/")),
                      encoding="utf-8", errors="replace") as fh:
                files[f["source_path"]] = fh.read()
    return {"diff_items": diff_items, "files": files}


# --- modes and spend guards ------------------------------------------------

class Plan:
    def __init__(self, mode, runnable, reason=""):
        self.mode, self.runnable, self.reason = mode, runnable, reason
        self.allow_real_jev = mode in ("live-jev", "full-experiment") and runnable
        self.allow_agent = mode == "full-experiment" and runnable


def plan_mode(mode, env=None):
    """Decide whether a mode may run. Reads ONLY explicit switches: never any
    credential variable. Returns a Plan; a disabled live mode is not runnable
    and carries the reason it was NOT RUN."""
    env = os.environ if env is None else env
    if mode not in MODES:
        raise ValueError("unknown mode %r (choose from %s)" % (mode, ", ".join(MODES)))
    if mode == "deterministic":
        return Plan(mode, True)
    missing = []
    if env.get("CONTRACT_ALLOW_REAL_JEV") != "1":
        missing.append("CONTRACT_ALLOW_REAL_JEV=1")
    if mode == "full-experiment" and env.get("CONTRACT_ALLOW_REASONING_AGENT") != "1":
        missing.append("CONTRACT_ALLOW_REASONING_AGENT=1")
    if missing:
        return Plan(mode, False, "opt-in switch(es) not set: " + ", ".join(missing))
    return Plan(mode, True)


def check_bounds(repeats, max_tokens=None, max_usd=None):
    """Validate requested bounds; fail closed on any that cannot be enforced.

    Repeats are enforced by the caller's loop. Neither the `jev` client nor a
    reasoning-agent runner exposes a token or spend cap the backend enforces,
    so a requested token/spend bound is refused rather than silently ignored.
    """
    if not 1 <= repeats <= MAX_REPEATS:
        raise BoundNotEnforceable("repeats must be 1..%d, got %d" % (MAX_REPEATS, repeats))
    for name, val in (("max_tokens", max_tokens), ("max_usd", max_usd)):
        if val:
            raise BoundNotEnforceable(
                "%s=%s requested but no backend here can enforce it; refusing to run (fail closed)" % (name, val))
    return repeats


# --- collection (agent) ----------------------------------------------------

class IsolationViolation(Exception):
    """The runner did not declare, or declared a violated, isolation contract."""


#: Environment the runner may inherit. Everything else (CONTRACT_*, Jev and
#: Proton credentials, evaluator variables) is withheld. Model credentials the
#: runner itself needs must be named in REASONING_AGENT_ENV_ALLOW.
BASE_ENV_ALLOW = ("PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR")
_SHELL_TOOLS = ("bash", "shell", "exec", "terminal", "sh")
_WEB_TOOLS = ("web", "fetch", "http", "browser", "search")


def runner_env(env=None):
    env = os.environ if env is None else env
    allow = set(BASE_ENV_ALLOW) | {v for v in env.get("REASONING_AGENT_ENV_ALLOW", "").split(",") if v}
    return {k: v for k, v in env.items() if k in allow}


def verify_isolation(manifest, root):
    """Check the isolation contract a runner DECLARES in its manifest:
    {"tools": [...], "disallowed": [...], "fs_roots": [<root>]}.

    This verifies the declaration against what the adapter requires; it does
    not prove containment. Containment (that the runner truly cannot read
    files outside its roots) is the runner's responsibility and needs its own
    recorded evidence before the full experiment's isolation is claimed.
    Returns a list of violations.
    """
    errs = []
    if not isinstance(manifest, dict):
        return ["manifest is not an object"]
    tools = manifest.get("tools")
    if not isinstance(tools, list) or not tools:
        errs.append("manifest lists no tools")
        tools = []
    for t in tools:
        name = str(t).lower()
        if any(w in name for w in _WEB_TOOLS):
            errs.append("web/network tool offered: %r" % t)
        if name in _SHELL_TOOLS or any(name.startswith(x + "_") for x in _SHELL_TOOLS):
            errs.append("shell tool offered (would bypass filesystem scope): %r" % t)
    if not isinstance(manifest.get("disallowed"), list):
        errs.append("manifest does not state its disallowed tools")
    roots = manifest.get("fs_roots")
    if roots != [os.path.realpath(root)]:
        errs.append("filesystem scope is %r, must be exactly [%r]" % (roots, os.path.realpath(root)))
    return errs


def collect_evidence(plan, runner, root, hint_level, out, env=None):
    """Run the reasoning-agent runner over the snapshot root.

    The runner gets the root, the hint level, an output path and a path to
    write its isolation manifest -- never the scenario. It runs with an
    allowlisted environment, and its evidence is returned only if its declared
    isolation contract verifies; otherwise collection fails closed.
    """
    if not plan.allow_agent:
        raise RealCallForbidden("reasoning agent may run only in full-experiment mode with its opt-in switch")
    if not runner or not shutil.which(runner):
        raise FileNotFoundError("REASONING_AGENT_RUNNER is not set to an executable")
    manifest_path = out + ".isolation.json"
    for p in (out, manifest_path):
        if os.path.exists(p):
            os.unlink(p)
    subprocess.run([runner, "--root", root, "--hint-level", str(hint_level), "--out", out,
                    "--isolation-manifest", manifest_path],
                   check=True, cwd=root, env=runner_env(env))
    if not os.path.isfile(manifest_path):
        raise IsolationViolation("runner wrote no isolation manifest; refusing its evidence")
    try:
        with open(manifest_path) as fh:
            manifest = json.load(fh)
    except ValueError as e:
        raise IsolationViolation("unreadable isolation manifest: %s" % e)
    errs = verify_isolation(manifest, root)
    if errs:
        raise IsolationViolation("; ".join(errs))
    if not os.path.isfile(out):
        raise FileNotFoundError("runner wrote no evidence file")
    return out, manifest


# --- jev -------------------------------------------------------------------

def run_jev(plan, backend, state_path, questions_path, mock_answers=None, model=None, env=None):
    """Invoke the installed `jev`. The backend is always passed explicitly and
    a mock never falls back to real: a real backend is refused unless the plan
    allows it, before any process is spawned."""
    if backend not in ("mock", "real"):
        raise ValueError(backend)
    if backend == "real" and not plan.allow_real_jev:
        raise RealCallForbidden("real Jev call refused in %s mode" % plan.mode)
    cmd = ["jev", "--backend", backend, "-q", questions_path]
    if backend == "mock":
        if not mock_answers:
            raise ValueError("mock backend needs canned answers")
        cmd += ["--mock-answers", mock_answers]
    if model:
        cmd += ["--model", model]
    cmd.append(state_path)
    env_file = (env or os.environ).get("CONTRACT_PASS_CLI_ENV_FILE")
    if backend == "real" and env_file:
        # The key is resolved by pass-cli into jev's environment, never argv.
        cmd = ["pass-cli", "run", "--env-file", env_file, "--"] + cmd
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, env=env)
    if proc.returncode != 0:
        raise RuntimeError("jev failed (%d): %s" % (proc.returncode, proc.stderr.strip()))
    return json.loads(proc.stdout)


def run_pipeline(plan, evidence_path, root, questions_path, workdir, backend, mock_answers=None,
                 model=None, env=None):
    """validate -> (reject before Jev) -> transform -> jev. Returns (result, state)."""
    errs, doc = validate(evidence_path, root)
    if errs:
        raise Rejected(errs)
    state = evidence_to_state(doc, root)
    state_path = os.path.join(workdir, "state.json")
    with open(state_path, "w") as fh:
        json.dump(state, fh)
    return run_jev(plan, backend, state_path, questions_path, mock_answers, model, env), state
