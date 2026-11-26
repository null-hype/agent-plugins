export default function ThreadSpeaker({ name, human }: { name: string; human: boolean }) {
  const [speaker, detail] = name.split(' · ', 2);

  return (
    <div className={`df-byline${human ? ' df-byline-human' : ''}`}>
      <span className="df-avatar" role="img" aria-label={name}>
        {human ? <span aria-hidden="true">RM</span> : (
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
            <path d="M8 4V2M2 8H1m14 0h-1" />
            <rect x="2.5" y="4" width="11" height="9" rx="2" />
            <path d="M6 8h.01M10 8h.01" strokeWidth="2" />
          </svg>
        )}
      </span>
      <span className="df-byline-caption" aria-hidden="true">
        {speaker}{detail && <span className="df-byline-detail">{detail}</span>}
      </span>
    </div>
  );
}
