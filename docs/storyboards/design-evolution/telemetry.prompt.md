# Tidelands — Telemetry

Tutorial site in the "Pre-cog Telemetry IDE" design system, carried over from the tool UI to long-form prose: the page reads like an instrument readout.

## Design system tokens
- Surfaces: obsidian canvas `#0b141c`, container `#182028`, elevated `#222b33`, borders `#30363d`.
- Semantic palette (meaningful, not decorative): verified `#3fb950`, focus/links `#58a6ff`, warning `#d29922`, alarm `#f85149`. Body text `#c9d1d9`, muted `#8b949e`.
- Typography: headings Geist 600; body Geist 400 16/28; JetBrains Mono with tabular numbers for numbers, labels, the code block, the table's first column and the breadcrumb.
- Details: the lead paragraph's "1290 against a limit of 1200" is rendered as a status readout: `1290 / 1200` in mono with an alarm-red chip "OVER". The left rail shows each part with a status dot (green done, blue current, grey unvisited). The CTA is a solid `#58a6ff` button with a mono "⏎" key hint. The callout is a bordered panel with a blue left rule and a mono "INFO" label. The table looks like a data grid with 1px row rules. 6px corner radius, no shadows. A thin status line pinned at the bottom: "part 0 · turn 0/5 · 0 sealed · 0 done".
