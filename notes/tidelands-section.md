# Proposed section for tidelands.dev

Placement: directly after the hero, before "Two passing changes. One failing combination." Worlds stays as a project card lower down. The hero and its Worlds button are left as they are; the owner can decide separately whether the headline should change.

## Copy

**Eyebrow:** Current work

**Heading:** A summary always loses something. Show what.

**Body:** When an agent compacts its context, whatever the summary drops is gone before the next action, and nothing says so. I treat that loss like a compiler warning: named, visible, traceable to its source and repairable. The demo opens a compacted thread in Neovim. The summary says "go ahead and implement it". A diagnostic on that line quotes the sentence it dropped: "Do not deploy this to production until I have reviewed the diff myself."

**Origin (small print):** It started in the tutorial. A gloss of *Fingerspitzengefühl* loses named axes (lexicalization, Gefühl register, Spitzen valence, lineage). Compaction loses meaning in the same way.

**Limits (small print):** Synthetic thread. The detector checks whether text is present, not what it means. Judging which losses matter and repairing the summary automatically are the next experiment, not built.

**Links:** "Run the demo" -> https://github.com/null-hype/delta-zero · "The lesson" -> https://github.com/null-hype/agent-plugins/tree/main/tutorial-app/src/content/tutorial/part-1/chapter-1/lesson-2

**Image:** the before screenshot. Needs `delta-zero/examples/deploy-approval/screenshot.png` copied to the tutorial-app `public/` folder as `compaction-loss.png`.

## Change to `tutorial-app/src/components/TidelandsHome.tsx` (not applied)

The `td-panel`, `td-section`, `td-section-intro`, `td-eyebrow`, `td-muted` and `td-actions` classes already exist in `Tidelands.css`. The `<img>` needs no new CSS beyond `style`; if wanted, add `.td-shot { max-width: 100%; border: 1px solid var(--td-line); }`. Not checked in a browser.

```diff
--- a/tutorial-app/src/components/TidelandsHome.tsx
+++ b/tutorial-app/src/components/TidelandsHome.tsx
@@ -19,6 +19,19 @@
           <li><span className="td-step-number">03 / Inspect</span><h2>Follow the finding.</h2><p>Read the result alongside its source and evidence, including a disagreement.</p></li>
         </ol>
       </section>
+      <section className="td-section" id="compaction-loss" aria-labelledby="loss-title">
+        <div className="td-section-intro">
+          <p className="td-eyebrow">Current work</p>
+          <h2 id="loss-title">A summary always loses something. Show what.</h2>
+          <p className="td-muted">When an agent compacts its context, whatever the summary drops is gone before the next action, and nothing says so. I treat that loss like a compiler warning: named, visible, traceable to its source and repairable.</p>
+        </div>
+        <figure className="td-panel" style={{ margin: 0 }}>
+          <img src="/compaction-loss.png" alt="A compacted thread in Neovim. A diagnostic on the user's approval reads: message 3 (user) dropped prose: Do not deploy this to production until I have reviewed the diff." style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
+          <figcaption className="td-muted" style={{ padding: '12px 20px' }}>The summary says "go ahead and implement it". The diagnostic quotes the sentence it dropped: do not deploy until the diff is reviewed.</figcaption>
+        </figure>
+        <p className="td-muted">It started in the tutorial: a gloss of <em>Fingerspitzengefühl</em> loses named axes (lexicalization, Gefühl register, Spitzen valence, lineage), and compaction loses meaning the same way. Synthetic thread. The detector checks whether text is present, not what it means; judging which losses matter and automatic repair are the next experiment, not built.</p>
+        <div className="td-actions"><a className="td-button" href="https://github.com/null-hype/delta-zero">Run the demo ↗</a><a href="https://github.com/null-hype/agent-plugins/tree/main/tutorial-app/src/content/tutorial/part-1/chapter-1/lesson-2">The lesson ↗</a></div>
+      </section>
       <section className="td-section" id="try-a-check" aria-labelledby="try-title">
         <div className="td-section-intro"><p className="td-eyebrow">From the Storybook / Integration check</p><h2 id="try-title">Two passing changes. One failing combination.</h2><p className="td-muted">Evaluate the integration, inspect the disagreement, then repair and check it again. This is an interactive synthetic example; it does not run or approve a real delivery.</p></div>
         <div className="td-panel td-demo"><IntegrationCheck /></div>
```

Optional, one line: in the Worlds project card, change the second paragraph's lead-in so it reads as earlier work, for example prefix it with "Earlier work: ". Not included in the diff.
