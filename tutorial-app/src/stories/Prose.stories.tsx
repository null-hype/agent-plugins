import type { Meta, StoryObj } from '@storybook/react-vite';
import './prose-specimen.css';
import '../styles/prose.css';

// Every element the lesson prose styles (CIT-340), side by side in both themes.
const Specimen = () => (
  <div className="markdown-content">
    <h1>What does a passing check actually tell you?</h1>
    <p>
      An agent says a trip fits the budget. Its two changes merge cleanly. The total is{' '}
      <strong>1290 against a limit of 1200</strong>.
    </p>
    <p>Which signal should the person approving the trip trust?</p>
    <a className="cta" href="#">
      Start the budget walkthrough
    </a>
    <p>
      In five turns, follow one proposal through a confident answer, a clean merge, a failed check, a supervisor's
      exception, and a new evaluation. The verdict becomes <code>well-formed</code>; a{' '}
      <a href="#">recorded exchange</a> shows where it came from.
    </p>
    <aside className="callout callout-info">
      <div className="callout-title">How to follow the replay</div>
      <p>
        Choose <strong>Solve</strong> to reveal the next reply, then the <strong>→</strong> arrow to continue.
      </p>
    </aside>
    <h2>Next steps</h2>
    <table>
      <thead>
        <tr>
          <th>Your question</th>
          <th>Where to look</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Where did the diagnostic come from?</td>
          <td>
            <a href="#">A recorded exchange and its evidence</a>
          </td>
        </tr>
        <tr>
          <td>What can a green security check miss?</td>
          <td>
            <a href="#">The merge experiment</a>
          </td>
        </tr>
      </tbody>
    </table>
    <h3>A third-level heading</h3>
    <p>Body text under an h3, which TutorialKit used to set at 28px.</p>
    <h4>A fourth-level heading</h4>
    <p>And under an h4.</p>
  </div>
);

const meta: Meta = {
  title: 'Brand/Lesson prose',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      <div className="prose-specimen" data-theme="light">
        <Specimen />
      </div>
      <div className="prose-specimen" data-theme="dark">
        <Specimen />
      </div>
    </div>
  ),
};
export default meta;

export const Default: StoryObj = {};
