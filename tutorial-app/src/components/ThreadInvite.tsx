import { useEffect, useState } from 'react';

/** Résumé links carry ?r=<role> so the card can greet the reader and name the role in the email. */
const ROLES: Record<string, string> = { openai: 'OpenAI', cognition: 'Cognition', sierra: 'Sierra', relevance: 'Relevance AI' };
const EMAIL = 'richard@tidelands.dev';

export default function ThreadInvite() {
  const [role, setRole] = useState('');
  useEffect(() => { setRole(new URLSearchParams(window.location.search).get('r') ?? ''); }, []);
  const company = ROLES[role.toLowerCase()];

  const subject = company ? `Invite me to the run (${company} application)` : 'Invite me to the run';
  const body = "Hi Richard,\n\nPlease invite me to the four-agent run in Delta.\n\nDelta username (if you have one): \n";
  const mail = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div className="ti">
      <p className="df-speaker" style={{ color: 'var(--td-accent, #a23924)' }}>Richard</p>
      {company && <p className="ti-hello">Thanks for reading my {company} application.</p>}
      <h2 className="ti-title">Want to inspect the rest of this run?</h2>
      <p>Email me and I'll invite you to the four-agent run in Delta.</p>
      <p className="ti-actions"><a className="ti-cta" href={mail}>Invite me</a> <a href={`mailto:${EMAIL}`}>{EMAIL}</a></p>
      <p className="ti-or"><a href="https://www.linkedin.com/in/richardanthonydev/">LinkedIn ↗</a></p>
    </div>
  );
}
