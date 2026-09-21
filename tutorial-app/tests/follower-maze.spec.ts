import { test, expect } from '@playwright/test';
import { snapshot, openEvidence } from './follower-maze-helpers';

test.use({ viewport: { width: 1200, height: 1500 } });
test('Follower Maze evidence', { tag: '@tutorial' }, async ({ page }, info) => {
 await test.step('Select a failing run and open its evidence', async () => {
  await page.goto('/iframe.html?id=lessons-follower-maze-ordered-routing--evidence-lesson&viewMode=story');
  await expect(page.getByTestId('counter-footer')).toContainText('4 pass · 12 missing · 4 forbidden · 4 both');
  await info.attach('tutorial:1:before/file/workbench.json', { body: await snapshot(page), contentType: 'application/json' });
  await page.getByTestId('chip-4231').click();
  await expect(page.getByTestId('chip-4231')).toHaveAttribute('aria-pressed', 'true');
  await openEvidence(page);
  await info.attach('tutorial:1:file/workbench.json', { body: await snapshot(page), contentType: 'application/json' });
  await info.attach('tutorial:1:meta', { body: JSON.stringify({ template: 'follower-maze', prepareCommands: ['npm install'], mainCommand: 'npm run dev', previews: [[4173, 'Follower Maze']], terminal: false, editor: false, focus: '/workbench.json', filesystem: { watch: ['/workbench.json'] } }), contentType: 'application/json' });
  await info.attach('tutorial:1:prose', { body: 'import FollowerMazeControls from "../../../../../components/FollowerMazeControls";\n\n<FollowerMazeControls client:load />\n\nThe family has already been evaluated: 4 runs pass, 20 fail. In the preview, click **4231** in the monitor. It emitted only `20 <- seq 1`. Then click the diagnostic CodeLens above `[4,2,3,1]` in the log. Compare the expected and actual deliveries: `10 <- seq 2` is missing. Inspect the fact, observation, axiom, and three repair choices. Reset restores the evaluated family with no counterexample selected and no evidence open.', contentType: 'text/plain' });
 });
});
