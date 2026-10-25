import { test, expect } from './fixtures';

// The smallest step: one repoless Jules session, asked one question.
test('Is the moon made of cheese?', async ({ dispatch }, testInfo) => {
  const files = await dispatch({
    title: 'answer whether the moon is made of cheese',
    prompt: 'Is the moon made of cheese? Write your answer, in one sentence, to answer.md.',
  });
  const answer = files.find((f) => f.path.replace(/^\.?\//, '') === 'answer.md');
  expect(answer?.content.trim(), 'answer.md').toBeTruthy();
  await testInfo.attach('answer.md', { body: answer!.content, contentType: 'text/markdown' });
});
