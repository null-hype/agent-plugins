import type { Meta, StoryObj } from '@storybook/react-vite';
import './prose-specimen.css';
import '../styles/prose.css';
import '../styles/ransom-plus.css';

// Ransom+ (design evolution, Stitch gen 2): the landing lesson with the blocks
// picked from the gen-1 Blueprint and Telemetry prototypes, in Ransom Note ink.
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
      exception, and a new evaluation. The original failure stays visible. Every verdict names the rule it used.
    </p>
    <div className="rp-dump">
      <div className="rp-dump-head">
        <span>Pkl telemetry // evaluation dump</span>
        <span className="rp-dump-state">[fail_state]</span>
      </div>
      <div className="rp-dump-body">
        <span className="rp-dump-dim">// Evaluator check: rule.travel.lodging_allowance</span>
        {'\nbudget { limit = 1200; total = 1290 }'}
      </div>
      <div className="rp-dump-verdict">
        ✗ BUDGET_EXCEEDED total 1290 &gt; limit 1200<span className="rp-chip">RULE #892</span>
      </div>
    </div>
    <aside className="rp-note">
      <span className="rp-note-tag">Note 1 [ref: §4.2]</span>
      <p>
        Choose <kbd>Solve</kbd> to reveal the next reply, then the <kbd>→</kbd> arrow to continue. Each part is a
        thread; each lesson is a turn.
      </p>
    </aside>
    <table className="rp-grid">
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
        <tr>
          <td>How do claims, grants, and observations disagree?</td>
          <td>
            <a href="#">Hands-on reconciliation lab</a>
          </td>
        </tr>
      </tbody>
    </table>
    <h2>Next steps</h2>
    <ul>
      <li>
        <a href="#">Run the demo</a>
      </li>
      <li>
        <a href="#">Inspect the evidence</a>
      </li>
      <li>
        <a href="#">Discuss applying this to an agent system</a>
      </li>
    </ul>
    <div className="rp-title-block">
      <div className="rp-tb-head">
        Tidelands <span className="rp-stamp">Approved</span>
      </div>
      <div>
        <small>Sheet</small>0 · Start here
      </div>
      <div>
        <small>Rev</small>C
      </div>
      <div>
        <small>Turns</small>5
      </div>
      <div>
        <small>Status</small>Checked
      </div>
    </div>
  </div>
);

const meta: Meta = {
  title: 'Brand/Variations/Ransom+ (gen 2)',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="prose-specimen" data-theme="light">
      <Specimen />
    </div>
  ),
};
export default meta;

export const Default: StoryObj = {};
