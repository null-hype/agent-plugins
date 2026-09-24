import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import AcpTracePreview from "./AcpTracePreview";
import { deriveAcpTraceState, loadLesson, type Lesson } from "./lessonFixtures";

// Part 3 (Budget Authority): one story per lesson, payload derived from the
// lesson's own files (Tier 1), play() reading the rendered panes. With
// `solved` off, play() checks the starter state (which is the previous
// lesson's solved state plus one incoming message); with it on, the recorded
// reply. Those are the pending/replied halves of
// tests/budget-authority.tutorial.spec.ts, turn by turn -- that
// storyboard compiles these lessons, so the stories check the compiled output
// shows what the storyboard asserted about its source.
//
// These lessons pass traceFile/scenario to AcpTraceBridge as props rather than
// frontmatter (see tests/budget-authority/prose.ts), so the same config goes
// to deriveAcpTraceState here.
const config = {
  traceFile: "/acp-trace.json",
  scenario: "budget-authority-v1",
};
const dir = "part-3/proposal-p-against-the-budget";
const lessons = [
  loadLesson(`${dir}/1-jev-types-the-answer`),
  loadLesson(`${dir}/2-git-merges-the-two-branches`),
  loadLesson(`${dir}/3-checks-evaluate-p-under-v1`),
  loadLesson(`${dir}/4-supervisor-grants-1200-1300`),
  loadLesson(`${dir}/5-checks-re-evaluate-p-under-v2`),
];

const QUESTION =
  "Does proposal P (airfare 890 + ground 400) fit within limit rule v1 (1200)?";
const TREE = "tree 3d27cfda3b9d";
const SUPERSEDED = "superseded for Proposal P by Limit rule v2 (supervisor)";

// Same shape as SmugglingSurvivesTheMerge.stories.tsx: one story per lesson,
// `solved` a Controls-panel toggle between the lesson's starter (`_files`) and
// solved (`_solution`) state. render() derives the payload from it each time,
// so meta is typed against these story args rather than AcpTracePreview's own
// props. Tier 1 only (no AcpTraceBridge/store): the docs page mounts all five
// lessons at once, which the bridge's broadcast-to-every-preview and the
// store singleton can't handle -- see that file's header.
type StoryArgs = { solved: boolean };

const meta: Meta<StoryArgs> = {
  title: "Lessons/Budget Authority",
  id: "lessons-budget-authority",
  // Canvas autoplays play(); the docs page doesn't, so scrolling past five
  // live pane pairs doesn't fire five waits at once.
  parameters: { layout: "padded", docs: { story: { autoplay: false } } },
  argTypes: { solved: { control: "boolean" } },
  args: { solved: false },
};

export default meta;

type Story = StoryObj<typeof meta>;

// By lesson 5 the Client log is ten frames; Monaco only lays out the visible
// lines, so a short pane silently hides early lines from any text read.
const render = (lesson: Lesson) => (args: StoryArgs) => (
  <div className="previews-container">
    <AcpTracePreview
      payload={deriveAcpTraceState(
        lesson,
        args.solved ? lesson.solved : lesson.files,
        { config },
      )}
      height={640}
    />
  </div>
);

const frames = (canvasElement: HTMLElement) =>
  Array.from(canvasElement.querySelectorAll("iframe"));

const editorsReady = (canvasElement: HTMLElement) =>
  waitFor(
    () => {
      const [client, agent] = frames(canvasElement);
      if (!client?.contentDocument?.querySelector(".monaco-editor .view-line"))
        throw new Error("client log not rendered");
      // The Agent pane hides Monaco behind its reasoning view once pins or
      // verdicts arrive -- every frame in this part carries them.
      const trace =
        agent?.contentDocument?.querySelector<HTMLElement>("#trace-view");
      if (!trace || trace.hidden)
        throw new Error("agent reasoning view not rendered");
    },
    { timeout: 15000 },
  );

const clientLog = (canvasElement: HTMLElement) =>
  (
    frames(canvasElement)[0]?.contentDocument?.querySelector(
      ".monaco-editor .view-lines",
    )?.textContent ?? ""
  ).replace(/ /g, " ");

