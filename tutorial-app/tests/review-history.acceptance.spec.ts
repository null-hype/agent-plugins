import { expect, test, type Page } from '@playwright/test';
import {
  FRAME_IDS,
  REVIEW_HISTORY_EVIDENCE_LABELS,
  REVIEW_HISTORY_QUESTIONS,
  REVIEW_HISTORY_RECORDING_ID,
  REVIEW_HISTORY_RUN_ID,
  REVISIONS,
  reviewHistoryRecording,
} from '../src/lib/reviewHistory';

// CIT-306 acceptance target: the 117 -> review -> 118 -> re-review -> 120 ->
// follow-up walkthrough, driven through real UI interactions.
//
// This is an UNIMPLEMENTED target, not a passing demonstration. It needs the
// shared recorded-run inspector (CIT-301), which needs the playback controller
// (CIT-300) and exact artifact resolution (CIT-253); none of the three exists
// yet. Until they do, the whole file is skipped and a skipped run proves only
// that the sequence is written down and discoverable.
//
// It deliberately reuses the control names CIT-299's own target uses
// ('Continue to diagnostic', 'Step back', 'Step forward', 'Reset replay', the
// 'Recorded run' and 'Related evidence' regions, the 'Artifact' dialog) so the
// same shared inspector can drive it. Every expected string comes from the
// recording module, so this file cannot drift from the data it is checking.
//
//   REVIEW_HISTORY_ACCEPTANCE=1 npx playwright test --config=playwright.review-history.config.ts
//
// The Storybook id below is the INTENDED one; CIT-301 assigns the real id. Set
// REVIEW_HISTORY_STORY_ID to run against whatever it publishes.
test.skip(!process.env.REVIEW_HISTORY_ACCEPTANCE, 'CIT-300, CIT-253 and CIT-301 implementation target; set REVIEW_HISTORY_ACCEPTANCE=1 to execute');

const STORY_ID = process.env.REVIEW_HISTORY_STORY_ID ?? 'lessons-rails-matlab-canary--review-history';
const STORY = `/iframe.html?id=${STORY_ID}&viewMode=story`;
const at = (frame: string) => `${STORY}&recording=${REVIEW_HISTORY_RECORDING_ID}&run=${REVIEW_HISTORY_RUN_ID}&frame=${frame}`;
const TOTAL = reviewHistoryRecording.frames.length;
const frameText = (key: keyof typeof FRAME_IDS) => `Frame ${FRAME_IDS[key]} of ${TOTAL}`;

