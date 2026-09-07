"""Check that the whole-job deadline covers login and the Go runner.

Runs with fake commands and disposable files; no credentials or network needed.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

source = Path(__file__).with_name('devpod-keepalive.sh')
with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    (root / 'keepalive').mkdir()
    (root / '.devcontainer/lib').mkdir(parents=True)
    (root / 'bin').mkdir()
    script = root / 'keepalive/devpod-keepalive.sh'
    shutil.copyfile(source, script)
    (root / '.devcontainer/lib/gce-common.sh').write_text('''
gce_common_reserve_sa_key_file() { SA_KEY_FILE=$(mktemp); }
gce_common_write_sa_key() { :; }
gce_common_restic_pull_devpod_state() { :; }
gce_common_restic_push_devpod_state() { echo STATE_SAVED; }
''')
    mocks = {
        'pass-cli': '''#!/bin/bash
case "$1" in
info) [ "$TEST_PHASE" != login ] ;;
logout) exit 0 ;;
login) sleep 10 ;;
run) shift 4; exec "$@" ;;
esac
''',
        'devpod-keepalive': '#!/bin/bash\nif [ "$TEST_PHASE" = runner ]; then sleep 10; fi\nif [ "$TEST_PHASE" = failure ]; then exit 1; fi\n',
        'gcloud': '#!/bin/bash\nexit 0\n',
    }
    for name, content in mocks.items():
        path = root / 'bin' / name
        path.write_text(content)
        path.chmod(0o755)
    env = dict(os.environ, PATH=f'{root}/bin:' + os.environ['PATH'],
               PROTON_PASS_PERSONAL_ACCESS_TOKEN='test-only', GOOGLE_PROJECT_ID='test',
               KEEPALIVE_TIMEOUT='0.5s')
    for phase, expected in [('login', 124), ('runner', 124), ('failure', 1), ('success', 0)]:
        run = subprocess.run(['bash', str(script)], env=dict(env, TEST_PHASE=phase),
                             capture_output=True, text=True, timeout=5)
        assert run.returncode == expected, (phase, run.returncode, run.stdout, run.stderr)
        assert ('STATE_SAVED' in run.stdout) == (phase == 'success'), run.stdout
        print(f'PASS: {phase} (exit {run.returncode})')
