---
name: Pre-cog Telemetry IDE
colors:
  surface: '#0b141c'
  surface-dim: '#0b141c'
  surface-bright: '#313a43'
  surface-container-lowest: '#060f16'
  surface-container-low: '#141c24'
  surface-container: '#182028'
  surface-container-high: '#222b33'
  surface-container-highest: '#2d363e'
  on-surface: '#dae3ee'
  on-surface-variant: '#bdcab8'
  inverse-surface: '#dae3ee'
  inverse-on-surface: '#29313a'
  outline: '#879484'
  outline-variant: '#3e4a3c'
  surface-tint: '#67df70'
  primary: '#67df70'
  on-primary: '#00390d'
  primary-container: '#3fb950'
  on-primary-container: '#004311'
  inverse-primary: '#006e21'
  secondary: '#a2c9ff'
  on-secondary: '#00315c'
  secondary-container: '#0071c7'
  on-secondary-container: '#f0f4ff'
  tertiary: '#d8baff'
  on-tertiary: '#430882'
  tertiary-container: '#bb8bfe'
  on-tertiary-container: '#4c188b'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#83fc89'
  primary-fixed-dim: '#67df70'
  on-primary-fixed: '#002105'
  on-primary-fixed-variant: '#005317'
  secondary-fixed: '#d3e4ff'
  secondary-fixed-dim: '#a2c9ff'
  on-secondary-fixed: '#001c38'
  on-secondary-fixed-variant: '#004882'
  tertiary-fixed: '#eddcff'
  tertiary-fixed-dim: '#d8baff'
  on-tertiary-fixed: '#290055'
  on-tertiary-fixed-variant: '#5b2b9a'
  background: '#0b141c'
  on-background: '#dae3ee'
  surface-variant: '#2d363e'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 1.75rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 1.375rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Geist
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Geist
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.5rem
  body-md:
    fontFamily: Geist
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
  body-sm:
    fontFamily: Geist
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
  code-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.02em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.04em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.5rem
  gutter-dense: 0.25rem
  margin: 0.75rem
  margin-mobile: 0.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system embodies a high-density, analytical IDE aesthetic tailored for engineers, security analysts, and systems architects working with predictive verification, formal logic proofs, and real-time telemetry. 

The visual movement sits at the intersection of **Utilitarian Developer Tooling** and **Cybernetic Minimalism**. The UI must evoke feelings of absolute deterministic control, surgical accuracy, and cognitive clarity under heavy informational load. 

Visual priorities:
- **Zero Decorative Fluff:** Every line, border, and badge serves a structural or telemetry-informative purpose.
- **Micro-Contrast Hierarchy:** Subtle variations in dark slate layers separate canvas, panel, gutter, and modal surfaces without jarring transitions.
- **Chromatic Precision:** Color is reserved almost entirely for status indication, semantic code framing, and real-time execution state changes.

## Colors

The color palette is built upon deep obsidian and cold slate foundations, accented by high-visibility cybernetic indicators calibrated for long, eye-strain-free operating sessions.

### Base Surfaces & Boundaries
- **Obsidian Canvas (`#0d1117`):** The primary root workspace, code gutter, and baseline editor surface.
- **Slate Panel (`#161b22`):** Primary sidebar panels, terminal drawers, and elevated workspace toolbars.
- **Slate Active Container (`#21262d`):** Card surfaces, active tab headers, and interactive list hover states.
- **Structural Stroke (`#30363d`):** The hairline divider rule for grid splitters, docked panels, and element boundaries.

### Semantic Telemetry Palette
- **Verified / Deterministic (`#3fb950` default, `#2ea043` border/dark):** Signals proven invariants, passing test suites, and safe verification branches.
- **Predictive / Analysis Focus (`#58a6ff`):** Signals active parsing, AST traversal, hyperlinks, and operational focus.
- **Symbolic / Quantum Branch (`#bc8cff`):** Secondary logic proofs, macro executions, and heuristic insights.
- **Stale / Warning (`#d29922` default, `#8b949e` muted slate):** Pending proofs, outdated telemetry hashes, and intermediate warnings.
- **Alarm / Counterexample (`#f85149` foreground, `#da3633` badge container):** Failed invariants, security boundaries crossed, and logic violations.

## Typography

Typography balances hyper-readable UI copy via **Geist** with rigorous token-aligned alignment via **JetBrains Mono**.

- **Geist** governs panels, modal structures, and high-level analytical summaries.
- **JetBrains Mono** governs all telemetry readouts, timestamps, execution counters, logic predicates, and data grid tables.
- Monospace tokens must strictly maintain tabular figure formatting (`font-variant-numeric: tabular-nums`) to prevent horizontal jitter when values stream in real-time.
- All uppercase section headers and tab tags use `label-sm` with slight positive letter-spacing for rapid visual classification.

## Layout & Spacing

The layout is architected around a dense, high-efficiency, multi-pane workbench optimized for maximum vertical and horizontal data retention.

