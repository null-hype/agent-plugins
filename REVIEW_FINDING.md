[P2] [Product] Do not report success for an issue branch that does not exist

Location: `.dagger/internal/devenv-base/toolbox/host.sh:189-190`.

When the issue branch does not exist, SHIP_PREPARE substitutes origin/main, then emits SHIP_ALREADY if the environment tip is an ancestor of main. run_ship returns exit 0 and status `already on the branch` without pushing or running SHIP_VERIFY. This affects unchanged environments and environments whose work has already landed on main: the requested Linear branch remains absent even though agent_ship_status reports success.

QA: ran host.sh ship against disposable bare origin/container-use repositories with a fake devpod, an environment pointing at main, and no real services. Shipping trusty-burro to absent cit-new returned exit 0, main's SHA and `already on the branch`; listing origin's heads afterward showed only refs/heads/main. A separate local happy path with a changed environment and fake Codex/container-use successfully merged and pushed to the disposable origin.

This violates the product requirement that users can distinguish success from failure and the principle `A broken instrument fails the run. A refuted hypothesis is a result.`: the success record contradicts the remote. Only take the already-shipped shortcut after confirming the requested remote branch exists and contains the environment; otherwise create the requested branch or fail explicitly.