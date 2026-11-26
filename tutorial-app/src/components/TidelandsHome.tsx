import DeltaFeed from './DeltaFeed';
import homepage from '../feed/homepage.recording.json';
import ThreadInvite from './ThreadInvite';
import type { ReplayRecording } from '../lib/acpReplayContract';
import { TidelandsFooter, TidelandsHeader } from './TidelandsChrome';
import './Tidelands.css';

export default function TidelandsHome() {
  return <div className="td-page">
    <TidelandsHeader />
    <main className="td-main td-home">
      <section className="td-hero" aria-labelledby="work-title"><p className="td-eyebrow">Richard Anthony Massey · Software engineer · Sydney</p><h1 id="work-title">Build tools people can trust and inspect.</h1><p className="td-lead">Available for senior engineering roles and selected consulting.</p><p className="td-muted">My background spans production web applications at Bloomberg and XO Group, test automation and platform engineering. I’m interested in software, security and AI infrastructure, verification and agent workflows.</p><div className="td-actions"><a className="td-button" href="mailto:richard@tidelands.dev">Talk about working together ↗</a><a href="https://www.linkedin.com/in/richardanthonydev/">LinkedIn ↗</a><a href="https://github.com/null-hype/agent-plugins/tree/delta-zero">Read the delta-zero code ↗</a></div><p style={{ marginTop: 20 }}><a href="mailto:richard@tidelands.dev">richard@tidelands.dev</a></p></section>
      <p><a href="https://null-hype.tidelands.dev/part-3/proposal-p-against-the-budget/1-jev-types-the-answer/">Walk through Budget Authority ↗</a></p>
      <section className="td-section td-feed-hero" id="thread">
        <h2 id="thread-title">The handoff</h2>
        <DeltaFeed recording={homepage as ReplayRecording} end={<ThreadInvite />} showSpeakerAvatars />
      </section>
    </main>
    <TidelandsFooter />
  </div>;
}
