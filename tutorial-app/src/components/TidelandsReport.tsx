import report from './report/report.json';
import './TidelandsReport.css';

// A report built from checks: one paragraph per Dagger module, in the order
// they have to be trusted, each with its status in the margin. The content is
// report/Report.pkl, rendered to report/report.json.
export default function TidelandsReport() {
  return <section className="td-report" aria-labelledby="report-title">
    <h2 id="report-title">{report.title}</h2>
    {report.paragraphs.map(p => <div key={p.check} className="td-report-paragraph"><p>{p.text}</p><span>{p.status}</span></div>)}
  </section>;
}