const expectLogLine = (canvasElement: HTMLElement, needle: string) =>
  waitFor(() => {
    const text = clientLog(canvasElement);
    if (!text.includes(needle))
      throw new Error(
        `client log does not show "${needle}"; it shows: ${text.slice(-400)}`,
      );
  });

// The Agent pane's reasoning view, queried by role like the storyboard does.
const agent = (canvasElement: HTMLElement) => {
  const doc = frames(canvasElement)[1]?.contentDocument;
  if (!doc) throw new Error("agent pane has no document");
  const region = (name: string) =>
    within(doc.body).getByRole("region", { name });
  return {
    region,
    entries: (name: string) =>
      Array.from(region(name).querySelectorAll<HTMLElement>(".entry")),
    pin: (id: string) => doc.querySelector<HTMLElement>(`[data-pin="${id}"]`),
  };
};

const expectAgent = (
  canvasElement: HTMLElement,
  check: (view: ReturnType<typeof agent>) => void,
) => waitFor(() => check(agent(canvasElement)), { timeout: 5000 });

// Every lesson's Client pane says the replay is scripted, and the Agent pane
// shows no raw envelope while it has reasoning to show.
const expectPlacement = async (canvasElement: HTMLElement) => {
  const [client, agentFrame] = frames(canvasElement);
  await expect(
    client.contentDocument!.querySelector("#scripted"),
  ).toHaveTextContent(
    "Scripted replay (CIT-251 storyboard) · not a live capture",
  );
  await expect(
    client.contentDocument!.querySelectorAll("[data-pin], .entry"),
  ).toHaveLength(0);
  await expect(
    agentFrame.contentDocument!.querySelector("#monaco-root"),
  ).not.toBeVisible();
};

// Clicks the diagnostic's CodeLens in the Client log and returns the evidence
// widget's text -- the same interaction the Ghost Trace Machine's Solved story
// drives, here on a budget diagnostic.
const openEvidence = async (canvasElement: HTMLElement, code: string) => {
  const doc = frames(canvasElement)[0].contentDocument!;
  const lens = await waitFor(() => {
    const found = Array.from(
      doc.querySelectorAll<HTMLElement>(".codelens-decoration a"),
    ).find((a) => a.textContent?.includes(code));
    if (!found) throw new Error(`${code} CodeLens not rendered`);
    return found;
  });
  const win = doc.defaultView!;
  for (const type of ["mousedown", "mouseup", "click"]) {
    lens.dispatchEvent(
      new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win }),
    );
  }
  return waitFor(() => {
    const widget = doc.querySelector('[aria-label="Diagnostic evidence"]');
    if (!widget) throw new Error("evidence widget did not open");
    return widget.textContent ?? "";
  });
};

// Each story's play() asserts whichever state `solved` selects, so toggling
// the control and re-running interactions checks the other half.
// `name` stays a literal on each export: Storybook's indexer reads it
// statically and can't see through this factory.
const story = (
  lesson: Lesson,
  pending: (canvasElement: HTMLElement) => Promise<void>,
  replied: (canvasElement: HTMLElement) => Promise<void>,
): Story => ({
  render: render(lesson),
  play: async ({ canvasElement, args }) => {
    await editorsReady(canvasElement);
    await expectPlacement(canvasElement);
    await (args.solved ? replied : pending)(canvasElement);
  },
});

