import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimReportView } from '../src/components/ClaimReport';
import { PreregistrationFrame, PreregistrationBody, PredictionLine, ClaimFinding } from '../src/components/ClaimPreregistration';

// Go supplies escaped values and the original JSON at publish time. The layout
// and primitives are the same ones exercised by the report's Storybook stories.
export function renderTemplate(app: string, script: string) {
  const css = ['TidelandsHero.css', 'TidelandsReport.css', 'ClaimReport.css', 'TidelandsContact.css', 'EvidenceLines.css', 'ClaimPreregistration.css'].map(name => readFileSync(`${app}/src/components/${name}`, 'utf8')).join('\n');
  const body = renderToStaticMarkup(
    <ClaimReportView identifier="{{.Issue.Identifier}}" check="{{.Check}}" title="{{.Issue.Title}}" verdict={'{{.Verdict}}'} trace={<>{'{{if .Trace}}'}<a href="{{.Trace}}" rel="noreferrer">Trace ↗</a>{'{{else}}'}No trace{'{{end}}'}</>} preregistration={<>{'{{if .PreregistrationView}}'}<PreregistrationFrame file="{{.PreregistrationView.File}}"><div data-static-preregistration=""><PreregistrationBody source="{{.PreregistrationView.Source}}" notice="{{.PreregistrationView.Notice}}">{'{{range .PreregistrationView.Lines}}'}<PredictionLine number="{{.Number}}" text="{{.Text}}" highlighted="{{if .Diagnostics}}true{{end}}">{'{{range .Diagnostics}}'}<ClaimFinding line="{{.Line}}" column="{{.Column}}" severity="{{.Severity}}" message="{{.Message}}" evidence={<>{'{{if .Evidence}}'}<p className="td-finding-evidence">Evidence paths: {'{{range .Evidence}}'}{'{{.}}'}{' '} {'{{end}}'}</p>{'{{end}}'}</>} />{'{{end}}'}</PredictionLine>{'{{end}}'}</PreregistrationBody></div></PreregistrationFrame>{'{{end}}'}</>} />
  );
  // React 19 hoists metadata, so a conditional <meta> cannot be placed
  // between template directives inside JSX. Keep the trusted document shell
  // here and let Go escape issue text and enforce the public/private branch.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Issue.Title}}</title>{{if not .Public}}<meta name="robots" content="noindex">{{end}}
<meta name="referrer" content="no-referrer"><style>${css}</style></head>
<body style="margin:0">${body}<script id="claim-data" type="application/json">{{.Data}}</script><script>${script}</script></body></html>\n`;
}
