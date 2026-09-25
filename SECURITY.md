# Security Policy

## Reporting Security Issues & Vulnerabilities

If you discover a security vulnerability in this project or want to report an issue responsibly, please **do not** open a public issue.

Instead, please send an email to:

**`public.rant@pm.me`**

Include:
- A description of the vulnerability and its potential impact.
- Exact steps, scripts, or environment details to reproduce the issue.
- Details of any external systems or dependencies involved.

Please do not include live production credentials, unredacted tokens, or sensitive personal data in the initial report. We will acknowledge receipt within 48 hours and coordinate remediation before public disclosure.

---

## Security Boundaries & Prototype Status

This repository is a **research prototype** demonstrating pre-merge capability governance, multi-agent invariants, and diagnostic reconciliation.

Please observe the following trust model and boundaries:

1. **Experimental & Synthetic Fixtures:**
   - Files in `capability-spike/worker/fixtures_invalid/` and `tutorial-app/` contain intentionally vulnerable or malformed configurations (e.g. bypassed gates, budget overruns) used to verify that governance diagnostics trigger reliably.
   - These fixtures run in isolated test harnesses and do not represent vulnerabilities in the host system.

2. **Static vs. Runtime Enforcement:**
   - Static checks (such as Pkl schema checks and AST/text validation for gate calls) verify that code declares its dependencies and respects invariant structures.
   - They do not by themselves constitute a runtime kernel or hypervisor sandbox. Full runtime containment requires integration with dedicated runtime proxies, OS-level sandboxes, or vault proxies.

3. **Known Weaknesses & Evidence Integrity:**
   - We explicitly state known boundaries and non-claims in [`docs/launch/claims-evidence.md`](docs/launch/claims-evidence.md) and [`docs/investigations/CIT-255.md`](docs/investigations/CIT-255.md).
   - We do not claim production firewall guarantees, automated write-skew exploit synthesis across arbitrary agent swarms, or real vault enforcement beyond the documented local prototypes.

---

## Safe Harbor

We consider security research conducted under this policy to be authorized. We will not pursue legal action against researchers who:
- Make a good faith effort to avoid privacy violations, data destruction, and service degradation.
- Give us reasonable time to investigate and resolve issues before publishing findings.
- Adhere to applicable laws and regulations.
