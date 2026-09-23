import { QUESTION, SCENARIO, WORKER_REASON } from '../../src/lib/budgetAuthorityStoryboard';

// CIT-251: each lesson's markdown is the incoming turn in words. The
// argument itself has to read from the Client and Agent previews with this
// prose hidden (the storyboard asserts the preview, never this text); the prose
// adds only what the preview can't: why this beat matters, and the two
// honesty notes, stated where they apply.

const bridge = `import AcpTraceBridge from '../../../../../components/AcpTraceBridge';

<AcpTraceBridge client:load traceFile="/acp-trace.json" scenario="${SCENARIO}" />`;

const howToWatch = `**How to watch this part.** It is one ACP session, replayed. Each lesson is one
turn: the incoming message is already on screen in the **Client** preview, the
session log, whose last line names who acts next. The **Agent** preview shows the
agent's reasoning: the objects it holds fixed, its verdicts, and the decisions
that changed them. **Solve** replays the recorded reply; **Next** brings in the
following incoming message. You observe: nothing in this replay is an action you
take. The raw ACP envelopes are the editor's \`acp-trace.json\`.`;

const scripted = `**Scripted, not captured.** Every frame in this part is authored by a Playwright
storyboard (\`tests/budget-authority.tutorial.spec.ts\`), and the Client preview
says so above the log. What that storyboard computes for real: the git merge in
turn 2 (a real \`git merge\` in a scratch repository; the tree id shown is its
output) and both budget evaluations (turns 3 and 5).`;

export const PROSE: string[] = [
  `${bridge}

# Jev types the answer

${howToWatch}

The question is fixed for the whole part, and every later check evaluates the
same objects it names:

> ${QUESTION}

The worker's reason, "${WORKER_REASON}", is free text, so the Agent's **Type**
verdict reads \`malformed\`. Solve replays Jev's typed answer: \`YES · 0.94\`, and
**Type** becomes \`well-formed\`. That verdict means the answer is well formed. It says
nothing about whether the answer is right.

**Simulated.** Jev's entire response, \`YES\` and \`0.94\` alike, is a labelled
stub, not a recorded Jev answer. It shows how the interface exposes a confident
answer; it doesn't claim a particular agent gave it.

${scripted}
`,
  `${bridge}

# Git merges the two branches

The worker's two changes arrive as branches: \`airfare 890\` and \`ground 400\`.
Solve replays the merge. **Proposal P** appears with both lines and its tree id,
and **Merge** reads \`clean · 0 conflicts\`.

**Budget** still reads \`not evaluated\`. A clean merge means the two changes
combine without conflict. It doesn't mean the combination fits the budget.
`,
  `${bridge}

# Checks evaluate P under v1

Solve replays the budget check on the merged proposal: \`FAIL @ v1\`,
890 + 400 = 1290 > 1200. The clean merge and Jev's \`YES · 0.94\` stay on screen
beside it: the failure concerns the same proposal and the same rule Jev was asked
about.

Click the CodeLens above the failing line in the Client log to open its
evidence: proposal P at its tree id, limit rule v1, and the answer it contradicts.
`,
  `${bridge}

# Supervisor grants 1200 → 1300

The worker asks for a decision through \`session/request_permission\`: raise the
limit from 1200 to 1300 for proposal P. Solve replays the supervisor's recorded
answer. It shows up in the Agent's reasoning, under **Authority**, not as a check
result:

- **who:** the supervisor
- **what:** limit rule v1 (1200) → limit rule v2 (1300)
- **scope:** proposal P only, at the same tree id; P itself is unchanged

Rule v1 is not edited. It stays pinned, now marked superseded for P, and the
earlier \`FAIL @ v1\` still points at it.

**Enforcement simulated.** This replay records the decision; nothing in it
prevents the worker from editing the rule. It shows the record a real gate would
check, which is why the Agent's Authority record carries that label beside the
decision itself.
`,
  `${bridge}

# Checks re-evaluate P under v2

Solve replays the re-run: \`PASS @ v2\`, 890 + 400 = 1290 ≤ 1300, granted by the
supervisor. \`FAIL @ v1\` stays in the Budget history, still evaluated against
v1.

The pass establishes the arithmetic under v2. It doesn't establish an enforced
authorization boundary: that part is still only the record from the previous turn.
`,
];

export const LESSON_META = {
  template: 'acp-trace',
  prepareCommands: ['npm install'],
  mainCommand: 'npm run dev',
  // Client: the session log. Agent: the agent's reasoning over it.
  previews: [
    [4173, 'Client'],
    [4174, 'Agent'],
  ],
  editor: true,
  terminal: false,
};
