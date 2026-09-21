import { expect, type Page, type FrameLocator } from '@playwright/test';
export const workbench = (page: Page) => page.getByTestId('follower-maze-workbench');
export async function snapshot(surface: Page | FrameLocator) {
 const text = await surface.getByTestId('follower-maze-workbench').getAttribute('data-snapshot');
 return JSON.stringify(JSON.parse(text!), null, 2) + '\n';
}
export async function openEvidence(surface: Page | FrameLocator) {
 const log = surface.frameLocator('iframe[title="otel-warm-log preview"]');
 await expect(log.locator('.codelens-decoration')).toHaveCount(20);
 const lenses = log.locator('.codelens-decoration');
 const index = await log.locator('body').evaluate((body) => {
  const line = Array.from(body.querySelectorAll('.view-line')).find((node) => node.textContent?.replace(/\u00a0/g, ' ').startsWith('[4,2,3,1]'));
  if (!line) throw new Error('4231 not rendered');
  const top = line.getBoundingClientRect().top;
  return Array.from(body.querySelectorAll('.codelens-decoration')).map((node, index) => ({ index, bottom: node.getBoundingClientRect().bottom })).filter(({ bottom }) => bottom <= top + 2).sort((a,b) => b.bottom-a.bottom)[0].index;
 });
 await lenses.nth(index).locator('a').click();
 await expect(log.locator('.evidence-widget')).toContainText('fm-missing-delivery(seq=2,user=10)');
 await expect(log.locator('.evidence-widget')).toContainText('-- missing --');
}
