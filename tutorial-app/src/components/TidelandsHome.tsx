import IntegrationCheck from './IntegrationCheck';
import { TidelandsFooter, TidelandsHeader } from './TidelandsChrome';
import './Tidelands.css';

import type { ReactNode } from 'react';

export default function TidelandsHome({ children }: { children?: ReactNode }) {
  return <div className="td-page">
    <TidelandsHeader />
    <main className="td-main">
      <section className="td-hero" aria-label="How I debug multi-agent work">
        <p className="td-eyebrow">Richard Anthony Massey · Software engineer · Sydney</p>
        <article className="td-prose">{children}</article>
        <div className="td-actions"><a className="td-button" href="https://github.com/null-hype/agent-plugins/tree/delta-zero">Read the delta-zero code ↗</a><a href="#try-a-check">Try the pre-merge check ↓</a></div>
      </section>
      <section className="td-section" id="try-a-check" aria-labelledby="try-title">
        <div className="td-section-intro"><p className="td-eyebrow">Before delta-zero / Pre-merge check</p><h2 id="try-title">Two passing changes. One failing combination.</h2><p className="td-muted">Before delta-zero, I ran coding agents in parallel in isolated container-use environments, with GitButler combining their branches. This check catches changes that pass alone but fail together. Evaluate the integration, inspect the disagreement, then repair and check it again. This is an interactive synthetic example; it does not run or approve a real delivery.</p></div>
        <div className="td-panel td-demo"><IntegrationCheck /></div>
        <noscript><p>The interactive example needs JavaScript. <a href="https://github.com/null-hype/worlds#start-here-one-exact-world-proof">Read the runnable Worlds proof and its evidence instead.</a></p></noscript>
      </section>
      <section className="td-section" aria-labelledby="evidence-title">
        <p className="td-eyebrow">Source, commands and limits</p><h2 id="evidence-title">Start with the evidence.</h2>
        <div className="td-projects">
          <article className="td-panel td-project"><h3><a href="https://github.com/null-hype/worlds">Worlds ↗</a></h3><p>Capture delivery evidence, restore an exact snapshot, and judge a registered claim.</p><p>The smallest runnable example preserves a disagreement even after a newer passing world replaces its label. Synthetic replay, real store and judge; no API keys.</p></article>
          <article className="td-panel td-project"><h3><a href="https://github.com/null-hype/witness">Witness ↗</a></h3><p>Inspect durable findings on the source in the editor, navigate to the evidence, and detect when the source has changed.</p><p>A separate presentation boundary, with its own runnable example.</p></article>
          <article className="td-panel td-project"><h3><a href="/part-5/can-an-upload-read-a-private-file/1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one/">Challenge a check →</a></h3><p>Inspect a private-file check and the review that challenges it with forged evidence.</p><p>The tutorial is a demonstration of the research; its scenarios are not a production security guarantee.</p></article>
        </div>
      </section>
      <section className="td-section" aria-labelledby="work-title"><p className="td-eyebrow">Work together</p><h2 id="work-title">Build tools people can trust and inspect.</h2><p className="td-lead">Available for senior engineering roles and selected consulting.</p><p className="td-muted">My background spans production web applications at Bloomberg and XO Group, test automation and platform engineering. I’m interested in software, security and AI infrastructure, verification and agent workflows.</p><div className="td-actions"><a className="td-button" href="mailto:richard@tidelands.dev">Talk about working together ↗</a><a href="https://www.linkedin.com/in/richardanthonydev/">LinkedIn ↗</a></div><p style={{ marginTop: 20 }}><a href="mailto:richard@tidelands.dev">richard@tidelands.dev</a></p></section>
    </main>
    <TidelandsFooter />
  </div>;
}
