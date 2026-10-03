# Search, metadata, and stale surfaces (CIT-168)

> **Status: IN PROGRESS.** Observations below were checked on 2026-10-03. Prepared changes are not deployed verification.

## Cold-search observations

| Query | Observed result | Limitation |
|---|---|---|
| `"null-hype" "agent-plugins"` | Returned the GitHub profile, but the retrieved search copy still showed the older Cyber Farm framing and 64-repository snapshot. | A subsequent live repository read shows the newer governance profile. Search cache refresh is still pending; the old snippet is not the live profile. |
| `"Richard Anthony" "null-hype" LinkedIn` | No confidently matching personal LinkedIn profile was returned. | The user's exact profile URL is still needed for the publication check; no identity was guessed. |
| `"null-hype.tidelands.dev"` | Returned the tutorial's current title and description. | Confirms one discoverable route, not universal ranking or indexing coverage. |
| `"Agent decisions, checked against evidence"` | Returned the tutorial root and the clean-merge lesson on `www.tidelands.dev`. | The two domains and their canonical behavior need checking after publication. |

These are search observations, not assumed PASS outcomes. Broad search also returned unrelated uses of the Null Hype name.

## Rendered public metadata

An HTTP fetch of [the landing page](https://null-hype.tidelands.dev/part-0/overview/start/) showed:

| Item | Live observation | This branch |
|---|---|---|
| Canonical URL | Present, points at the production landing page | Retains TutorialKit's canonical link |
| OpenGraph title/description/site/type | Present | Retained |
| OpenGraph URL | Missing | Adds page-specific URL matching the canonical |
| Twitter title/description | Present through TutorialKit's default metadata slot | Retained; no duplicates added |
| Twitter card | `summary` | `summary_large_image` |
| Preview image | Missing | Adds loadable 1200 × 630 PNG, OpenGraph/Twitter image and alt text |
| Favicon | Missing | Adds `favicon.svg`, linked by TutorialKit |

The new preview uses the actual airfare/ground spending-policy example and labels its synthetic scope. It does not claim an authorization exploit or a production control.

## Existing cleanup and remaining public sync

The September 25 repository retirement and profile cleanup are retained as prior work, not re-certified repository counts. Current GitHub profile and website-repository README reads confirm that the old placeholder/Cyber Farm framing was replaced. Their published descriptions still need synchronization with the revised canonical copy in this PR. The website README also still calls its audit stream immutable and the prior verdict permanent; those descriptions must be corrected to retained evidence.

## Reproduce after publication

```bash
cd tutorial-app
npm ci
npx playwright install chromium
npx playwright test --config=playwright.launch.config.ts
```

This runs fresh desktop/mobile browser contexts against production, checking the journey and rendered metadata/assets. The default target is production; `LAUNCH_BASE_URL` can select a deploy preview. PR CI uses a locally built site and is not evidence of public publication. Keep CIT-168 open until the actual public page and remaining stale surfaces are checked.
