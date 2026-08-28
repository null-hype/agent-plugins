# Add each skill's SKILL.md as a prerequisite here as new skills are
# added, so `make skills` (and the refresh-skills.yaml workflow) picks
# them all up.
.PHONY: skills
skills: src/color/.claude/skills/pass-cli/SKILL.md

src/color/.claude/skills/pass-cli/SKILL.md:
	mkdir -p $$(dirname $@)
	pass-cli agent instructions > $@
