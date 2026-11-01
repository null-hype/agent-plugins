import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimReportView } from '../src/components/ClaimReport';
import CheckBadge from '../src/components/CheckBadge';
import { EvidenceLine, EvidenceListing } from '../src/components/EvidenceLines';

// Go supplies escaped values and the original JSON at publish time. The layout
// and primitives are the same ones exercised by the report's Storybook stories.
export function renderTemplate(app: string) {
  const css = ['Tidelands.css', 'CheckBadge.css', 'EvidenceLines.css'].map(name => readFileSync(`${app}/src/components/${name}`, 'utf8')).join('\n');
  const body = renderToStaticMarkup(
    <ClaimReportView identifier="{{.Issue.Identifier}}" title="{{.Issue.Title}}" description={<EvidenceListing>{'{{range .DescriptionLines}}'}<EvidenceLine number="{{.Number}}">{'{{.Text}}'}</EvidenceLine>{'{{end}}'}</EvidenceListing>} verdict={<CheckBadge kind="{{.Outcome}}">{'{{.Verdict}}'}</CheckBadge>} exit="{{.Exit}}" check="{{.Check}}" trace={<>{'{{if .Trace}}'}<a href="{{.Trace}}" rel="noreferrer">Open trace ↗</a>{'{{else}}'}Unavailable{'{{end}}'}</>} snapshot={<>{'{{if .Snapshot.ID}}'}<code>{'{{.Snapshot.ID}}'}</code>{'{{if .Snapshot.URL}}'} · <a href="{{.Snapshot.URL}}" rel="noreferrer">Snapshot evidence ↗</a>{'{{end}}'}{'{{else}}'}Unavailable for this rerun{'{{end}}'}</>} runKey="{{.Snapshot.RunKey}}" delivery="{{.Delivery}}" xenoName="{{.XenoName}}" xenoType="{{.XenoType}}" visibility={<>{'{{if .Public}}'}Public report. Later reruns replace the result at this URL.{'{{else}}'}Unlisted report · noindex. Anyone with this link can view it. Later reruns replace the result at this URL.{'{{end}}'}</>} />
  );
  // React 19 hoists metadata, so a conditional <meta> cannot be placed
  // between template directives inside JSX. Keep the trusted document shell
  // here and let Go escape issue text and enforce the public/private branch.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Issue.Title}}</title>{{if not .Public}}<meta name="robots" content="noindex">{{end}}
<meta name="referrer" content="no-referrer"><style>${css}</style></head>
<body style="margin:0">${body}<script id="claim-data" type="application/json">{{.Data}}</script></body></html>\n`;
}
