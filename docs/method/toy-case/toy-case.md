# Toy example case: `noteexpand` (CIT-285)

The method's example case and live-smoke target, **unrelated to any real CVE**.
It gives the [evidence method](../../../src/evidence/README.md) (CIT-284) a
minimal case with exactly the shape the method looks for: a component whose
README states a "never", and a consumer that does not enforce it. Everything
lives under [`toy-case/`](.).

## The case

`noteexpand` is a tiny note renderer. `expander.sh FILE` writes `FILE` to
stdout, except a line `@include PATH` is replaced by the contents of `PATH`.
Its [README](./rootfs/opt/toy/README.md) states the "never":

> Never run the expander on a note you did not write yourself. An `@include`
> line names a file path, and the expander opens that path and copies its
> contents into the output verbatim, including paths outside the note's own
> directory. Nothing restricts which path an `@include` may name.

That describes the **tool**. Whether the deployed system enforces the "never"
is the consumer's job: [`service.sh`](./rootfs/opt/toy/service.sh) renders a
note that arrives from a caller (`$NOTE`) and runs the expander on it unchanged
— it runs the tool on input the operator did not author, with nothing confining
the include path. So the `enforced` answer can only be reached by reading
`service.sh`, not from the README alone. That is the whole finding: a stated
"never" that the composed system does not enforce.

## Image

[`Dockerfile`](./Dockerfile) is `FROM alpine:3.20` with `COPY rootfs/ /`. The
inspected positive root is just the tool and its README — no note is baked in,
and no control variant or arm wording is present — so the only component-stated
"never" the agent sees is the README's (alpine itself adds one incidental hit
in an unrelated DHCP script; a Debian root would add hundreds). The `rootfs/`
tree is what a grounding check runs against; `COPY rootfs/ /` puts each file at
the same path in the image, so `opt/toy/README.md` in the answer key resolves
both against `rootfs/` and against the built image root.

## Arms (matched control)

Two Dockerfile targets that differ **only in the consumer**; `README.md` and
`expander.sh` are byte-identical in both:

- **positive** (`--target positive`) — [`rootfs/opt/toy/service.sh`](./rootfs/opt/toy/service.sh)
  runs the expander on the incoming note unchanged.
- **control** (`--target control`) — [`control/opt/toy/service.sh`](./control/opt/toy/service.sh),
  `FROM positive` plus `COPY control/ /`, rewrites any `@include` that escapes
  the note's own directory to `[include refused]` before rendering. The "never"
  is enforced. The control source lives outside `rootfs/`, so nothing about it
  reaches the positive root.

## The "never" actually fires (canary)

[`demo.sh`](./demo.sh) is the CIT-278-style canary, self-contained and
CVE-free. It builds both targets, then drives the **images** (not the checkout
scripts): the note is fed on stdin and a marker file (`MARKER-8f3a`, not a
secret) is created *inside* the container, outside the note's directory, so no
host bind mount is involved (the `/tmp` bind-mount trap the
[CIT-271 README](../../../test/_global/cit-271-free-agent/README.md) documents).
The read is observed directly in the output — recorded in
[`demo-output.txt`](./demo-output.txt):

- both arms render the note's plain lines (so an empty/failed run can't pass);
- the positive arm inlines the marker → the unenforced "never" fires;
- the control arm prints `[include refused]` → the marker is not read.

This closes the edge as *demonstrated*, not assumed (the standing lesson from
the [CIT-280 review](../../investigations/CIT-265.md)). Run it (needs Docker):

```
docs/method/toy-case/demo.sh
```

## Answer keys and hint level

[`expected-evidence.json`](./expected-evidence.json) (positive, `enforced:
false`) and [`expected-evidence-control.json`](./expected-evidence-control.json)
(control, `enforced: true`) are the expected findings, written in the CIT-284
evidence format and kept **out** of the image root. Both ground against the
validator on the CIT-284 branch, each against its own arm's exported image root:

```
python3 src/evidence/evidence-validate --root <positive image root> \
    docs/method/toy-case/expected-evidence.json          # exit 0
python3 src/evidence/evidence-validate --root <control image root> \
    docs/method/toy-case/expected-evidence-control.json  # exit 0
```

(Run by hand from a CIT-284 checkout — CIT-284 is not on `main` yet, so this
case ships no test that depends on it; wiring the toy into the reasoning-model →
Jev contract tests, including the live smoke run, is [CIT-286](https://linear.app/citizen6librarian6refrain4/issue/CIT-286).)

[`case.json`](./case.json) records the runtime parameters. The **smoke hint
level is 1** — "look for a component's stated 'never' that nothing enforces" —
the generic hint the toy is built to exercise. Levels 2 and 3 cite a real
analogous CVE and the real CVE respectively, so they are **N/A** for a toy that
is unrelated to any CVE.
