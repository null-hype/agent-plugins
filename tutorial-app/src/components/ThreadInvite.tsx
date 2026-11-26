import { useEffect, useState } from 'react';
import ThreadSpeaker from './ThreadSpeaker';

/** Résumé links carry ?r=<role> so the card can greet the reader and name the role in the email. */
const ROLES: Record<string, string> = { openai: 'OpenAI', cognition: 'Cognition', sierra: 'Sierra', relevance: 'Relevance AI' };
const EMAIL = 'richard@tidelands.dev';

export default function ThreadInvite() {
  const [role, setRole] = useState('');
  useEffect(() => { setRole(new URLSearchParams(window.location.search).get('r') ?? ''); }, []);
  const company = ROLES[role.toLowerCase()];

  const request = 'Send me the replay';
  const subject = company ? `${request} (${company} application)` : request;
  const body = "Hi Richard,\n\nPlease send me your handoff replay and source-linked findings.\n";
  const mail = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div className="ti">
      <ThreadSpeaker name="Richard" human />
      {company && <p className="ti-hello">Thanks for reading my {company} application.</p>}
      <h2 className="ti-title">Want the replay and source notes?</h2>
      <p>Email me and I’ll send them.</p>
      <p className="ti-actions"><a className="ti-cta" href={mail}>{request}</a> <a href={`mailto:${EMAIL}`}>{EMAIL}</a></p>
      <p className="ti-or"><a href="https://www.linkedin.com/in/richardanthonydev/">LinkedIn ↗</a></p>
    </div>
  );
}
