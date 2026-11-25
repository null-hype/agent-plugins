import DeltaFeed from './DeltaFeed';
import signalHierarchy from '../feed/signal-hierarchy.recording.json';
import type { ReplayRecording } from '../lib/acpReplayContract';
import { TidelandsFooter, TidelandsHeader } from './TidelandsChrome';
import './Tidelands.css';

export default function TidelandsHome() {
  return <div className="td-page">
    <TidelandsHeader />
    <main className="td-main">
      <section className="td-hero" aria-label="How I work with agents">
        <p className="td-eyebrow">Richard Anthony Massey · Software engineer · Sydney</p>
        <h1>How I work with agents.</h1>
        <p className="td-lead">The thread where my agents and I designed this page. Swipe up to step through it; swipe right to step in.</p>
        <DeltaFeed recording={signalHierarchy as ReplayRecording} />
      </section>
      <section className="td-section" aria-labelledby="work-title"><p className="td-eyebrow">Work together</p><h2 id="work-title">Build tools people can trust and inspect.</h2><p className="td-lead">Available for senior engineering roles and selected consulting.</p><p className="td-muted">My background spans production web applications at Bloomberg and XO Group, test automation and platform engineering. I’m interested in software, security and AI infrastructure, verification and agent workflows.</p><div className="td-actions"><a className="td-button" href="mailto:richard@tidelands.dev">Talk about working together ↗</a><a href="https://www.linkedin.com/in/richardanthonydev/">LinkedIn ↗</a><a href="https://github.com/null-hype/agent-plugins/tree/delta-zero">Read the delta-zero code ↗</a></div><p style={{ marginTop: 20 }}><a href="mailto:richard@tidelands.dev">richard@tidelands.dev</a></p></section>
    </main>
    <TidelandsFooter />
  </div>;
}
