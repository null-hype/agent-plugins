#!/usr/bin/env bash
# Rebuild public/delta-zero-demo.gif from real nvim sessions on the synthetic example.
# Needs: nvim 0.11+, witness on PATH, tmux, ffmpeg, node with playwright-core
# (set PLAYWRIGHT_NODE_MODULES to its node_modules dir if it is not in ~/.local/lib/node_modules/@playwright/cli/node_modules).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); repo=$(dirname "$(dirname "$here")")
work=$(mktemp -d); T="tmux -L dp-demo-gif"
mkdir -p "$work/f"; cp -r "$repo/examples/deploy-approval/out" "$repo/examples/deploy-approval/out-repaired" "$work/"
cap(){ $T capture-pane -t "$3" -e -p -E 23 > "$work/f/$1.txt"; python3 -I "$here/ansi2html.py" "$work/f/$1.txt" "$work/f/$1.html" "$2"; }
nv(){ $T new-session -d -s "$1" -x 130 -y 24 "cd $work/$2 && nvim -n -u $repo/editor/init.lua thread.pkl"; sleep 4; $T send-keys -t "$1" 25G zt; sleep 1; $T send-keys -t "$1" 27G; sleep 1; }
nv d out;          cap 1 "1. The compacted summary, as a Pkl module. Line 27 carries a finding." d
$T send-keys -t d ':lua vim.lsp.buf.definition()' Enter; sleep 2; $T send-keys -t d ':echo ""' Enter; sleep 1
cap 2 "2. Go-to-definition opens the full text the summary lost." d
nv e out-repaired; cap 3 "3. One sentence restored in the summary: the finding on line 27 is gone." e
$T kill-server
for i in 1 2 3; do node "$here/shot.mjs" "$work/f/$i.html" 1180 540; done
ffmpeg -y -loglevel error -framerate 1/3 -i "$work/f/%d.png" -vf "scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse" -loop 0 "$here/../delta-zero-demo.gif"
echo "wrote $here/../delta-zero-demo.gif"
