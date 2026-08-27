src/color/.claude/skills/pass-cli/SKILL.md:
	mkdir -p $$(dirname $@)
	pass-cli agent instructions > $@
