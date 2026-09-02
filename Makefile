# Add each skill's SKILL.md as a prerequisite here as new skills are
# added, so `make skills` (and the refresh-skills.yaml workflow) picks
# them all up.
#
# Only skills whose content needs a live authenticated session to
# generate belong here: their SKILL.md is checked into the repo and
# needs periodic regeneration. A skill that can be generated with no
# auth (e.g. playwright-cli's `install --skills`) is instead run for
# real at feature-install time - see src/playwright-cli/install.sh -
# and has nothing checked in for this target to regenerate.
.PHONY: skills
skills: src/pass-cli/.claude/skills/pass-cli/SKILL.md

src/pass-cli/.claude/skills/pass-cli/SKILL.md:
	mkdir -p $$(dirname $@)
	pass-cli agent instructions > $@

recreate-devpod: DAGGER_CALL_DEVENV_BASE = dagger call -m .dagger/internal/devenv-base
recreate-devpod: PASS_CLI_RUN = PROTON_PASS_AGENT_REASON=$@ pass-cli run --env-file .env
recreate-devpod:
	$(PASS_CLI_RUN) -- $(DAGGER_CALL_DEVENV_BASE) $@ --proton-pass-token=env://PROTON_PASS_PERSONAL_ACCESS_TOKEN

view-trace: PASS_CLI_RUN = PROTON_PASS_AGENT_REASON=$@ pass-cli run --env-file .env
view-trace:
	$(PASS_CLI_RUN) -- dagger trace $(TRACE)
