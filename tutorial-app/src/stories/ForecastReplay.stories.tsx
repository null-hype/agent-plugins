import type { Meta, StoryObj } from '@storybook/react-vite';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, type Lesson } from './lessonFixtures';
// Rendered by ForecastReplay.pkl from the tree and the retained round
// (forecastReplay.spec.ts keeps it current). Nothing here restates a forecast.
import replay from './forecast-replay.json';
import treeText from '../../../src/cve-2026-66066/questions/WasIVulnerable.pkl?raw';
import registerText from '../../../src/cve-2026-66066/questions/rounds/20261006T065648Z-stub/register.json?raw';
import monitorText from '../../../src/cve-2026-66066/questions/rounds/20261006T065648Z-stub/monitor.json?raw';
import baseTree from './frozen/5282c7e/WasIVulnerable.pkl?raw';
import baseReading from './frozen/5282c7e/WasIVulnerable.test.pkl-expected.pcf?raw';
import headTree from './frozen/12f2351/WasIVulnerable.pkl?raw';
import headReading from './frozen/12f2351/WasIVulnerable.test.pkl-expected.pcf?raw';
import readingText from '../../../src/cve-2026-66066/questions/rounds/20261006T065648Z-stub/reading.txt?raw';

const meta = {
  title: 'Replay/Forecast registration',
  parameters: { layout: 'padded', controls: { include: ['solved'] } },
  argTypes: { solved: { control: 'boolean' } },
  args: { solved: false },
} satisfies Meta<{ solved: boolean }>;
export default meta;
type Story = StoryObj<typeof meta>;

// The files Peek opens, unaltered from PR 147 at c897e8d, under that source.
const source = 'https://github.com/null-hype/agent-plugins/blob/c897e8d41b633fc539b9bd558c7e7bd69f18d369/src/cve-2026-66066/questions/';
const round = 'rounds/20261006T065648Z-stub/';
const evidenceFiles = {
  [source + 'WasIVulnerable.pkl@']: treeText,
  [source + round + 'register.json@']: registerText,
  [source + round + 'monitor.json@']: monitorText,
  [source + round + 'reading.txt@']: readingText,
  // The split: the tree and its frozen reading at the base (5282c7e) and the head (12f2351).
  [source + 'WasIVulnerable.pkl@5282c7e']: baseTree,
  [source + 'WasIVulnerable.test.pkl-expected.pcf@5282c7e']: baseReading,
  [source + 'WasIVulnerable.pkl@12f2351']: headTree,
  [source + 'WasIVulnerable.test.pkl-expected.pcf@12f2351']: headReading,
};
const config = { traceFile: '/acp-trace.json', scenario: replay.starter.scenario };
const fixture = { data: {}, files: {}, solved: {}, focus: '' } satisfies Lesson;

export const RootQuestion: Story = {
  name: 'Root forecast and recorded registration',
  render: ({ solved }) => (
    <AcpTracePreview height={560} agent={false} payload={{ ...deriveAcpTraceState(fixture, {
      '/acp-trace.json': JSON.stringify(solved ? replay.solved : replay.starter),
    }, { config }), evidenceFiles }} />
  ),
};
