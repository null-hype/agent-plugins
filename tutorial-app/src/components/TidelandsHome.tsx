import ClaimCard from './ClaimCard';
import IntegrationCheck from './IntegrationCheck';
import { godelClaims } from '../lib/godelClaims';
import { TidelandsFooter, TidelandsHeader } from './TidelandsChrome';
import './Tidelands.css';

export default function TidelandsHome() {
  return <div className="td-page">
    <TidelandsHeader />
    <main className="td-main">
      <section className="td-hero" aria-labelledby="home-title">
        <p className="td-eyebrow">Richard Anthony · Software engineer · Sydney</p>
        <h1 id="home-title">A green check should lead to evidence you can inspect.</h1>
        <p className="td-lead">Verification infrastructure for agent-produced software.</p>
        <p className="td-muted">I build tools to preserve what a check actually saw, judge a claim against that exact world, and put the finding back on the source.</p>
        <div className="td-actions"><a className="td-button" href="https://github.com/null-hype/worlds#start-here-one-exact-world-proof">Inspect the Worlds proof ↗</a><a href="#try-a-check">Try a check below ↓</a></div>
        <ol className="td-steps" aria-label="How the evidence fits together">
          <li><span className="td-step-number">01 / Capture</span><h2>Keep the world.</h2><p>Preserve the inputs and records the check used in an exact snapshot.</p></li>
          <li><span className="td-step-number">02 / Check</span><h2>Test the claim.</h2><p>Judge a registered claim against that world, with a trace you can follow.</p></li>
          <li><span className="td-step-number">03 / Inspect</span><h2>Follow the finding.</h2><p>Read the result alongside its source and evidence, including a disagreement.</p></li>
        </ol>
      </section>
      <section className="td-section" id="try-a-check" aria-labelledby="try-title">
        <div className="td-section-intro"><p className="td-eyebrow">From the Storybook / Integration check</p><h2 id="try-title">Two passing changes. One failing combination.</h2><p className="td-muted">Evaluate the integration, inspect the disagreement, then repair and check it again. This is an interactive synthetic example; it does not run or approve a real delivery.</p></div>
        <div className="td-panel td-demo"><IntegrationCheck /></div>
        <noscript><p>The interactive example needs JavaScript. <a href="https://github.com/null-hype/worlds#start-here-one-exact-world-proof">Read the runnable Worlds proof and its evidence instead.</a></p></noscript>
      </section>
      <section className="td-section" id="claims" aria-labelledby="claims-title">
        <div className="td-section-intro"><p className="td-eyebrow">Claims / godel-check</p><h2 id="claims-title">One claim, two controls.</h2><p className="td-muted">Each card is a Dagger check with a prediction made before the model is asked. The claim's own result can't be read until both controls have passed.</p></div>
        <div className="td-claims">{godelClaims.map(c => <ClaimCard key={c.identifier} {...c} />)}</div>
      </section>
      <section className="td-section" aria-labelledby="evidence-title">
        <p className="td-eyebrow">Source, commands and limits</p><h2 id="evidence-title">Start with the evidence.</h2>
        <div className="td-projects">
          <article className="td-panel td-project"><h3><a href="https://github.com/null-hype/worlds">Worlds ↗</a></h3><p>Capture delivery evidence, restore an exact snapshot, and judge a registered claim.</p><p>The smallest runnable example preserves a disagreement even after a newer passing world replaces its label. Synthetic replay, real store and judge; no API keys.</p></article>
          <article className="td-panel td-project"><h3><a href="https://github.com/null-hype/witness">Witness ↗</a></h3><p>Inspect durable findings on the source in the editor, navigate to the evidence, and detect when the source has changed.</p><p>A separate presentation boundary, with its own runnable example.</p></article>
          <article className="td-panel td-project"><h3><a href="/part-5/can-an-upload-read-a-private-file/1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one/">Challenge a check →</a></h3><p>Inspect a private-file check and the review that challenges it with forged evidence.</p><p>The tutorial is a demonstration of the research; its scenarios are not a production security guarantee.</p></article>
        </div>
      </section>
      <section className="td-section" aria-labelledby="work-title"><p className="td-eyebrow">Work together</p><h2 id="work-title">Build tools people can trust and inspect.</h2><p className="td-lead">Available for senior engineering roles and selected consulting.</p><p className="td-muted">My background spans production web applications at Bloomberg and XO Group, test automation and platform engineering. I’m interested in software, security and AI infrastructure, verification and agent workflows.</p><div className="td-actions"><a className="td-button" href="mailto:public.rant@pm.me">Talk about working together ↗</a><a href="https://www.linkedin.com/in/richardanthonydev/">LinkedIn ↗</a></div><p style={{ marginTop: 20 }}><a href="mailto:public.rant@pm.me">public.rant@pm.me</a></p></section>
    </main>
    <TidelandsFooter />
  </div>;
}
