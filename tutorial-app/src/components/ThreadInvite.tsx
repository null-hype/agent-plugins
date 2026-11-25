import { useEffect, useState, type FormEvent } from 'react';

/** Résumé links carry ?r=<role> so the card can greet the reader and tag the request. */
const ROLES: Record<string, string> = { openai: 'OpenAI', cognition: 'Cognition', sierra: 'Sierra', relevance: 'Relevance AI' };
export const INVITE_FORM = 'thread-invite';

export default function ThreadInvite() {
  const [role, setRole] = useState('');
  const [contact, setContact] = useState('');
  const [honey, setHoney] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  useEffect(() => { setRole(new URLSearchParams(window.location.search).get('r') ?? ''); }, []);
  const company = ROLES[role.toLowerCase()];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState('sending');
    const body = new URLSearchParams({ 'form-name': INVITE_FORM, contact, source: role || 'direct', 'bot-field': honey });
    try {
      const res = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      setState(res.ok ? 'sent' : 'failed');
    } catch {
      setState('failed');
    }
  };

  const mail = `mailto:richard@tidelands.dev?subject=${encodeURIComponent('The Delta thread')}&body=${encodeURIComponent(`Please send me the thread: ${contact}`)}`;

  return (
    <div className="ti">
      <p className="df-speaker df-you-speaker">Richard</p>
      {company && <p className="ti-hello">Thanks for reading my {company} application.</p>}
      <h2 className="ti-title">Want the full thread?</h2>
      <p>It's in Delta, with the forks, the subagents and the wrong turns. Leave your email or Delta username and I'll invite you.</p>
      {/* The live region stays mounted so the confirmation is announced when it fills. */}
      <div role="status">{state === 'sent' && <p className="ti-done">Thanks. I'll send you the invite.</p>}</div>
      {state !== 'sent' && (
        <form className="ti-form" onSubmit={submit}>
          <label htmlFor="ti-contact" className="ti-label">Email or Delta username</label>
          <input id="ti-contact" name="contact" required autoComplete="email" placeholder="you@company.com" value={contact} onChange={(e) => setContact(e.target.value)} />
          <p hidden><label>Leave this empty <input name="bot-field" tabIndex={-1} autoComplete="off" value={honey} onChange={(e) => setHoney(e.target.value)} /></label></p>
          <button type="submit" className="td-button" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send me the thread'}</button>
        </form>
      )}
      {state === 'failed' && <p role="alert">That didn't go through. <a href={mail}>Email me instead</a>.</p>}
      <p className="ti-or">Or write to <a href="mailto:richard@tidelands.dev">richard@tidelands.dev</a> · <a href="https://www.linkedin.com/in/richardanthonydev/">LinkedIn ↗</a></p>
    </div>
  );
}