### Layout Philosophy
- **Split-Pane Tiling:** The core viewport is a multi-directional tiled canvas with collapsible auxiliary drawers (file trees, symbol inspectors, telemetry logs).
- **Sub-8px Density Matrix:** Standard gaps are tightly compressed (2px, 4px, 8px, 12px) to match desktop IDE information densities.
- **Zero-Waste Margins:** Root canvas borders use thin hairline separators rather than generous spacing padding. Outer margins measure 12px maximum on desktop monitors.

### Breakpoints & Adaptability
- **Desktop (> 1024px):** Three-column layout (collapsible navigation panel, primary code/proof pane, contextual telemetry drawer).
- **Tablet (768px – 1023px):** Two-column layout; bottom drawers collapse to toggleable tabs.
- **Mobile (< 768px):** Single-pane layout with persistent status bar and full-screen drawer overlays.

## Elevation & Depth

This design system avoids soft organic drop shadows, relying entirely on **Tonal Layers** and **Low-Contrast Outlines** reminiscent of high-performance IDE viewports.

### Surface Hierarchy
1. **Base Zero (`#0d1117`):** Deepest level. Code buffer, terminal log stream, and proof tree canvases.
2. **Docked Level 1 (`#161b22`):** Peripheral toolbars, status bars, sidebars, and tab ribbons. Separated from Base Zero strictly with a 1px solid border (`#30363d`).
3. **Surface Level 2 (`#21262d`):** Cards, input wells, hover indicators, and pinned verification reports.
4. **Floating Overlays Level 3 (`#161b22`):** Command palettes, code completion popovers, and context menus. These float with a 1px solid border (`#30363d`) and an ultra-tight, directional ambient shadow: `0 8px 24px rgba(1, 4, 9, 0.85)`.

### Focus & Active State Flares
- Surfaces never use rounded diffused drops; instead, active split-panes acquire a hairline accent boundary: a 1px border highlight (`#58a6ff` or `#3fb950`).

## Shapes

The design system enforces a **Soft (Level 1)** geometric silhouette to preserve the compact, structural feel of a precision developer cockpit.

- **Standard Elements (inputs, buttons, badges, chips):** `0.25rem` (4px). Matches the rigid boundary lines of code editors without visual sharpness that creates fatigue.
- **Panels, Modals & Floating Cards:** `0.375rem` (6px) to maintain subtle separation from linear grid splits.
- **Indicator Dots & Badges:** Circular (`9999px`) only when representing micro health status or live connection pings.

## Components

### Buttons
- **Primary (Action/Run):** Background `#238636`, border 1px solid `#2ea043`, text `#ffffff`. Hover: `#2ea043`. Active: `#267232`.
- **Secondary (Inspect/Branch):** Background `#21262d`, border 1px solid `#30363d`, text `#c9d1d9`. Hover: background `#30363d`, border `#8b949e`.
- **Destructive/Abort:** Background `rgba(248, 81, 73, 0.1)`, border 1px solid `#da3633`, text `#f85149`. Hover: background `#da3633`, text `#ffffff`.
- **Padding:** Compact vertical density (`space-xs` top/bottom, `space-md` left/right). Typography: `code-sm` or `label-md`.

### Chips & Telemetry Badges
- Compact height (20px), `space-xs` vertical padding, `space-sm` horizontal padding. Monospace font (`code-sm`).
- **Verified Badge:** Background `rgba(63, 185, 80, 0.15)`, border 1px solid `rgba(63, 185, 80, 0.4)`, text `#3fb950`.
- **Violation Badge:** Background `rgba(248, 81, 73, 0.15)`, border 1px solid `rgba(248, 81, 73, 0.4)`, text `#f85149`.
- **Stale/Heuristic Badge:** Background `rgba(210, 153, 34, 0.15)`, border 1px solid `rgba(210, 153, 34, 0.4)`, text `#d29922`.

### Inputs & Code Lookups
- **Background:** `#0d1117` with 1px border `#30363d`. Text `#c9d1d9`, placeholder `#8b949e`.
- **Focus:** 1px solid `#58a6ff` with a zero-spread 1px box-shadow flare in `rgba(88, 166, 255, 0.3)`.
- Input fields display a subtle monospaced shortcut helper (e.g., `⌘K`) pinned to the right edge.

### Verification Cards
- Background `#161b22`, border 1px solid `#30363d`, radius `4px`.
- Card header features a 28px height limit, containing rule title in `Geist 600` alongside target source file path in `JetBrains Mono` at `#8b949e`.
- Violation status triggers a left-edge accent border (2px width in `#f85149`).

### Checkboxes & Binary Switches
- **Checkbox:** 14px × 14px square box, 2px radius, `#0d1117` surface, 1px `#30363d` outline.
- **Checked State:** Background `#1f6feb`, border `#58a6ff`, displaying a crisp white micro-checkmark.

### Data Grid / Telemetry List
- Zebra striping is omitted. Row separation is managed through transparent hover highlights (`#21262d`).
- Row height: strictly 28px or 32px to guarantee maximum line counts in log monitors.
- Selection indicator: 2px solid vertical strip on the left border using `#58a6ff`.