import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Workbench from '../lesson-farms/follower-maze/Workbench';
import { serializeSnapshot, type WorkbenchSnapshot } from '../lesson-farms/follower-maze/scenarios';

// The same file is mounted by TutorialKit, updated by the running app, and
// restored by Reset/Solve. Polling catches writes from outside this process.
function App() {
 const [seed, setSeed] = useState<{ text: string; revision: number }>();
 const [error, setError] = useState('');
 useEffect(() => {
  let stopped = false;
  let last = '';
  let pending = 0;
  let queue = Promise.resolve();
  let revision = 0;
  const poll = async () => {
   if (pending) return;
   try {
    const requestedAt = last;
    const response = await fetch('/state', { cache: 'no-store' });
    if (!response.ok) throw new Error(await response.text());
    const text = await response.text();
    if (stopped || pending || requestedAt !== last) return;
    if (text !== last) { JSON.parse(text); last = text; setSeed({ text, revision: ++revision }); }
   } catch (cause) { if (!stopped) setError(String(cause)); }
  };
  persist = (snapshot) => {
   const text = serializeSnapshot(snapshot);
   last = text;
   pending++;
   queue = queue.then(async () => {
    const response = await fetch('/state', { method: 'PUT', body: text, keepalive: true });
    if (!response.ok) throw new Error(await response.text());
   }).catch((cause) => setError(String(cause))).finally(() => { pending--; });
  };
  void poll();
  const timer = setInterval(poll, 250);
  return () => { stopped = true; clearInterval(timer); };
 }, []);
 return <>{error && <p role="alert">{error}</p>}{seed ? <Workbench key={seed.revision} initial={JSON.parse(seed.text)} onChange={(snapshot) => persist(snapshot)} /> : <p>Loading lesson…</p>}</>;
}
let persist: (snapshot: WorkbenchSnapshot) => void = () => {};
createRoot(document.getElementById('root')!).render(<App />);
