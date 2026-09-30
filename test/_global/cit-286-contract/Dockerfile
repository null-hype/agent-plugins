# Deterministic contract scenario image: a plain devcontainers base plus the
# scenario's own files. The 'evidence' and 'jev' features are layered on by
# scenarios.json. Bake the Pkl scenario and its driver in so the test script is
# self-contained (skill Rule S).
FROM mcr.microsoft.com/devcontainers/base:ubuntu
COPY cit-286-contract.pkl cit-286-contract.test.pkl cit-286-contract.test.pkl-expected.pcf cit-286-contract_test.py /opt/scenarios/cit-286-contract/