const evaluation = (localId: string) => {
  const found = reviewHistoryRecording.evaluations.find((e) => e.evaluationId === `${REVIEW_HISTORY_RUN_ID}:${localId}`);
  if (!found) throw new Error(`no evaluation ${localId}`);
  return found;
};
const code = (localId: string) => evaluation(localId).diagnostic.code;
const message = (localId: string) => evaluation(localId).diagnostic.message;
const label = (localId: string, evidence: string) => REVIEW_HISTORY_EVIDENCE_LABELS[`${localId}/${evidence}`];
const labelPattern = (text: string) => new RegExp(text.split(' — ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const recordedRun = (page: Page) => page.getByRole('region', { name: 'Recorded run' });
const next = (page: Page) => page.getByRole('button', { name: 'Continue to diagnostic' }).click();

test('the CIT-294 review history can be selected, inspected, rewound, reopened and compared across Storybook', async ({ page }) => {
  await page.goto(at(FRAME_IDS.q0));

  await test.step('open the original question before any result, as historical issue text', async () => {
    await expect(page.getByText(frameText('q0'))).toBeVisible();
    await expect(recordedRun(page)).toContainText(REVIEW_HISTORY_QUESTIONS.Q0.recorded.split('\n')[0]);
    await expect(recordedRun(page)).toContainText('A generic crash alone is insufficient.');
    await expect(recordedRun(page)).toContainText('historical issue text');
    await expect(recordedRun(page)).toContainText('not a sealed declaration');
    await expect(page.getByRole('button', { name: /Register/i })).toHaveCount(0);
    await expect(page.getByText(code('s1.claim'))).toHaveCount(0);
    await expect(page.getByText(code('review-1.finding-1'))).toHaveCount(0);
  });

  await test.step('advance to the claimed result, keeping the question', async () => {
    await next(page);
    await expect(page.getByText(frameText('s1'))).toBeVisible();
    await expect(page.getByText(message('s1.claim'))).toBeVisible();
    await expect(recordedRun(page)).toContainText('historical issue text');
    await expect(page.getByText(code('review-1.finding-1'))).toHaveCount(0);
  });

  await test.step('reach the first review: four findings, in the reviewer’s words, and what was not captured', async () => {
    await next(page);
    await expect(page.getByText(frameText('r1'))).toBeVisible();
    for (const finding of ['review-1.finding-1', 'review-1.finding-2', 'review-1.finding-3', 'review-1.finding-4']) {
      await expect(page.getByRole('button', { name: new RegExp(code(finding).replace('.', '\\.')) })).toBeVisible();
    }
    await expect(page.getByText(message('s1.claim'))).toBeVisible();
    await expect(page.getByText(code('review-2.gap-1'))).toHaveCount(0);
  });

  await test.step('select a finding without moving playback and open its exact evidence', async () => {
    await page.getByRole('button', { name: new RegExp(code('review-1.finding-1').replace('.', '\\.')) }).click();
    await expect(page.getByText(frameText('r1'))).toBeVisible();
    await expect(page.getByText(evaluation('review-1.finding-1').evaluationId)).toBeVisible();
    const evidence = page.getByRole('region', { name: 'Related evidence' });
    await expect(evidence).toContainText(labelPattern(label('review-1.finding-1', 'review-text')).source.replace(/\\/g, ''));
    await expect(evidence).toContainText('not captured');
    await expect(evidence).not.toContainText('S2 change');

    await page.getByRole('link', { name: labelPattern(label('review-1.finding-1', 'review-text')) }).click();
    await expect(page.getByRole('dialog', { name: 'Artifact' })).toContainText('linear-CIT-294-comment-97e70a90.md');
    await expect(page.getByRole('dialog', { name: 'Artifact' })).toContainText(message('review-1.finding-1'));
    await page.getByRole('button', { name: 'Close artifact' }).click();

    await page.getByRole('link', { name: labelPattern(label('review-1.finding-1', 'cited-source')) }).click();
    await expect(page.getByRole('dialog', { name: 'Artifact' })).toContainText('run_arms.sh');
    await expect(page.getByRole('dialog', { name: 'Artifact' })).toContainText(REVISIONS.S1.pinned);
    await page.getByRole('button', { name: 'Close artifact' }).click();
    await expect(page.getByText(frameText('r1'))).toBeVisible();
  });

  await test.step('advance to the correction: the answer appears beside the finding, which stays', async () => {
    await next(page);
    await expect(page.getByText(frameText('s2'))).toBeVisible();
    await expect(page.getByText(message('s2.claim'))).toBeVisible();
    await expect(page.getByText(code('review-1.finding-1'))).toBeVisible();
    await page.getByRole('button', { name: new RegExp(code('review-1.finding-1').replace('.', '\\.')) }).click();
    await expect(page.getByRole('region', { name: 'Related evidence' })).toContainText('S2 change');
    await expect(page.getByText(frameText('s2'))).toBeVisible();
  });

  await test.step('advance to the re-review: the changed conclusion sits beside the earlier claim and findings', async () => {
    await next(page);
    await expect(page.getByText(frameText('r2'))).toBeVisible();
    await expect(page.getByText(REVIEW_HISTORY_QUESTIONS.Q2.recorded)).toBeVisible();
    await expect(page.getByText(message('review-2.reassessed.findings-2-3'))).toBeVisible();
    await expect(page.getByText(message('review-2.gap-1'))).toBeVisible();
    await expect(page.getByText(message('s2.claim'))).toBeVisible();
    await expect(page.getByText(code('review-1.finding-1'))).toBeVisible();
  });

  await test.step('reach the third review: second-hand, with the original text shown as not captured', async () => {
    await next(page);
    await next(page);
    await expect(page.getByText(frameText('r3'))).toBeVisible();
    await expect(recordedRun(page)).toContainText('second-hand');
    await expect(page.getByText(/Review 3, original text/)).toBeVisible();
    await expect(page.getByText('Second-hand account of review 3')).toHaveCount(0);
  });

  await test.step('reach the final follow-up, which has no recorded review, and the merge', async () => {
    await next(page);
    await expect(page.getByText(frameText('s4'))).toBeVisible();
    await expect(page.getByText('Second-hand account of review 3').first()).toBeVisible();
    await expect(recordedRun(page)).toContainText('No review of this revision is recorded.');
    await next(page);
    await expect(page.getByText(frameText('landed'))).toBeVisible();
    await expect(page.getByText(message('landed.history'))).toBeVisible();
  });

  await test.step('step back: later evidence and assessments disappear, earlier ones stay; stepping forward restores them', async () => {
    const atMerge = await recordedRun(page).innerText();
    await page.getByRole('button', { name: 'Step back' }).click();
    await page.getByRole('button', { name: 'Step back' }).click();
    await expect(page.getByText(frameText('r3'))).toBeVisible();
    await expect(page.getByText('Second-hand account of review 3')).toHaveCount(0);
    await expect(page.getByText(code('s4.claim'))).toHaveCount(0);
    await expect(page.getByText(code('review-1.finding-1'))).toBeVisible();
    await expect(page.getByText(message('s1.claim'))).toBeVisible();
    await page.getByRole('button', { name: 'Step forward' }).click();
    await page.getByRole('button', { name: 'Step forward' }).click();
    await expect(page.getByText(frameText('landed'))).toBeVisible();
    expect(await recordedRun(page).innerText()).toBe(atMerge);
  });

  await test.step('direct seek agrees with stepping', async () => {
    await page.getByRole('button', { name: 'Reset replay' }).click();
    await next(page);
    await next(page);
    await next(page);
    await next(page);
    await next(page);
    await expect(page.getByText(frameText('r2'))).toBeVisible();
    const stepped = await recordedRun(page).innerText();
    await page.goto(at(FRAME_IDS.r2));
    await expect(page.getByText(frameText('r2'))).toBeVisible();
    expect(await recordedRun(page).innerText()).toBe(stepped);
  });

  await test.step('reset and reload reopen the same pinned recording, with explicit outcomes for bad references', async () => {
    await page.getByRole('button', { name: 'Reset replay' }).click();
    await expect(page.getByText(frameText('q0'))).toBeVisible();
    await page.reload();
    await expect(page.getByText(frameText('q0'))).toBeVisible();
    await page.goto(at('no-such-frame'));
    await expect(page.getByText(/frame-not-found|frame not found/i)).toBeVisible();
    await expect(page.getByText(message('s1.claim'))).toHaveCount(0);
    await page.goto(`${STORY}&recording=ghost-trace-v1&run=${REVIEW_HISTORY_RUN_ID}&frame=${FRAME_IDS.q0}`);
    await expect(page.getByText(/recording-not-found|recording not found/i)).toBeVisible();
  });

  await test.step('input, monitor and diagnostic stay in separate regions', async () => {
    await page.goto(at(FRAME_IDS.s4));
    const monitor = page.getByRole('region', { name: /monitor/i });
    await expect(monitor).toContainText('Observation, mat-blocked');
    await expect(monitor).not.toContainText(code('review-1.finding-1'));
    const diagnostics = page.getByRole('region', { name: /diagnostic/i });
    await expect(diagnostics).toContainText(code('review-1.finding-1'));
    await expect(diagnostics).not.toContainText('Observation, mat-blocked');
  });
});

// The same sequence has to pass in TutorialKit on the same data. That route does
// not exist: CIT-301 owns carrying the inspector into TutorialKit lessons (the
// WebContainer/iframe packaging, native Solve/Reset over selected breakpoints).
// Declared here so the gap is a counted, skipped test and not a silent omission.
test.fixme('the same sequence passes in TutorialKit on the same recording, with the lesson prose hidden', async () => {
  // Blocked on CIT-301 (TutorialKit route and shared inspector). When it lands,
  // drive the steps above against that route with the left-hand lesson panel
  // collapsed, so the selected question, the sequence, the disagreement and the
  // changed conclusion are all read from the recording alone.
});
