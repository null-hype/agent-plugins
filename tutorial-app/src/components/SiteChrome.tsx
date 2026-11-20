import logo from '../../public/logo.svg?raw';

export const CONTACT_EMAIL = 'public.rant@pm.me';
export const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Discussing a project')}`;
export const LINKEDIN_HREF = 'https://www.linkedin.com/in/richardanthonydev/';
export const GITHUB_HREF = 'https://github.com/null-hype';

// Header and footer of the professional pages (home, research). The claim
// report keeps its own chrome in TidelandsChrome: its markup is exported into
// the toolbox's claim-page template, so it is deliberately not shared.
export function SiteHeader() {
  return <header className="pro-header">
    <a className="pro-brand" href="/"><span className="pro-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logo }} />Richard Anthony</a>
    <nav aria-label="Main navigation"><a href="/#work">Work</a><a href="/research">Research</a><a href="/#about">About</a><a href="/#contact">Contact</a></nav>
  </header>;
}

export function SiteFooter() {
  return <footer className="pro-footer">
    <span>Richard Anthony · Sydney, Australia</span>
    <span className="pro-footer-links"><a href={GITHUB_HREF}>GitHub ↗</a><a href={LINKEDIN_HREF}>LinkedIn ↗</a><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></span>
  </footer>;
}