export const JevTypesTheAnswer: Story = {
  name: "1 · Jev types the answer",
  ...story(
    lessons[0],
    async (canvasElement) => {
      await expectLogLine(
        canvasElement,
        "jev (agent): type the answer  ->  awaiting recorded turn (Solve replays it)",
      );
      await expectAgent(canvasElement, ({ pin, entries, region }) => {
        expect(pin("question")).toHaveTextContent(QUESTION);
        expect(pin("limit-v1")).toHaveTextContent("budget ≤ 1200");
        expect(entries("Type").map((e) => e.textContent)).toEqual([
          expect.stringMatching(/^malformed · worker reason/),
        ]);
        for (const name of ["Merge", "Budget", "Authority"])
          expect(region(name)).toHaveTextContent("not evaluated");
      });
    },
    async (canvasElement) => {
      await expectAgent(canvasElement, ({ pin, entries, region }) => {
        expect(pin("jev-answer")).toHaveTextContent("YES · 0.94");
        expect(
          pin("jev-answer")?.querySelector(".tag.simulated"),
        ).toHaveTextContent("simulated · stub, not a recorded Jev answer");
        // Type shows its current state: malformed is replaced, not appended to.
        const type = entries("Type");
        expect(type).toHaveLength(1);
        expect(type[0]).toHaveAttribute("data-status", "well-formed");
        // Well-formed is not approval.
        expect(region("Budget")).toHaveTextContent("not evaluated");
      });
      await waitFor(() =>
        expect(clientLog(canvasElement)).not.toContain(
          "awaiting recorded turn",
        ),
      );
    },
  ),
};

export const GitMergesTheTwoBranches: Story = {
  name: "2 · Git merges the two branches",
  ...story(
    lessons[1],
    async (canvasElement) => {
      await expectLogLine(
        canvasElement,
        "git (agent): merge  ->  awaiting recorded turn (Solve replays it)",
      );
      await expectAgent(canvasElement, ({ pin }) => {
        // Continuity: lesson 1's solved answer is already on screen.
        expect(pin("jev-answer")).toHaveTextContent("YES · 0.94");
        expect(pin("branch-airfare")).toHaveTextContent("airfare 890");
        expect(pin("branch-ground")).toHaveTextContent("ground 400");
        expect(pin("proposal-P")).toBeNull();
      });
    },
    async (canvasElement) => {
      await expectAgent(canvasElement, ({ pin, entries, region }) => {
        expect(pin("proposal-P")).toHaveTextContent(
          `airfare 890 + ground 400 · ${TREE}`,
        );
        expect(entries("Merge").map((e) => e.textContent)).toEqual([
          "clean · 0 conflicts",
        ]);
        // A clean merge is not a budget pass.
        expect(region("Budget")).toHaveTextContent("not evaluated");
      });
    },
  ),
};

export const ChecksEvaluatePUnderV1: Story = {
  name: "3 · Checks evaluate P under v1",
  ...story(
    lessons[2],
    async (canvasElement) => {
      await expectLogLine(
        canvasElement,
        'client: send prompt  ->  sent  session/prompt "Run the budget check on proposal P."',
      );
      await expectLogLine(
        canvasElement,
        "checks (agent): evaluate  ->  awaiting recorded turn (Solve replays it)",
      );
      await expectAgent(canvasElement, ({ pin, entries }) => {
        expect(pin("proposal-P")).toHaveTextContent(TREE);
        expect(entries("Merge").map((e) => e.textContent)).toEqual([
          "clean · 0 conflicts",
        ]);
      });
    },
    async (canvasElement) => {
      await expectAgent(canvasElement, ({ pin, entries }) => {
        const [fail] = entries("Budget");
        expect(fail).toHaveAttribute("data-status", "fail");
        expect(fail).toHaveAttribute("data-rule", "limit-v1");
        expect(fail).toHaveTextContent("FAIL @ v1: 890 + 400 = 1290 > 1200");
        expect(fail.querySelector(".tag.rule")).toHaveTextContent(
          "evaluated against Limit rule v1",
        );
        // The confident answer and the clean merge stay beside the failure.
        expect(pin("jev-answer")).toHaveTextContent("YES · 0.94");
        expect(entries("Merge").map((e) => e.textContent)).toEqual([
          "clean · 0 conflicts",
        ]);
      });
      const evidence = await openEvidence(
        canvasElement,
        "budget-exceeds-limit",
      );
      for (const needle of [
        `proposal/P@${TREE}`,
        "rules/limit@v1",
        "budget ≤ 1200",
        "jev/answer",
        "contradicted: 1290 > 1200",
      ]) {
        await expect(evidence).toContain(needle);
      }
    },
  ),
};

