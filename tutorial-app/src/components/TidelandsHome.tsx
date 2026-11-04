import { CONTACT_EMAIL, CONTACT_HREF, GITHUB_HREF, LINKEDIN_HREF, SiteFooter, SiteHeader } from './SiteChrome';
import './Professional.css';

const REVIEW = '/part-5/can-an-upload-read-a-private-file/1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one/';

const expertise = [
  { title: 'AI & agent infrastructure', body: 'Workflows that let AI agents change real systems without anyone losing track of what they were asked to do, what they touched, and who approved it.' },
  { title: 'Security & verification', body: 'Checks that hold up when challenged. Test and review design that survives forged or misleading evidence, and records exactly what a check saw so a result can be re-examined later.' },
  { title: 'Developer infrastructure', body: 'Test automation, CI and platform tooling for teams shipping production software: reproducible environments, dependable pipelines, and feedback developers trust.' },
];

const work = [
  {
    name: 'Worlds', href: 'https://github.com/null-hype/worlds', cta: 'Source and runnable example ↗',
    problem: 'When AI agents propose code changes, two changes can each pass review and still fail together. Afterwards, nobody can show exactly what the check saw.',
    built: 'A system that captures the inputs and records behind a delivery as an exact snapshot, then checks a requirement recorded before the run against that snapshot and keeps the trace.',
    why: 'A disagreement stays reproducible and auditable, even after a newer passing version replaces it.',
    note: 'Research prototype. The example runs on synthetic replay with a real store and judge, and needs no API keys.',
  },
  {
    name: 'Witness', href: 'https://github.com/null-hype/witness', cta: 'Source and runnable example ↗',
    problem: 'Verification results usually live in CI logs, away from the code they are about, and go stale without anyone noticing.',
    built: 'Editor tooling that shows durable findings directly on the source, links each to its evidence, and detects when the source has changed since the finding was made.',
    why: 'Reviewers and agents see what a check concluded where they are reading, and know when to stop trusting it.',
  },
  {
    name: 'Challenging a security check', href: REVIEW, cta: 'Follow the recorded review →',
    problem: 'A passing check is only worth what it can detect. A check that claims an upload cannot read a private file can be satisfied by forged evidence.',
    built: 'A recorded review of one real check: three pull requests that each said the check was sound, and the reviews that found it was not. The reviewer edits the evidence and re-runs the author’s own checker.',
    why: 'It shows how to find what a security check actually verifies, rather than what its name claims.',
  },
];

export default function TidelandsHome() {
  return <div className="pro-page">
    <SiteHeader />
    <main className="pro-main">
      <section className="pro-hero" aria-labelledby="home-title">
        <p className="pro-eyebrow">Sydney, Australia · Available for consulting and senior engineering roles</p>
        <h1 id="home-title">Richard Anthony</h1>
        <p className="pro-role">Senior software &amp; security engineer</p>
        <p className="pro-lead">I build developer infrastructure, verification systems and agentic software workflows where correctness and auditability matter.</p>
        <p className="pro-intro">Production software experience at Bloomberg and XO Group.</p>
        <div className="pro-actions"><a className="pro-button" href={CONTACT_HREF}>Discuss a project</a><a className="pro-button pro-button-secondary" href="#work">See selected work</a></div>
      </section>

      <section className="pro-section" id="expertise" aria-labelledby="expertise-title">
        <h2 id="expertise-title">What I can help with</h2>
        <div className="pro-grid">
          {expertise.map(({ title, body }) => <article key={title} className="pro-card"><h3>{title}</h3><p>{body}</p></article>)}
        </div>
      </section>

      <section className="pro-section" id="work" aria-labelledby="work-title">
        <h2 id="work-title">Selected work</h2>
        <p className="pro-intro">Three projects, each with source or a recorded walkthrough you can inspect.</p>
        <div className="pro-work">
          {work.map(({ name, href, cta, problem, built, why, note }) => <article key={name} className="pro-project">
            <h3>{name}</h3>
            <dl>
              <div><dt>The problem</dt><dd>{problem}</dd></div>
              <div><dt>What I built</dt><dd>{built}</dd></div>
              <div><dt>Why it matters</dt><dd>{why}</dd></div>
            </dl>
            {note && <p className="pro-project-note">{note}</p>}
            <p className="pro-project-link"><a href={href}>{cta}</a></p>
          </article>)}
        </div>
        <p className="pro-more">More material, including an interactive example, is on the <a href="/research">research page</a>.</p>
      </section>

      <section className="pro-section" id="about" aria-labelledby="about-title">
        <h2 id="about-title">Background</h2>
        <div className="pro-about">
          <p>I have built and shipped production web applications at <strong>Bloomberg</strong> and <strong>XO Group</strong>, and spent much of my career on test automation, developer tooling and platform engineering.</p>
          <p>That grounding in production software is what my current work builds on: AI agent infrastructure and verification that engineering and security teams can trust.</p>
          <p className="pro-links"><a href={LINKEDIN_HREF}>LinkedIn ↗</a><a href={GITHUB_HREF}>GitHub ↗</a></p>
        </div>
      </section>

      <section className="pro-section pro-contact" id="contact" aria-labelledby="contact-title">
        <h2 id="contact-title">Let’s talk</h2>
        <p className="pro-lead">I’m open to consulting engagements, difficult engineering and security problems, and senior engineering roles.</p>
        <div className="pro-actions"><a className="pro-button" href={CONTACT_HREF}>Discuss a project</a><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></div>
        <p className="pro-fine">A short description of the problem and your timeline is plenty to start.</p>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
