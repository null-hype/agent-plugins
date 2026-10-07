import type { Meta, StoryObj } from '@storybook/react-vite';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, type Lesson } from './lessonFixtures';
import registerText from '../../../src/cve-2026-66066/questions/rounds/20261006T065648Z-stub/register.json?raw';
import monitorText from '../../../src/cve-2026-66066/questions/rounds/20261006T065648Z-stub/monitor.json?raw';
import treeText from '../../../src/cve-2026-66066/questions/WasIVulnerable.pkl?raw';

const register = JSON.parse(registerText) as Record<string, { tree: number; held: number; moved: boolean }>;
const monitor = JSON.parse(monitorText) as { item: string; time: string; action: string; reason: string }[];

const meta = {
  title: 'Replay/Forecast registration',
  parameters: { layout: 'padded', controls: { include: ['solved'] } },
  argTypes: { solved: { control: 'boolean' } },
  args: { solved: false },
} satisfies Meta<{ solved: boolean }>;
export default meta;
type Story = StoryObj<typeof meta>;

// Raw records copied without alteration from PR 147 at c897e8d.
// This is authored replay framing, not a captured ACP conversation or a new run.
const source = 'https://github.com/null-hype/agent-plugins/blob/c897e8d41b633fc539b9bd558c7e7bd69f18d369/src/cve-2026-66066/questions/';
const round = 'rounds/20261006T065648Z-stub/';
const evidenceFiles = {
  [source + 'WasIVulnerable.pkl@']: treeText,
  [source + round + 'register.json@']: registerText,
  [source + round + 'monitor.json@']: monitorText,
};
const id = 'was-i-vulnerable';
const entry = register[id];
const events = monitor.filter((event) => event.item === id);
const config = { traceFile: '/acp-trace.json', scenario: 'cit294-review-v1' };
const fixture = { data: {}, files: {}, solved: {}, focus: '' } satisfies Lesson;
const question = `Was Meridian ever exposed to CVE-2026-66066? Forecast: ${entry.tree * 100}% yes.`;
const diagnostic = {
  code: 'forecast.registered',
  severity: 'info',
  message: `forecast.registered: Recorded stub registration: forecast ${entry.tree * 100}%; read back ${entry.held * 100}%; moved: ${entry.moved}. Exposure remains unresolved in this round.`,
  evaluationId: '20261006T065648Z-stub:was-i-vulnerable:registration',
  related: [
    { role: 'fact', uri: source + 'WasIVulnerable.pkl', line: treeText.split('\n').findIndex((line) => line.includes('["was-i-vulnerable"]')) + 1, detail: 'Root question: Was Meridian ever exposed to CVE-2026-66066? Forecast = 0.5. No resolution is recorded. The worked example conclusion was already available to the forecaster.' },
    { role: 'observation', uri: source + round + 'register.json', detail: JSON.stringify(entry, null, 2) },
    { role: 'observation', uri: source + round + 'monitor.json', detail: JSON.stringify(events, null, 2) },
  ],
};
const prompt = {
  actor: 'client', action: 'send prompt',
  envelope: { jsonrpc: '2.0', id: 1, method: 'session/prompt', params: {
    sessionId: 'forecast-registration-replay',
    prompt: [{ type: 'text', text: 'Was Meridian ever exposed?\n\nReplay the root question and its forecast from draft PR 147.\nThe retained round used a stub register. Exposure is unresolved in this round.' }],
  } },
  provenance: { recordingId: '20261006T065648Z-stub:root', capturedAt: events[0].time,
    scripted: 'Authored replay framing reconstructed from the tree and stub records; not a recorded proposal event.' },
};
const reply = {
  actor: 'agent', action: 'reveal recorded registration', speaker: 'stub register',
  envelope: { jsonrpc: '2.0', id: 1, result: { stopReason: 'end_turn', _meta: {
    diagnostic,
    probes: [{ question, action: 'inspect recorded registration and read-back', diagnostic }],
  } } },
  provenance: { recordingId: '20261006T065648Z-stub:root:read-back', capturedAt: events[events.length - 1].time,
    scripted: 'Authored ACP framing; values and log entries come from the retained stub round.' },
};

export const RootQuestion: Story = {
  name: 'Root forecast and recorded registration',
  render: ({ solved }) => (
      <AcpTracePreview height={560} payload={{ ...deriveAcpTraceState(fixture, {
        '/acp-trace.json': JSON.stringify({ scenario: config.scenario,
          frames: solved ? [prompt, reply] : [prompt],
          nextTurn: solved ? null : { actor: 'agent', speaker: 'replay', action: 'reveal the root forecast' },
        }),
      }, { config }), evidenceFiles }} />
  ),
};
