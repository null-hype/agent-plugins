import './PortfolioLanding.css';

/** Rendered as static HTML by Astro; shared with Storybook without hydration. */
export function PortfolioLanding() {
  return <div className="portfolio">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="masthead">
      <a className="identity" href="/" aria-label="Tidelands home">
        <img src="/logo.svg" alt="" width="42" height="42" />
        <span>Tidelands<span className="identity-sub">Richard Anthony / null-hype</span></span>
      </a>
      <nav aria-label="Main navigation"><a href="#evidence">The work</a><a href="#work">Get in touch <span aria-hidden="true">↗</span></a></nav>
    </header>
    <main id="main" tabIndex={-1}>
      <section className="hero" aria-labelledby="headline">
        <p className="eyebrow"><span className="index-label">Independent practice</span> Software engineer · Sydney</p>
        <div className="headline-row">
          <h1 id="headline"><span className="cut-type">Verification</span><br /><em>infrastructure</em><span className="headline-tail">for agent-produced<br className="desktop-break" /> software.</span></h1>
          <aside className="paper-note" aria-label="Approach">
            <span className="note-label">Field note / 01</span>
            <p>A log of<br /><strong>evidence.</strong></p>
            <span className="note-foot">Capture. Check. Preserve.</span>
          </aside>
        </div>
        <div className="hero-bottom">
          <p className="intro">A green check should lead to evidence you can inspect. I build tools to preserve what the check saw and put the finding back on the source.</p>
          <div className="actions"><a className="primary" href="https://github.com/null-hype/worlds#start-here-one-exact-world-proof">Inspect the Worlds proof <span aria-hidden="true">↗</span></a><span className="action-note">Runnable example. Evidence included.</span></div>
        </div>
      </section>
      <section className="evidence" aria-labelledby="evidence">
        <div className="section-heading"><h2 id="evidence">Start with the evidence</h2><span className="eyebrow">Selected work / 01–03</span></div>
        <article className="evidence-row">
          <span className="item-number" aria-hidden="true">01</span>
          <h3><a href="https://github.com/null-hype/worlds">Worlds <span aria-hidden="true">↗</span></a></h3>
          <div><p>Capture delivery evidence. Restore an exact snapshot. Judge a registered claim.</p><p className="detail">Synthetic replay, real store and judge. No API keys. Commands, limits and CI artifacts on GitHub.</p></div>
          <span className="evidence-tag">Preserve the world</span>
        </article>
        <article className="evidence-row">
          <span className="item-number" aria-hidden="true">02</span>
          <h3><a href="https://github.com/null-hype/witness">Witness <span aria-hidden="true">↗</span></a></h3>
          <div><p>Bring durable findings to the source in your editor. Follow the evidence and see when the source has changed.</p><p className="detail">A separate presentation boundary, with its own runnable example.</p></div>
          <span className="evidence-tag">Read the finding</span>
        </article>
        <article className="evidence-row">
          <span className="item-number" aria-hidden="true">03</span>
          <h3><a href="/part-5/can-an-upload-read-a-private-file/1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one/">The demonstration <span aria-hidden="true">→</span></a></h3>
          <div><p>Can a private-file check tell a real read from forged evidence? Explore the check and the review that challenges it.</p><p className="detail">An interactive prototype, not a production security guarantee.</p></div>
          <span className="evidence-tag">Question the check</span>
        </article>
      </section>
      <section className="work" aria-labelledby="work">
        <div><span className="availability">Open to opportunities</span><h2 id="work">Work<br /><em>with me.</em></h2></div>
        <div className="work-copy"><p>I’m Richard Anthony, a software engineer based in Sydney. My background spans production web applications at Bloomberg and XO Group, test automation and platform engineering.</p><p>Available for senior software, security and AI infrastructure roles, and selected consulting.</p><a className="contact" href="mailto:public.rant@pm.me">public.rant@pm.me <span aria-hidden="true">↗</span></a><a className="linkedin" href="https://www.linkedin.com/in/richardanthonydev/">Find me on LinkedIn <span aria-hidden="true">↗</span></a></div>
      </section>
    </main>
    <footer><span className="footer-wordmark">Null <em>hype.</em></span><p>A log of evidence.</p><div><a href="https://github.com/null-hype">GitHub <span aria-hidden="true">↗</span></a><a href="https://github.com/null-hype/agent-plugins">Research monorepo <span aria-hidden="true">↗</span></a></div></footer>
  </div>;
}