export const SupervisorGrants1200To1300: Story = {
  name: "4 · Supervisor grants 1200 → 1300",
  ...story(
    lessons[3],
    async (canvasElement) => {
      await expectLogLine(
        canvasElement,
        'worker (agent): request permission  ->  sent  session/request_permission "Raise limit rule v1 1200 → 1300 for proposal P"',
      );
      await expectLogLine(
        canvasElement,
        "supervisor (client): grant 1200 → 1300  ->  awaiting recorded turn (Solve replays it)",
      );
      await expectAgent(canvasElement, ({ entries, region }) => {
        expect(entries("Budget")[0]).toHaveAttribute("data-status", "fail");
        expect(region("Authority")).toHaveTextContent("not evaluated");
      });
    },
    async (canvasElement) => {
      await expectAgent(canvasElement, ({ pin, entries }) => {
        const [record] = entries("Authority");
        expect(record).toHaveTextContent(
          `granted by supervisor: v1 1200 → v2 1300 · scope Proposal P (${TREE}, unchanged)`,
        );
        // The limitation sits beside the decision, not only in prose.
        expect(record.querySelector(".caption")).toHaveTextContent(
          "Recorded supervisor decision · enforcement simulated",
        );
        expect(pin("limit-v2")).toHaveTextContent(
          `budget ≤ 1300 · applies to Proposal P (${TREE}) only`,
        );
        expect(
          pin("limit-v1")?.querySelector(".tag.superseded"),
        ).toHaveTextContent(SUPERSEDED);
        // The earlier FAIL is not re-judged, only marked as having read v1.
        const budget = entries("Budget");
        expect(budget).toHaveLength(1);
        expect(budget[0]).toHaveTextContent("FAIL @ v1");
        expect(budget[0].querySelector(".tag.superseded")).toHaveTextContent(
          SUPERSEDED,
        );
      });
    },
  ),
};

export const ChecksReEvaluatePUnderV2: Story = {
  name: "5 · Checks re-evaluate P under v2",
  ...story(
    lessons[4],
    async (canvasElement) => {
      await expectLogLine(
        canvasElement,
        'checks (agent): queue re-evaluation  ->  sent  session/update "Re-run the budget check on P @ v2"',
      );
      await expectLogLine(
        canvasElement,
        "checks (agent): re-evaluate  ->  awaiting recorded turn (Solve replays it)",
      );
      await expectAgent(canvasElement, ({ entries }) => {
        expect(
          entries("Authority")[0].querySelector(".caption"),
        ).toHaveTextContent(
          "Recorded supervisor decision · enforcement simulated",
        );
        expect(entries("Budget")).toHaveLength(1);
      });
    },
    async (canvasElement) => {
      await expectLogLine(
        canvasElement,
        "checks (agent): re-evaluate  ->  budget-within-limit",
      );
      await expectAgent(canvasElement, ({ pin, entries }) => {
        const [fail, pass] = entries("Budget");
        expect(pass).toHaveAttribute("data-status", "pass");
        expect(pass).toHaveAttribute("data-rule", "limit-v2");
        expect(pass).toHaveTextContent(
          "PASS @ v2: 890 + 400 = 1290 ≤ 1300 (granted by supervisor)",
        );
        // The earlier FAIL stays, still tied to v1, and v1 still reads as in turn 1.
        expect(fail).toHaveAttribute("data-status", "fail");
        expect(fail).toHaveAttribute("data-rule", "limit-v1");
        expect(pin("limit-v1")?.querySelector(".text")).toHaveTextContent(
          "budget ≤ 1200",
        );
        // Everything the argument rests on is still on screen.
        expect(pin("question")).toHaveTextContent(QUESTION);
        expect(pin("jev-answer")).toHaveTextContent("YES · 0.94");
        expect(pin("proposal-P")).toHaveTextContent(TREE);
      });
      const evidence = await openEvidence(canvasElement, "budget-within-limit");
      for (const needle of [
        "rules/limit@v2",
        "budget ≤ 1300, Proposal P only",
        "authority/limit-change-1",
        "enforcement simulated",
      ]) {
        await expect(evidence).toContain(needle);
      }
    },
  ),
};
