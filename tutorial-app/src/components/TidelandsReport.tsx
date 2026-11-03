import reportJson from './report/report.json';
import './TidelandsReport.css';

// A graded report built from checks: one paragraph per question, in the order
// they have to be trusted. Everything here comes from report/Report.pkl as
// rendered to report/report.json; the statuses are computed by its scoring.
type Paragraph = { id: string; text: string; control: boolean; prediction: number; requires: string[]; answers: number[]; mean?: number; brier?: number; status: string };
type Report = { title: string; tampered: boolean; brier?: number; paragraphs: Paragraph[] };
const report = reportJson as Report;

const round = (x: number) => x.toFixed(2).replace(/\.?0+$/, '') || '0';

function numbers(p: Paragraph) {
  const jev = p.mean === undefined ? 'not run' : `Jev ${round(p.mean)}`;
  return `Predicted ${round(p.prediction)} · ${jev}`;
}

function note(p: Paragraph) {
  return p.status === 'Inconclusive' ? `Can't be read until ${p.requires.join(' and ')} hold.` : undefined;
}

export default function TidelandsReport() {
  return <section className="td-report" aria-labelledby="report-title">
    <h2 id="report-title">{report.title}</h2>
    {report.paragraphs.map(p => <div key={p.id} className="td-report-paragraph">
      <div>
        <p>{p.text}{p.control && <em> Control.</em>}</p>
        <p className="td-report-numbers">{numbers(p)}</p>
        {note(p) && <p className="td-report-numbers">{note(p)}</p>}
      </div>
      <span>{p.status}</span>
    </div>)}
    {report.brier !== undefined && <p className="td-report-numbers">Brier {round(report.brier)}</p>}
  </section>;
}
