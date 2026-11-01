import type { Meta, StoryObj } from '@storybook/react-vite';
import CheckBadge from '../components/CheckBadge';
import EvidenceLines from '../components/EvidenceLines';
import { TidelandsFooter, TidelandsHeader } from '../components/TidelandsChrome';
import '../components/Tidelands.css';

const meta = { title: 'Tidelands/Shared evidence primitives', parameters: { layout: 'fullscreen' }, render: () => <div className="td-page"><TidelandsHeader /><main className="td-main td-section"><h1>Evidence stays readable.</h1><p><CheckBadge kind="passed">Passed</CheckBadge> <CheckBadge kind="failed">Failed</CheckBadge> <CheckBadge kind="pending">Not evaluated</CheckBadge></p><EvidenceLines text={'question: Was the private file read?\nprediction: No\nfinding: A captured read disagrees with the prediction.'} highlight={{ from: 3, to: 3 }} /></main><TidelandsFooter /></div> } satisfies Meta;
export default meta;
export const SourceAndStatuses: StoryObj<typeof meta> = {};
