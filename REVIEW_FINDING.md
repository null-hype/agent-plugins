# [P2] [Product] Publish later reviews from the same Codex session

At `.dagger/internal/devenv-base/hk/codex-review-sync.sh:40-42`, any existing `codex-session` marker causes the whole transcript to be skipped. An interactive Codex session can run review more than once; after its first review has been synced, every subsequent verdict in that session is silently suppressed even though line 22 explicitly selects the latest verdict. The author sees a successful sync while GitHub retains the older findings or verdict. Deduplicate by the individual review event (or update the posted review when the verdict changes), rather than the session alone. This is a product gap: success gives the author no indication that their new review was not published.

QA: derived a JSONL transcript from the committed PR #211 evidence and ran the actual sync function with local snapshot and GitHub stubs. The first invocation posted a review. Appended a second ExitedReviewMode verdict with a different explanation and ran sync again. It printed `already posted`, returned 0, and the captured post still contained only the first verdict. No real service was called.

PR: https://github.com/null-hype/agent-plugins/pull/231
Linear: CIT-445
Environment: thorough-elephant
Branch attachment: https://github.com/null-hype/agent-plugins/tree/cit-445-p2-product-publish-later-reviews-from-the-same-codex-session
