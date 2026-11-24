import IntegrationCheck from './IntegrationCheck';
import { TidelandsFooter, TidelandsHeader } from './TidelandsChrome';
import './Tidelands.css';

export default function TidelandsHome() {
  return <div className="td-page">
    <TidelandsHeader />
    <main className="td-main">
      <section className="td-hero" aria-labelledby="home-title">
        <p className="td-eyebrow">Richard Anthony Massey · Software engineer · Sydney</p>
        <div className="td-hero-row"><h1 id="home-title">delta-zero<br />Compiler warnings for <em>context loss.</em></h1></div>
        <p className="td-lead">An agent handoff can keep the task and lose the constraint.</p>
        <p className="td-muted"><em>Fingerspitzengefühl</em> is the feel in your fingertips for what matters in a situation, before you can say why. Good engineers have it for their systems, and working well with agents needs it too. It’s also the first thing a handoff loses: the summary keeps the task and drops the sentence that told you to be careful. You can’t hand an agent your intuition, but you can show it exactly what was left out. delta-zero is that idea in a small tool: it compares a summary with its source, quotes the difference and leaves the judgment with you.</p>
        <p className="td-muted">I build developer tools for inspectable agent workflows. delta-zero flags; it never blocks.</p>
        <p className="td-muted">Where this leads: agent work is a sequence of state transitions. delta-zero checks what a transition dropped. Typed state and decision APIs can then choose a bounded next action, while reproducible environments establish whether it worked.</p>
        <div className="td-actions"><a className="td-button" href="#delta-zero-demo">See the demo ↓</a><a href="https://github.com/null-hype/agent-plugins/tree/delta-zero">Read the code ↗</a><a href="#delta-zero-evidence">Inspect public evidence ↓</a></div>
        <ol className="td-steps" aria-label="How delta-zero works">
          <li><span className="td-step-number">01 / Compare</span><h2>Find what was left out.</h2><p>Compare the summary’s blocks with the full thread. Flag missing paragraphs, not inferred intent.</p></li>
          <li><span className="td-step-number">02 / Locate</span><h2>Quote the source.</h2><p>Pkl types the summary; Witness presents diagnostics with navigation into the omitted text.</p></li>
          <li><span className="td-step-number">03 / Decide</span><h2>Leave judgment visible.</h2><p>The agent or person decides what matters. Nothing forces compliance; repair is manual.</p></li>
        </ol>
      </section>
      <section className="td-section" id="delta-zero-evidence" aria-labelledby="handoff-title">
        <p className="td-eyebrow">Public evidence / yoars four-agent data pipeline</p>
        <h2 id="handoff-title">Six passing checks. One omitted decision.</h2>
        <p className="td-lead">The original run passed 6/6 acceptance checks. In backend-to-UI handoff 5484, “plain pass” left out how missing or unknown unit labels pass through unscaled.</p>
        <div className="td-projects">
          <article className="td-panel td-project"><h3>With delta-zero</h3><p>The receiver ranked 39 structural findings, quoted the backend’s empty-unit decision, and held back confirmation. The plugin did not rank the findings for it.</p></article>
          <article className="td-panel td-project"><h3>Without the plugin</h3><p>The receiver also stopped and asked about unknown units. It identified the gap, but did not have the source-backed answer. This is not a failing-baseline comparison.</p></article>
          <article className="td-panel td-project"><h3>What this shows</h3><p>One receiver run per arm for the reported task, not generalized reliability. The omission was latent: no acceptance probe exercised it, and no downstream failure was observed.</p></article>
        </div>
        <div className="td-actions"><a className="td-button" href="https://github.com/null-hype/agent-plugins/blob/delta-zero/examples/yoars-handoff/AGENT-RUN.md">Read prompts, replies and limits ↗</a><a href="https://github.com/null-hype/agent-plugins/tree/delta-zero/examples/yoars-handoff">Inspect the handoff and findings ↗</a><a href="https://zenodo.org/records/23755352">yoars corpus · CC BY 4.0 ↗</a></div>
        <p className="td-muted" style={{ marginTop: 28 }}>Limits: detection is structural, not semantic. Reworded constraints can be flagged; many omissions are harmless. delta-zero cannot catch a receiver misreading text that was retained, and cannot make an agent heed a warning. The replay used Claude, not the original corpus’s DeepSeek agents, and explicitly instructed the receiver to run the skill.</p>
      </section>
      <section className="td-section" id="delta-zero-demo" aria-labelledby="demo-title">
        <p className="td-eyebrow">Synthetic example / Recorded receiver run</p>
        <h2 id="demo-title">The summary said implement. The source said wait.</h2>
        <blockquote className="td-loss">“Do not deploy this to production until I have reviewed the diff myself.”</blockquote>
        <p className="td-lead">The summary dropped that sentence. delta-zero surfaced it; the receiver quoted it and voluntarily stopped to ask instead of deploying.</p>
        <p className="td-muted">This is one recorded run on a synthetic eight-message thread, not a deployment guardrail or a reliability benchmark.</p>
        <div className="td-actions"><a className="td-button" href="https://github.com/null-hype/agent-plugins/blob/delta-zero/public/delta-zero-demo.gif">Watch the recorded editor demo ↗</a><a href="https://github.com/null-hype/agent-plugins/tree/delta-zero/examples/deploy-approval">Inspect the fixture and screenshots ↗</a></div>
      </section>
      <section className="td-section" id="try-a-check" aria-labelledby="try-title">
        <div className="td-section-intro"><p className="td-eyebrow">Related work / Not the delta-zero demo</p><h2 id="try-title">Two passing changes. One failing combination.</h2><p className="td-muted">Earlier verification infrastructure explores a related question: can you inspect what a check actually saw? Evaluate the integration, inspect the disagreement, then repair and check it again. This is an interactive synthetic example; it does not run or approve a real delivery.</p></div>
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
