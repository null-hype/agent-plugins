import logo from '../../public/logo.svg?raw';

export function TidelandsHeader({ report = false }: { report?: boolean }) {
  return <header className="td-header">
    <a className="td-brand" href="https://www.tidelands.dev/" aria-label="Tidelands home"><span className="td-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logo }} />Tidelands<span>/ {report ? 'Check report' : 'Null Hype'}</span></a>
    <nav aria-label="Main navigation"><a href="https://github.com/null-hype/worlds">Worlds ↗</a><a href="https://github.com/null-hype/agent-plugins">Source ↗</a></nav>
  </header>;
}

export function TidelandsFooter() {
  return <footer className="td-footer"><span>A log of evidence.</span><a href="mailto:public.rant@pm.me">Work with Richard ↗</a></footer>;
}
