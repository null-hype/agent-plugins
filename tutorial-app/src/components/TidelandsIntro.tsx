import reportJson from './report/report.json';
import './TidelandsIntro.css';

// The intro's words come from report/Home.pkl, with the checks they introduce.
export function IntroView({ paragraphs }: { paragraphs: string[] }) {
  return <section className="td-intro" aria-label="Introduction">
    {paragraphs.map((text, i) => <p key={i} className={i === 0 ? 'td-intro-lead' : undefined}>{text}</p>)}
  </section>;
}

export default function TidelandsIntro() {
  return <IntroView paragraphs={reportJson.intro} />;
}
