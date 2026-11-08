import IntegrationCheck from './IntegrationCheck';
import { SiteFooter, SiteHeader } from './SiteChrome';
import './Professional.css';

const REVIEW = '/part-5/can-an-upload-read-a-private-file/1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one/';

const reading = [
  { name: 'Worlds', href: 'https://github.com/null-hype/worlds#start-here-one-exact-world-proof', body: 'Capture delivery evidence, restore an exact snapshot, and judge a registered claim. The smallest runnable example preserves a disagreement even after a newer passing world replaces its label.' },
  { name: 'Witness', href: 'https://github.com/null-hype/witness', body: 'Durable findings on the source in the editor, with navigation to the evidence and detection of source changes.' },
  { name: 'Challenge a check', href: REVIEW, body: 'A recorded review of a private-file check, challenged with forged evidence. Four turns; each finding opens onto the evidence behind it.' },
  { name: 'Walkthrough', href: '/part-0/overview/start/', body: 'The interactive tutorial: what a passing check actually tells you, and where to go next depending on your question.' },
  { name: 'Source', href: 'https://github.com/null-hype/agent-plugins', body: 'The checks, Pkl policies, tutorial application and Storybook components behind these pages.' },
];

export default function ResearchPage() {
  return <div className="pro-page">
    <SiteHeader />
    <main className="pro-main">
      <section className="pro-hero pro-hero-compact" aria-labelledby="research-title">
        <p className="pro-eyebrow">Research</p>
        <h1 id="research-title">Research and demonstrations</h1>
        <p className="pro-lead">The material behind the selected work: an interactive example, the source repositories and a recorded review. These are research prototypes on synthetic fixtures, not production controls.</p>
      </section>
      <section className="pro-section" aria-labelledby="try-title">
        <h2 id="try-title">Two passing changes. One failing combination.</h2>
        <p className="pro-intro">Evaluate the integration, inspect the disagreement, then repair and check it again. This is an interactive synthetic example; it does not run or approve a real delivery.</p>
        <div className="pro-demo"><IntegrationCheck /></div>
        <noscript><p>The interactive example needs JavaScript. <a href="https://github.com/null-hype/worlds#start-here-one-exact-world-proof">Read the runnable Worlds proof and its evidence instead.</a></p></noscript>
      </section>
      <section className="pro-section" aria-labelledby="reading-title">
        <h2 id="reading-title">Read and run</h2>
        <ul className="pro-reading">
          {reading.map(({ name, href, body }) => <li key={name}><h3><a href={href}>{name}</a></h3><p>{body}</p></li>)}
        </ul>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
