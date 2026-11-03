import reportJson from './report/report.json';
import './TidelandsReport.css';

// The homepage report: one entry per published check, from report/Home.pkl as
// rendered to report/report.json. Statuses are computed by report/Report.pkl.
type Paragraph = { id: string; text: string; href?: string; control: boolean; prediction?: number; requires: string[]; answers: number[]; mean?: number; status: string };
type Report = { title: string; brier?: number; paragraphs: Paragraph[] };
const report = reportJson as Report;

const round = (x: number) => x.toFixed(2).replace(/\.?0+$/, '') || '0';

function numbers(p: Paragraph) {
  if (p.prediction === undefined) return undefined;
  return `Predicted ${round(p.prediction)} · ${p.mean === undefined ? 'not run' : `Jev ${round(p.mean)}`}`;
}

function note(p: Paragraph) {
  return p.status === 'Inconclusive' ? `Can't be read until ${p.requires.join(' and ')} hold.` : undefined;
}

export function ReportView({ report }: { report: Report }) {
  return <section className="td-report" aria-labelledby="report-title">
    <h2 id="report-title">{report.title}</h2>
    {report.paragraphs.map(p => <div key={p.id} className="td-report-paragraph">
      <div>
        <p className="td-report-id">{p.id}</p>
        <p>{p.href ? <a href={p.href}>{p.text}</a> : p.text}{p.control && <em> Control.</em>}</p>
        {numbers(p) && <p className="td-report-numbers">{numbers(p)}</p>}
        {note(p) && <p className="td-report-numbers">{note(p)}</p>}
      </div>
      <span>{p.status}</span>
    </div>)}
    {report.brier !== undefined && <p className="td-report-numbers">Brier {round(report.brier)}</p>}
  </section>;
}

export default function TidelandsReport() {
  return <ReportView report={report} />;
}
