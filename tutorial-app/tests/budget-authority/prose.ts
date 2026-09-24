// Editorial source for the generated budget walkthrough. Keep lesson paths stable.

export const PROSE: string[] = [
  `import AcpTraceBridge from '../../../../../components/AcpTraceBridge';

<AcpTraceBridge client:load traceFile="/acp-trace.json" scenario="budget-authority-v1" />

# A confident answer

**The trip costs 1290. The limit is 1200.** Follow what happens when an agent
answers yes anyway, and keep that answer in view as the checks arrive.

> Does proposal P (airfare 890 + ground 400) fit within limit rule v1 (1200)?

Select **Solve**. Jev's free-text reason becomes a structured answer,
\`YES · 0.94\`. The **Type** verdict becomes \`well-formed\`: the answer fits the
required shape. Its confidence does not establish that the trip fits the budget.

In the **Client** preview, follow the session log. In **Agent**, follow the
proposal, rules, and verdicts. Use the **→** arrow for the next turn; the same
proposal stays in view throughout.

**Evidence scope:** this is a scripted replay. Jev's answer and confidence are
illustrative. The storyboard computes a real Git merge in a scratch repository
and both budget evaluations. The supervisor's authority is simulated.
`,
  `import AcpTraceBridge from '../../../../../components/AcpTraceBridge';

<AcpTraceBridge client:load traceFile="/acp-trace.json" scenario="budget-authority-v1" />

# A clean merge

Select **Solve** to reveal the combination of \`airfare 890\` and \`ground 400\`.
**Proposal P** now shows both costs and a tree ID identifying the merged content.
**Merge** reads \`clean · 0 conflicts\`.

Look at **Budget**: it still reads \`not evaluated\`.
The changes combine successfully; the budget question is still unanswered.

Continue to check the same proposal against the original 1200 limit.
`,
  `import AcpTraceBridge from '../../../../../components/AcpTraceBridge';

<AcpTraceBridge client:load traceFile="/acp-trace.json" scenario="budget-authority-v1" />

# The check contradicts the answer

Select **Solve**. The budget result is **\`FAIL @ v1\`: 890 + 400 = 1290 > 1200**.
Jev's \`YES · 0.94\` and the clean merge remain visible beside it.
All three refer to the same proposal.

Click the diagnostic link above the failing line in the **Client** log to open
its evidence: the proposal's tree ID, limit rule v1, and the answer it contradicts.

The diagnostic gives the reviewer something specific to decide. The next turn
asks for an exception for this proposal.
`,
  `import AcpTraceBridge from '../../../../../components/AcpTraceBridge';

<AcpTraceBridge client:load traceFile="/acp-trace.json" scenario="budget-authority-v1" />

# A scoped exception

The worker asks to raise the limit from 1200 to 1300 for proposal P.
Select **Solve** to reveal the supervisor's decision under **Authority**:

- **Who:** the supervisor.
- **Change:** limit rule v1 (1200) → limit rule v2 (1300).
- **Scope:** proposal P at the same tree ID. The costs stay unchanged.

The original rule and \`FAIL @ v1\` remain in the record. Granting an exception
does not rewrite what the earlier check found.

**Enforcement is simulated.** This replay represents the approval record a gate
would need to verify. It does not prevent the worker from editing the rule.
Continue to evaluate the unchanged proposal under the new limit.
`,
  `import AcpTraceBridge from '../../../../../components/AcpTraceBridge';

<AcpTraceBridge client:load traceFile="/acp-trace.json" scenario="budget-authority-v1" />

# A pass with its history intact

Select **Solve**. The result is **\`PASS @ v2\`: 1290 ≤ 1300**.
The earlier **\`FAIL @ v1\`** remains visible against the original 1200 limit.

The proposal did not become cheaper. The supervisor granted a scoped exception,
and the check evaluated that proposal against the revised rule.

A reviewer can now answer: what was proposed, what failed, which exception was
granted, and which rule supports the current pass. The arithmetic is computed;
this replay's authorization boundary remains simulated.

**Apply this to your workflow:** choose one decision an agent makes today.
Identify its rule, the evidence needed to check it, and who may grant an exception.
[Discuss a scoped assessment](https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml)
using a public, non-sensitive description.

Next, [inspect a diagnostic from a recorded exchange](/part-2/chapter-1/lesson-1).
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
