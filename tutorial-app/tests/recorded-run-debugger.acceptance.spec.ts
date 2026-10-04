import { expect, test } from '@playwright/test';

// CIT-299 names the complete observable acceptance sequence before CIT-300/253
// implement it. The opt-in gate is the explicit development harness: normal CI
// does not pretend these targets pass, while DEBUGGER_ACCEPTANCE=1 executes the
// required suite unchanged against the Storybook surface.
test.skip(!process.env.DEBUGGER_ACCEPTANCE, 'CIT-300 and CIT-253 implementation target; set DEBUGGER_ACCEPTANCE=1 to execute');

const STORY = '/iframe.html?id=lessons-acp-trace-ghost-trace-machine--recorded-run-debugger&viewMode=story';
const request = 'Why didn\'t user 10 get the status update from arrival order 4,2,3,1?';

test('recorded Follower Maze run can be inspected, rewound, replayed, and reloaded', async ({ page }) => {
  await page.goto(`${STORY}&recording=ghost-trace-v1&run=arrival-4231&frame=request`);

  await test.step('open the request before its diagnostic', async () => {
    await expect(page.getByRole('region', { name: 'Recorded run' })).toContainText(request);
    await expect(page.getByText('Frame request of 4')).toBeVisible();
    await expect(page.getByText('fm-missing-delivery')).toHaveCount(0);
    await expect(page.getByText('PASS', { exact: true })).toHaveCount(0);
  });

  await test.step('continue to disagreement while retaining the request', async () => {
    await page.getByRole('button', { name: 'Continue to diagnostic' }).click();
    await expect(page.getByText('Frame failure of 4')).toBeVisible();
    await expect(page.getByText(request)).toBeVisible();
    await expect(page.getByText('fm-missing-delivery')).toBeVisible();
    await expect(page.getByText('Would the reorder-buffer model have delivered it?')).toHaveCount(0);
  });

  await test.step('selecting the diagnostic identifies evaluation and evidence without advancing', async () => {
    await page.getByRole('button', { name: /fm-missing-delivery/ }).click();
    await expect(page.getByText('followerMaze.orderedRouting:arrival-4231:arrival-order')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Related evidence' })).toContainText('witness/arrival-order');
    await expect(page.getByText('Frame failure of 4')).toBeVisible();
  });

  await test.step('open exact rule and captured observation identities', async () => {
    await page.getByRole('link', { name: 'Governing rule' }).click();
    await expect(page.getByRole('dialog', { name: 'Artifact' })).toContainText('followerMaze.ts');
    await expect(page.getByRole('dialog', { name: 'Artifact' })).toContainText('be95c86ea1fddd8913cab7577f2405c1a2e90205');
    await page.getByRole('button', { name: 'Close artifact' }).click();
    await page.getByRole('link', { name: 'Missing delivery observation' }).click();
    await expect(page.getByRole('dialog', { name: 'Artifact' })).toContainText('wire-transcript.jsonl · record 6');
  });

  await test.step('step back removes later state but preserves earlier state', async () => {
    await page.getByRole('button', { name: 'Step back' }).click();
    await expect(page.getByText(request)).toBeVisible();
    await expect(page.getByText('Frame request of 4')).toBeVisible();
    await expect(page.getByText('fm-missing-delivery')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Artifact' })).toHaveCount(0);
  });

  await test.step('step forward reproduces the identical failure', async () => {
    await page.getByRole('button', { name: 'Step forward' }).click();
    await expect(page.getByText('Frame failure of 4')).toBeVisible();
    await expect(page.getByText('followerMaze.orderedRouting:arrival-4231:arrival-order')).toBeVisible();
  });

  await test.step('advance to repair while keeping failure inspectable', async () => {
    await page.getByRole('button', { name: 'Continue to diagnostic' }).click();
    await expect(page.getByText('Frame repair-pass of 4')).toBeVisible();
    await expect(page.getByText('PASS', { exact: true })).toBeVisible();
    await expect(page.getByText('fm-missing-delivery')).toBeVisible();
    await page.getByRole('button', { name: /fm-missing-delivery/ }).click();
    await expect(page.getByText('witness/arrival-order')).toBeVisible();
  });

  await test.step('reset and reload reproduce the same sequence', async () => {
    await page.getByRole('button', { name: 'Reset replay' }).click();
    await expect(page.getByText('Frame request of 4')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Frame request of 4')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to diagnostic' }).click();
    await page.getByRole('button', { name: 'Continue to diagnostic' }).click();
    await expect(page.getByText('Frame repair-pass of 4')).toBeVisible();
    await expect(page.getByText('fm-missing-delivery')).toBeVisible();
    await expect(page.getByText('PASS', { exact: true })).toBeVisible();
  });
});
