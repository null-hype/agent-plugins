import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { buildAcpTraceState } from '../../src/lib/acpTraceProtocol';
import { solvedFixture } from './fixture';
import { REPRODUCTION_ID, REVISIONS, type RevisionKey } from './probes';

// CIT-307 x CIT-253: the review-1 editor flow, driven against the fixture the
// probes run just produced (the `probes` project is a dependency and fails if
// the committed fixture has drifted from what the checker did). What is checked
// is that the numbers the executed run produced are what the reviewer sees
// after accepting a probe, in the real Client and Agent pages (server.cjs).

const AGENT_URL = 'http://127.0.0.1:4384/';

let revision = 0;
async function show(pages: Page[], fixture: Parameters<typeof buildAcpTraceState>[0]["fixture"]) {
  revision += 1;
  const payload = buildAcpTraceState({ revision, fixture });
  // Agent panes learn about accepts from the host page; here the Client page
  // reports acceptance to window.parent, which is itself, so relay it.
  for (const page of pages) {
    await page.evaluate((payload) => window.postMessage({ type: 'lesson-state', source: 'tk-acp-trace-bridge', payload }, '*'), payload);
  }
}

// The typed text (not the grey suggestion, which Monaco also renders in the view).
const modelText = (page: Page) => page.evaluate(() => (window as any).monaco.editor.getModels()[0].getValue() as string);
const editorText = async (page: Page) => (await page.locator('.monaco-editor .view-lines').innerText()).replace(/ /g, ' ');

for (const key of ['S1', 'S2'] as RevisionKey[]) {
test(`accepting a probe shows the numbers the executed run produced (PR ${REVISIONS[key].pr})`, async ({ page, context }) => {
  const { finding, asserts } = { finding: REVISIONS[key].findingId, asserts: REVISIONS[key].baseline.asserts };
  const solved = JSON.parse(readFileSync(solvedFixture(key), 'utf8'));
  // The starter is the solved fixture before the reviewer answers: its prompt frame only.
  const starter = { ...solved, frames: solved.frames.slice(0, 1), nextTurn: { actor: 'agent', action: `review PR ${REVISIONS[key].pr}`, speaker: 'reviewer' } };
  const subject: string = solved.frames[0].envelope.params.prompt[0].text.split('\n')[0];

  const agent = await context.newPage();
  await page.goto('/');
  await agent.goto(AGENT_URL);
  await page.locator('.monaco-editor .view-lines').waitFor();
  await agent.locator('#chat-view').waitFor({ state: 'attached' });

  // Relay the Client's acceptance to the Agent as AcpTracePreview does.
  await page.exposeFunction('relayAccepted', async (accepted: boolean) => {
    await agent.evaluate(
      (state) => window.postMessage({ type: 'lesson-state', source: 'tk-acp-trace-bridge', payload: state }, '*'),
      { ...buildAcpTraceState({ revision: ++revision, fixture: solved }), accepted },
    );
  });
  await page.evaluate(() => {
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'acp-trace-suggestion-accepted') (window as any).relayAccepted(event.data.accepted);
    });
  });

  await show([page, agent], starter);
  await expect.poll(() => editorText(page)).toContain(subject);

  await test.step('solve offers the probes; nothing is accepted yet', async () => {
    await show([page], solved);
    await expect(page.locator('.ghost-text-decoration, .ghost-text').first()).toBeVisible();
    await expect.poll(() => editorText(page)).toContain('Does the check fail when the trace is deleted?'); // shown as grey text
    expect(await modelText(page)).not.toContain('Does the check fail when');
  });

  await test.step('Tab accepts each probe in turn', async () => {
    await page.keyboard.press('Tab');
    await expect.poll(() => modelText(page)).toContain('Does the check fail when the trace is deleted?');
    // Clicking a lens would take focus out of the editor and the next suggestion
    // would not be offered, so both are accepted before any evidence is opened.
    await expect.poll(() => editorText(page)).toContain('Does the check fail when a dummy-file read is forged?'); // shown as grey text
    expect(await modelText(page)).not.toContain('forged?');
    await page.keyboard.press('Tab');
    await expect.poll(() => modelText(page)).toContain('Does the check fail when a dummy-file read is forged?');
  });

  await test.step('the deleted-trace diagnostic names the executed run', async () => {
    await page.locator('.codelens-decoration a', { hasText: `${finding}.deleted-trace` }).click();
    const widget = page.getByRole('region', { name: 'Diagnostic evidence' });
    const markers = await page.evaluate(() => (window as any).monaco.editor.getModelMarkers({}).map((m: any) => m.message as string));
    expect(markers).toContain(`${finding}.deleted-trace: Deleting the trace still left all ${asserts} assertions passing.`);
    await expect(widget).toContainText(`REPRODUCTION ${REPRODUCTION_ID}`);
    await expect(widget).toContainText('canary-reads.txt removed');
    await expect(widget).toContainText(`${asserts} of ${asserts} assertions pass`);
    // The reviewers' own run output stays visibly missing next to the new one.
    await expect(widget).toContainText('not retained');
    if (process.env.STORYBOARD_SCREENSHOTS) await page.screenshot({ path: 'deleted-trace.png' });
  });

  await test.step('the forged-read diagnostic carries its own run', async () => {
    // The open widget covers the next line's lens: clicking the same lens again closes it.
    await page.locator('.codelens-decoration a', { hasText: `${finding}.deleted-trace` }).click();
    await expect(page.getByRole('region', { name: 'Diagnostic evidence' })).toHaveCount(0);
    await page.locator('.codelens-decoration a', { hasText: `${finding}.forged-read` }).click();
    const widget = page.getByRole('region', { name: 'Diagnostic evidence' });
    await expect(widget).toContainText('a dummy-file openat added to the mat-blocked arm');
    await expect(widget).toContainText(`${asserts} of ${asserts} assertions pass`);
  });

  await test.step('the Agent diagnoses only after an accept', async () => {
    await expect(agent.locator('#chat-view')).toContainText(`${finding}`);
  });
});
}
