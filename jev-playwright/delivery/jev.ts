// Jev, as much as the plan needs: one Noul question about a state, one
// probability back.
export async function noul(apiKey: string, state: unknown, instructions: string): Promise<number> {
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ state, model: 'jev-latest', questions: { q: { type: 'noul', instructions } } }),
  });
  if (!response.ok) throw new Error(`Jev answered ${response.status}: ${await response.text()}`);
  return (await response.json()).answers.q.noul;
}
