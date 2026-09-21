import { test, expect } from '@playwright/test';

// CIT-235: this is the storyboard. Each test.step drives one starting
// state defined in Area51Booking.stories.tsx (via iframe.html?id=<story
// id>), makes exactly the change that step is named for, then hands the
// tutorial reporter (reporters/tutorial.ts) the resulting file/prose/frame
// attachments. Step titles become lesson titles and slugs -- keep them
// stable and human, per the tutorial:file/tutorial:prose contract.
//
// Attachment names are prefixed `tutorial:<step-index>:` (1-based). Playwright
// 1.59.1's TestStep.attachments is always empty at runtime even though the
// reporter API declares it -- testInfo.attach() calls all land flat on
// TestResult.attachments with no back-reference to their step, so the index
// is how reporters/tutorial.ts knows which lesson an attachment belongs to.
// See reporters/README.md.

const STORY = {
  step1: 'spikes-area51-booking--step-1-reason-does-not-compile',
  step2: 'spikes-area51-booking--step-2-decision-is-typed',
  step3: 'spikes-area51-booking--step-3-runnable-appears',
};

const VALID_REASON = 'Scheduled facility inspection, badge #A51-7';

// Blur focus and let one animation frame settle before every screenshot so
// a blinking caret or an in-flight style transition can't make two runs on
// the same machine diverge byte-for-byte.
async function stableScreenshot(page: import('@playwright/test').Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(50);
  return page.screenshot();
}

// The one place "what files does the UI show" is read. Called at the start
// of a step (after the story loads, so it reflects the story's args) and
// again at the end, so a lesson's `_files` and `_solution` come from the same
// scraper rather than from hand-written strings. Note these are DOM scrapes:
// nothing here parses or type-checks `decision.ts`, and "does not compile"
// is a length check in the component -- the lessons show what the page
// says, they don't prove anything about types.
async function readFiles(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const files: Record<string, string> = {
    'reason.txt': await page.getByTestId('reason-input').inputValue(),
    'decision.ts': (await page.getByTestId('decision-code').innerText()).trim(),
  };
  const confirmation = page.getByTestId('confirmation');
  if ((await confirmation.count()) > 0) files['booking-confirmation.txt'] = (await confirmation.innerText()).trim();
  return files;
}

type TestInfo = Parameters<Parameters<typeof test>[2]>[1];

// index is this step's 1-based position -- see the file-header comment on
// why it has to be baked into the attachment name itself.
//
// `before/file/<path>` is state at the START of the step (becomes the
// lesson's `_files`); `file/<path>` is state at the END (`_solution`). The
// reporter fails the compile unless every step's start equals the previous
// step's end -- see reporters/README.md.
function attachTutorial(
  testInfo: TestInfo,
  index: number,
  name: 'prose' | 'frame' | `file/${string}` | `before/file/${string}`,
  options: Parameters<TestInfo['attach']>[1],
) {
  return testInfo.attach(`tutorial:${index}:${name}`, options);
}

async function attachFiles(testInfo: TestInfo, index: number, phase: 'before' | 'after', page: import('@playwright/test').Page) {
  for (const [file, body] of Object.entries(await readFiles(page))) {
    await attachTutorial(testInfo, index, phase === 'before' ? `before/file/${file}` : `file/${file}`, {
      body,
      contentType: 'text/plain',
    });
  }
}

test('area51 booking', { tag: '@tutorial' }, async ({ page }, testInfo) => {
  await test.step('reason does not compile', async () => {
    await page.goto(`/iframe.html?id=${STORY.step1}&viewMode=story`);

    await expect(page.getByRole('alert')).toHaveText(/reason does not compile/);
    await attachFiles(testInfo, 1, 'before', page);

    await page.getByTestId('reason-input').fill(VALID_REASON);
    await expect(page.getByRole('alert')).toHaveCount(0);

    await attachFiles(testInfo, 1, 'after', page);
    await attachTutorial(testInfo, 1, 'prose', {
      body:
        "`reason.txt` starts empty, so the check under it reads it as not compiling -- the red squiggle is that check " +
        'failing, live. Type a real reason (ten characters or more) and the squiggle clears: the check re-runs on every ' +
        'keystroke, not just on submit.',
      contentType: 'text/markdown',
    });
    await attachTutorial(testInfo, 1, 'frame', { body: await stableScreenshot(page), contentType: 'image/png' });
  });

  await test.step('decision is typed', async () => {
    await page.goto(`/iframe.html?id=${STORY.step2}&viewMode=story`);

    await expect(page.getByTestId('decision-badge')).toHaveText('untyped');
    await attachFiles(testInfo, 2, 'before', page);

    await page.getByTestId('type-decision-button').click();
    await expect(page.getByTestId('decision-badge')).toHaveText('typed');

    await attachFiles(testInfo, 2, 'after', page);
    await attachTutorial(testInfo, 2, 'prose', {
      body:
        "`decision.ts` starts as `let decision: any;` -- untyped, so nothing here stops a bad value from reaching " +
        "`run booking` downstream. Add the type annotation and the badge flips: the line now reads `'approve' | " +
        "'deny'` instead of `any`. (This demo only displays the annotation; nothing here type-checks it.)",
      contentType: 'text/markdown',
    });
    await attachTutorial(testInfo, 2, 'frame', { body: await stableScreenshot(page), contentType: 'image/png' });
  });

  await test.step('runnable appears', async () => {
    await page.goto(`/iframe.html?id=${STORY.step3}&viewMode=story`);

    await expect(page.getByTestId('run-blocked')).toHaveCount(0);
    const runButton = page.getByTestId('run-button');
    await expect(runButton).toBeVisible();
    await attachFiles(testInfo, 3, 'before', page);

    await runButton.click();
    await expect(page.getByTestId('confirmation')).toBeVisible();

    await attachFiles(testInfo, 3, 'after', page);
    await attachTutorial(testInfo, 3, 'prose', {
      body:
        'With `reason.txt` compiling and `decision.ts` typed, the ▶ is no longer blocked -- both checks upstream of it ' +
        'are what unlock it, not a separate switch. Run it, and the booking confirms.',
      contentType: 'text/markdown',
    });
    await attachTutorial(testInfo, 3, 'frame', { body: await stableScreenshot(page), contentType: 'image/png' });
  });
});
