# Live-smoke base for the CIT-286 toy-case scenario.
#
# Uses the same devenv agent image the other credentialed global scenarios use
# (it bundles Claude Code, pass-cli prerequisites and the repo tooling), so the
# scenario can attempt a REAL reasoning-agent run rather than a mock. The 'jev',
# 'evidence' and 'pass-cli' features are layered on by scenarios.json.
FROM ghcr.io/null-hype/devenv-linear-agent:sha-f68af4dfdc97bdcf97806f6c4bedc472ff565fac

# pass-cli's default key backend needs the OS keyring (unavailable headless);
# use the fs provider so a real TYPESAFE_API_KEY can be resolved via pass-cli.
ENV PROTON_PASS_KEY_PROVIDER="fs"

# The inspected image root the reasoning agent reads and the grounding check
# runs against: exactly the toy tool + its README (positive arm), nothing else.
# Baked at a known absolute path so the self-contained scenario script does not
# have to reach back into the checkout (skill Rule S).
COPY root/ /opt/toy-case/root/

# The Pkl scenario, its driver and the canned/expected material. Kept OUTSIDE
# /opt/toy-case/root so none of it lands under the filesystem the agent inspects
# or reaches the model (skill Rule D4).
COPY cit-286-toy-smoke.pkl cit-286-toy-smoke.test.pkl cit-286-toy-smoke_test.py /opt/scenarios/cit-286-toy-smoke/
