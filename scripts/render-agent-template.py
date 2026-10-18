#!/usr/bin/env python3
"""Render a global scenario as the devcontainer config a codespace is made from.

A scenario in test/_global/scenarios.json is a devcontainer config the
feature tests prove works. Rendered to .devcontainer/agents/<scenario>/,
it is the same config for `gh codespace create --devcontainer-path`:

- this repo's features (src/<id>) are copied in beside it and referenced as
  ./<id>, until they are published;
- a scenario Dockerfile's folder (test/_global/<scenario>/) is copied in too;
- containerEnv entries taken from the test runner's environment
  (${localEnv:...}) are dropped: in a codespace they are Codespaces secrets.

    scripts/render-agent-template.py <scenario>...           write
    scripts/render-agent-template.py --check <scenario>...   fail if stale
"""
import argparse
import filecmp
import json
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SCENARIOS = ROOT / 'test/_global/scenarios.json'
AGENTS = ROOT / '.devcontainer/agents'


def render(name, out):
    config = json.loads(SCENARIOS.read_text())[name]
    out.mkdir(parents=True)
    features = {}
    for ref, options in config.get('features', {}).items():
        if (ROOT / 'src' / ref).is_dir():
            shutil.copytree(ROOT / 'src' / ref, out / ref)
            ref = f'./{ref}'
        features[ref] = options
    config['features'] = features
    if 'build' in config:
        if 'context' in config['build']:
            sys.exit(f'{name}: a build context outside the scenario folder is not supported')
        shutil.copytree(ROOT / 'test/_global' / name, out, dirs_exist_ok=True)
    env = {k: v for k, v in config.get('containerEnv', {}).items() if '${localEnv:' not in v}
    if env:
        config['containerEnv'] = env
    else:
        config.pop('containerEnv', None)
    (out / 'devcontainer.json').write_text(json.dumps(config, indent=4) + '\n')


def same(a, b):
    cmp = filecmp.dircmp(a, b)
    return (not cmp.left_only and not cmp.right_only and not cmp.diff_files and not cmp.funny_files
            and all(same(a / d, b / d) for d in cmp.common_dirs))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('scenarios', nargs='+')
    args = parser.parse_args()
    stale = []
    for name in args.scenarios:
        target = AGENTS / name
        if args.check:
            with tempfile.TemporaryDirectory() as tmp:
                render(name, Path(tmp) / name)
                if not target.is_dir() or not same(Path(tmp) / name, target):
                    stale.append(name)
        else:
            shutil.rmtree(target, ignore_errors=True)
            render(name, target)
            print(target.relative_to(ROOT))
    if stale:
        sys.exit(f'stale, re-render: scripts/render-agent-template.py {" ".join(stale)}')


if __name__ == '__main__':
    main()
