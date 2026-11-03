import './TidelandsReport.css';

// A report built from checks: one paragraph per Dagger module, in the order
// they have to be trusted, each with its status in the margin. Hand-written
// for now from null-hype/godel-check.
const paragraphs = [
  { text: 'A sentence that says "this sentence has five words" is true, so a judge that understands it should say so. I predicted 0.9.', status: 'Not run' },
  { text: '"This sentence has three words" is false. I predicted close to 0.', status: 'Not run' },
  { text: 'The liar has no consistent truth value. I predicted the judge would split the difference at 0.5. It answered 0.13, 0.12 and 0.12. This can\'t be read until both paragraphs above have held.', status: 'Missed' },
];

export default function TidelandsReport() {
  return <section className="td-report" aria-labelledby="report-title">
    <h2 id="report-title">This sentence is false.</h2>
    {paragraphs.map(p => <div key={p.text} className="td-report-paragraph"><p>{p.text}</p><span>{p.status}</span></div>)}
  </section>;
}
