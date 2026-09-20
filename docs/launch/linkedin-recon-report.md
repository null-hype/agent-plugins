# LinkedIn Recon Report: Playwright-MCP Reproducible Search & Candidate Set (CIT-184)

> **Status: RECON REPORT ONLY.**  
> Prepared for Linear issue **CIT-184** (child of parent **CIT-181**, related to **CIT-110**, **CIT-167**, and **CIT-179**).  
> **Strict Operational Guardrails Maintained:**  
> - **Recon Only**: No connection requests, messages, comments, applications, or outbound actions taken.  
> - **Session**: Executed against the user's existing authenticated LinkedIn session via Playwright-MCP.  
> - **Compliance**: No anti-automation, rate limit, or CAPTCHA triggers occurred. No fabricated familiarity or private information inferred.

---

## 1. Executive Summary

This reconnaissance run utilized **Playwright-MCP** to systematically evaluate starting search queries across LinkedIn's Content (Posts), People, and Company surfaces. The objective was to discover whether real-world practitioners, platform leaders, security architects, AI control researchers, and grantmakers recognize the problem solved by our governance primitive: **that individually approved agent capabilities can compose into unsafe states, and that probabilistic guardrails and ordinary green CI builds fail to govern them.**

The recon uncovered an extraordinary convergence in industry discourse:
1. **Practitioners are independently identifying the exact boundary we built:** Notable examples include ANZ's Tech Area Architect calling out the *"planner-authoriser collision"* (agents helping define their own authority), enterprise architects publishing on *"snapshot discipline"* and *"agent tool drift"*, and security leaders arguing that *"identity, not monitoring, is the real control plane for agents"*.
2. **Deterministic controls are actively displacing "alignment" in production conversations:** Multiple high-profile CISO and researcher posts argue that *"deterministic AI governance and controls, not alignment or prompt guardrails, must be prioritized."*
3. **Grantmakers and regrantors are actively staffing dedicated technical AI safety programs:** Program officers at **Coefficient Giving**, **BlueDot Impact**, **Manifund**, and the **Transformative AI Fund** were directly identified, establishing concrete targets for **CIT-179**.

A structured candidate set of **30 qualified, deduplicated, evidence-backed individuals** was generated across all six target segments, fully cataloged in both [linkedin-recon-candidates.csv](file:///Users/rant/Desktop/agent-plugins/docs/launch/linkedin-recon-candidates.csv) and this report.

---

## 2. Search Query Performance Evaluation

| Query Variant | Surface Tested | Signal Quality | Key Findings & Observations |
|---|---|---|---|
| `"agentic AI" AND (security OR governance OR control)` | Content / Posts, People | **High** | Produced high-conviction thought leadership posts from practitioners in regulated industries (banking, healthcare, loan origination). High density of discussion on "does the control stop the action by itself?" |
| `("AI agent" OR "AI agents") AND (credentials OR permissions OR secrets OR IAM)` | Content / Posts | **Very High** | Strongest conceptual alignment. Yielded the "planner-authoriser collision" post by ANZ's IAM architect and detailed discussions on non-human identity. |
| `("AI agent" OR agentic) AND ("least privilege" OR "capability security")` | People, Content | **High** | Surfaced hands-on engineers, SDETs, and platform product leaders actively building execution sandboxes, MCP test harnesses, and agent role isolation. |
| `("MCP security" OR "agent security") AND (permissions OR credentials OR tools)` | Content / Posts | **Very High** | Uncovered firsthand accounts of "agent tool drift" in enterprise ERPs (Dynamics 365, IBM Maximo) where agents trial-and-error tools outside assigned prompt instructions. |
| `("non-human identity" OR "machine identity") AND ("AI agent" OR agentic)` | Content / Posts, People | **Very High** | Highly active thread among enterprise CISOs (Elastic, Clutch Security, Arkava). Highlights the explosive growth of agent-held credentials (median of 15 NHIs per agent) and the failure of traditional PAM. |
| `("AI control" OR "AI evaluations" OR "AI evals") AND (agent OR agents)` | People | **Medium** | People search returned many generic ML/eval engineers; however, filtering for specific agent evals and MCP workflows surfaced valuable product and test leaders. |
| `("AI assurance" OR "AI auditing") AND (agent OR agentic)` | Content / Posts | **High** | Surfaced senior audit and governance advisors (ISACA Sydney President, former Big 4 audit leads) discussing the "assurance market failure" and the need for whole-environment verification. |
| `("AI control" OR "scalable oversight" OR "agent safety") AND (researcher OR engineer OR founder)` | People, Posts | **High** | Directly surfaced Redwood Research leadership (Scott Wofford, Buck Shlegeris) and prominent tech founders arguing for deterministic controls over soft guardrails. |
| `("AI safety" OR "technical AI governance") AND (grantmaker OR "program officer" OR regrantor)` | People | **Very High** | Directly identified the exact technical program officers at Coefficient Giving, CIFAR, and ByteDance evaluating technical safety grants. |
| Target Funder Queries (`"Coefficient Giving"`, `"BlueDot Impact"`, `"Manifund"`, `"Transformative AI Fund"`) | People | **Very High** | Rapidly pinpointed key decision-makers: Dewi Erwan (BlueDot CEO / Rapid Grants), Austin Chen (Manifund Founder), Lowe Lundin (Head of TAIF), and Max Nadeau / Jake Mendel (Coefficient). |

### Noisy or Unproductive Queries
- **Broad "AI agents" AND "governance" without boolean operators**: Returned generic corporate marketing announcements, vendor press releases, and high-level policy whitepapers with zero technical or credential depth.
- **"AI evals" without "agent" or "MCP" qualifiers**: Overwhelmed by prompt-engineering benchmarks, rag-triad evaluation posts, and generic LLM-as-a-judge leaderboards that do not address tool access or side-effects.

---

## 3. Recurring Terminology & Problem Framings

The recon surfaced distinct language used by real practitioners and researchers that should be integrated into our project vocabulary:

1. **"Planner-Authoriser Collision"** (coined by Anurag Roy Barman, ANZ): When an agent interprets the prompt, devises the multi-step plan, and requests its own tool permissions, it conflates planning with authorization. This is the exact justification for our **supervisor protocol** and **supervisor-owned grants**.
2. **"Does the control stop the action by itself?"** (Dr. Harish Kotadia): The test of whether an agent control is an executable gate or merely an advisory policy. Validates our stance that green tests without enforceable gates govern nothing.
3. **"Snapshot Discipline"** (Ishmael Chibvuri): The principle that before an agent executes consequential operations, an immutable system snapshot must be taken to guarantee reversibility and auditable rollback. Directly validates our `restic-backup` and TutorialKit evidence timelines.
4. **"Agent Tool Drift"** (Inna Carp): The observed phenomenon where prompts and skills instruct an agent to use Tool A, but upon hitting an edge case or error, the agent autonomously invokes unapproved Tool B through trial and error.
5. **"Credentials as Agency"** (Ofir Har-Chen, Clutch Security): Systems do not authenticate "agents"; they authenticate keys, tokens, and service accounts. Strip credentials away and an agent is an articulate process that cannot open a door.
6. **"Deterministic Controls vs. Alignment"** (Jason Keirstead): Moving away from hoping the model remains aligned via prompts or fine-tuning, toward deterministic, compile-time/pre-merge typed invariants.
7. **"Decision Governance vs. Decision Assurance"** (Paul Ntoumos): Moving from "may we use this model?" to "what was this agent authorized to decide, and can we prove actions remained within that authority throughout the execution chain?"

---

## 4. Master 30-Candidate Recon Set (Structured by Segment)

### Segment 1: Agent / Platform / Security Engineers (5)

#### 1. Utsav Maheswari
* **Current Role & Organisation**: Product Leader — AI Platforms & Agent Infrastructure, Application Security
* **LinkedIn URL**: [linkedin.com/in/utsavmaheswari/](https://www.linkedin.com/in/utsavmaheswari/)
* **Source Search Query**: `("AI agent" OR agentic) AND ("least privilege" OR "capability security")`
* **Relevant Public Signal**: Public leadership focusing on sandboxes, developer platforms, and execution boundaries for agent infrastructure.
* **Why Relevant**: Works directly on the platform layer that enforces sandbox boundaries and credential mediation for autonomous agents.
* **Problem Hypothesis**: Platform teams struggle to enforce least-privilege credential delivery dynamically as multi-step agents acquire capabilities.
* **Engagement Role**: Engineer / Platform Specialist
* **Confidence**: High | **Warm Route**: Cold via technical exchange on agent sandbox runtime boundaries.
* **Terminology**: *"Agent infrastructure", "sandboxes", "platform engineering", "execution boundaries"*.

#### 2. Luis Flores
* **Current Role & Organisation**: Senior Software Engineer in Test (SDET) / AI Quality Engineer
* **LinkedIn URL**: [linkedin.com/in/luis-flores-serna/](https://www.linkedin.com/in/luis-flores-serna/)
* **Source Search Query**: `("AI agent" OR agentic) AND ("least privilege" OR "capability security")`
* **Relevant Public Signal**: Specializes in Agentic & Multi-Agent Systems Testing, Quality Platforms, MCP, and AI Observability.
* **Why Relevant**: Validates the need for reproducible test fixtures, Dagger-based integration testing, and MCP test harnesses.
* **Problem Hypothesis**: Multi-agent systems pass unit tests on mock tools but fail or produce untracked side-effects when executing real MCP tools.
* **Engagement Role**: Engineer / Testing Specialist
* **Confidence**: Medium | **Warm Route**: Cold via technical testing exchange on MCP evaluation harnesses.
* **Terminology**: *"Quality platform", "MCP", "multi-agent systems testing", "guardrails", "AI observability"*.

#### 3. Eric Rooney
* **Current Role & Organisation**: AI-Native Engineering Leader (Head of AI / Director), Former CTO
* **LinkedIn URL**: [linkedin.com/in/eric-rooney-0b7b3b10/](https://www.linkedin.com/in/eric-rooney-0b7b3b10/)
* **Source Search Query**: `("AI agent" OR agentic) AND ("least privilege" OR "capability security")`
* **Relevant Public Signal**: Builds AI-first engineering organizations; focuses on multi-agent systems, agentic dev, LLM automation, MCP, and RAG architectures; hands-on player-coach.
* **Why Relevant**: Engineering leader navigating practical developer friction when deploying MCP-based agentic workflows.
* **Problem Hypothesis**: Development teams adopting autonomous agent coding tools lack pre-merge verification that agent tool use complies with enterprise policy.
* **Engagement Role**: Engineer / Engineering Leader
* **Confidence**: Medium | **Warm Route**: Cold via tech leadership network.
* **Terminology**: *"Agentic dev", "multi-agent systems", "MCP", "AI-first orgs", "player-coach"*.

#### 4. Konrad Brodecki
* **Current Role & Organisation**: Agentic AI Engineer & Senior Software Engineer
* **LinkedIn URL**: [linkedin.com/in/brodecki/](https://www.linkedin.com/in/brodecki/)
* **Source Search Query**: `("AI agent" OR agentic) AND ("least privilege" OR "capability security")`
* **Relevant Public Signal**: Hands-on implementer of GenAI, AI agents, MCP, RAG, Node.js/TypeScript, AWS Serverless; builds production agent systems with tool integrations.
* **Why Relevant**: Ground-level practitioner perspective on building and securing MCP client-server architectures in AWS serverless estates.
* **Problem Hypothesis**: Developers building MCP servers face undefined patterns for authenticating agent sessions and scoping credential lifespans.
* **Engagement Role**: Engineer / Practitioner
* **Confidence**: Medium | **Warm Route**: Cold via AWS serverless agent discussions.
* **Terminology**: *"AI agents", "MCP", "AWS Serverless", "tool execution", "agentic AI"*.

#### 5. Leila Shamsolebad
* **Current Role & Organisation**: Senior Backend & AI Engineer (NV1 Security Clearance)
* **LinkedIn URL**: [linkedin.com/in/leilashamsolebad/](https://www.linkedin.com/in/leilashamsolebad/)
* **Source Search Query**: `"agentic AI" AND (security OR governance OR control)`
* **Relevant Public Signal**: Public profile in Australia specializing in GenAI, Agentic AI, APIs, and defense/secure government environments (NV1 clearance).
* **Why Relevant**: Understands high-assurance government and enterprise security boundaries where agent access review friction is highest.
* **Problem Hypothesis**: High-assurance environments require verifiable, deterministic proof that agents cannot escalate privileges beyond authorized API boundaries.
* **Engagement Role**: Engineer / High-Assurance Specialist
* **Confidence**: Medium | **Warm Route**: Australian tech and secure cloud engineering channels.
* **Terminology**: *"Agentic AI", "APIs", "NV1 Security Clearance", "governance"*.

---

### Segment 2: MCP / Tool-Security / Non-Human-Identity Practitioners (5)

#### 6. Inna Carp
* **Current Role & Organisation**: AI ERP & Business Analysis Lead, Dynamics 365
* **LinkedIn URL**: [linkedin.com/in/innacarp/](https://www.linkedin.com/in/innacarp/)
* **Source Search Query**: `("MCP security" OR "agent security") AND (permissions OR credentials OR tools)`
* **Relevant Public Signal**: Detailed post on *agent tool drift*: *"Skills and prompts do not create security boundaries... Relying on prompts for security is like giving someone Sys Admin access and asking nicely."*
* **Why Relevant**: Concrete proof that prompt-only capability declarations fail in production; validates our typed declared-vs-observed inventory axiom.
* **Problem Hypothesis**: Agents given access to tool suites drift outside intended task boundaries and invoke unapproved tools through trial and error.
* **Engagement Role**: Practitioner / ERP Specialist
* **Confidence**: High | **Warm Route**: Cold via technical discussion on ERP MCP security boundaries.
* **Terminology**: *"Agent tool drift", "skills and prompts do not create security boundaries", "dedicated accounts"*.

#### 7. Maycon Belfort
* **Current Role & Organisation**: Senior Maximo Consultant & IBM Champion 2026
* **LinkedIn URL**: [linkedin.com/in/mayconbelfort/](https://www.linkedin.com/in/mayconbelfort/)
* **Source Search Query**: `("MCP security" OR "agent security") AND (permissions OR credentials OR tools)`
* **Relevant Public Signal**: Pulse article: *MAS 9.2 MCP tools: automation scripts offer a flexible way to build agent tools*; notes that script tools lack fine-grained access control, only offering read-only and destructive hints.
* **Why Relevant**: Enterprise MCP implementers struggling with coarse-grained tool security schemas in industrial assets.
* **Problem Hypothesis**: MCP server tool metadata lacks capability constraints, forcing teams to either give broad execution rights or delay deployments.
* **Engagement Role**: Practitioner / Industrial Solutions
* **Confidence**: Medium | **Warm Route**: Cold via critique of MAS 9.2 MCP access controls.
* **Terminology**: *"MCP server architecture", "destructive hints", "SigOption-style access control", "bounded query tool"*.

#### 8. Ofir Har-Chen
* **Current Role & Organisation**: Co-Founder & CEO at Clutch Security
* **LinkedIn URL**: [linkedin.com/in/ofirhc/](https://www.linkedin.com/in/ofirhc/)
* **Source Search Query**: `("non-human identity" OR "machine identity") AND ("AI agent" OR agentic)`
* **Relevant Public Signal**: Viral post on agent identities: *"You don’t have an agent problem. You have an identity problem... The median credential-touching agent holds 15 distinct non-human identities. One outlier held 67,000."*
* **Why Relevant**: Validates credential-centric governance: agents acquire agency exclusively through non-human tokens and roles.
* **Problem Hypothesis**: Agents accumulate uncontrolled non-human credentials across SaaS and cloud tools with no single audit ledger or revocation boundary.
* **Engagement Role**: Practitioner / Startup Founder
* **Confidence**: High | **Warm Route**: Cold via critique of NHI credential sprawl measurements.
* **Terminology**: *"Non-human identity", "credentials as agency", "service accounts", "identity problem vs agent problem"*.

#### 9. Anurag Roy Barman
* **Current Role & Organisation**: Tech Area Architect (Digital Identity & Access Management) at ANZ
* **LinkedIn URL**: [linkedin.com/in/anurag-roy-barman-96749519/](https://www.linkedin.com/in/anurag-roy-barman-96749519/)
* **Source Search Query**: `("AI agent" OR "AI agents") AND (credentials OR permissions OR secrets OR IAM)`
* **Relevant Public Signal**: Article & Post: *Why Your AI Agent Must Not Write Its Own Permissions*; articulates the **"planner-authoriser collision"** where an agent that designs the plan also requests its own permissions.
* **Why Relevant**: Directly formulates the core motivation for our **supervisor protocol** (separating worker-stated reasons from supervisor-owned grants).
* **Problem Hypothesis**: Agent platforms allow planning agents to influence or request their own IAM grants, destroying separation of duties in banking environments.
* **Engagement Role**: Practitioner / Enterprise Architect
* **Confidence**: High | **Warm Route**: Australian banking and enterprise identity channels.
* **Terminology**: *"Planner-authoriser collision", "delegated authority", "missing trust boundary", "enforceable constraints"*.

#### 10. Abhishek Sinha
* **Current Role & Organisation**: Identity & Access Management SME | CISSP
* **LinkedIn URL**: [linkedin.com/in/abhishekkumarsinha89/](https://www.linkedin.com/in/abhishekkumarsinha89/)
* **Source Search Query**: `("AI agent" OR agentic) AND ("least privilege" OR "capability security")`
* **Relevant Public Signal**: Public profile: *Building the governance layer for Human, Machine & AI Agent identities* (Melbourne, Australia).
* **Why Relevant**: Focuses specifically on expanding IAM governance to encompass autonomous AI agents alongside traditional machine identities.
* **Problem Hypothesis**: Existing IAM identity governance systems fail to track ephemeral agent lifetimes and dynamic multi-agent delegation.
* **Engagement Role**: Practitioner / IAM Specialist
* **Confidence**: High | **Warm Route**: Melbourne tech and identity security network.
* **Terminology**: *"Governance layer", "Human, Machine & AI Agent identities", "IAM SME"*.

---

### Segment 3: AI Control / Assurance / Evaluation Researchers (5)

#### 11. Scott Wofford
* **Current Role & Organisation**: AI Control Software Engineer at Redwood Research | ex-Amazon
* **LinkedIn URL**: [linkedin.com/in/scottwofford/](https://www.linkedin.com/in/scottwofford/)
* **Source Search Query**: `("AI control" OR "scalable oversight" OR "agent safety") AND (researcher OR engineer OR founder)`
* **Relevant Public Signal**: Public profile explicitly stating he builds open-source AI control software at Redwood Research.
* **Why Relevant**: Core engineer implementing the AI Control protocol (untrusted worker, trusted supervisor) that our project bridges into developer tooling.
* **Problem Hypothesis**: AI control protocols tested in academic/synthetic settings lack native integrations into standard software developer workflows and CI systems.
* **Engagement Role**: Researcher / Core Engineer
* **Confidence**: High | **Warm Route**: Open-source AI control tooling channels.
* **Terminology**: *"AI control software", "untrusted models", "scalable oversight", "open-source safety"*.

#### 12. Buck Shlegeris
* **Current Role & Organisation**: CEO at Redwood Research
* **LinkedIn URL**: [linkedin.com/in/buck-shlegeris-a2b89386/](https://www.linkedin.com/in/buck-shlegeris-a2b89386/)
* **Source Search Query**: `("AI control" OR "scalable oversight" OR "agent safety") AND (researcher OR engineer OR founder)`
* **Relevant Public Signal**: Co-author of the seminal *AI Control: Improving Safety Despite Intentional Subversion* and *Monitoring Untrusted Models* papers.
* **Why Relevant**: Leading intellectual author of the AI control framing; validation confirms whether our typed CodeLens diagnostic and supervisor protocol solve real protocol needs.
* **Problem Hypothesis**: Academic control protocols struggle to find enterprise adoption unless packaged as developer-friendly, executable CI/merge checks.
* **Engagement Role**: Researcher / Institute Director
* **Confidence**: High | **Warm Route**: Cold via technical critique of operationalizing AI Control in developer environments.
* **Terminology**: *"AI Control", "monitoring untrusted models", "subversion", "scalable oversight", "control evaluations"*.

#### 13. Jason Keirstead
* **Current Role & Organisation**: Founding CTO/CISO, Cybersecurity & AI Leader | Distinguished Engineer
* **LinkedIn URL**: [linkedin.com/in/jasonkeirstead/](https://www.linkedin.com/in/jasonkeirstead/)
* **Source Search Query**: `("AI control" OR "scalable oversight" OR "agent safety") AND (researcher OR engineer OR founder)`
* **Relevant Public Signal**: Viral post: *"Deterministic AI governance and controls, not 'alignment', are what need to be prioritized, both inside frontier labs as well as inside enterprises. Do not trust LLM 'guardrails', do not trust alignment. Trust deterministic controls."*
* **Why Relevant**: Completely mirrors our project thesis: probabilistic guardrails fail; only deterministic, typed, external verification gates provide safety.
* **Problem Hypothesis**: Enterprises rely on model prompts and soft guardrails for safety, leading to silent test bypasses and compliance exposure.
* **Engagement Role**: Researcher / Distinguished Practitioner
* **Confidence**: High | **Warm Route**: Cold via alignment with his deterministic controls thesis.
* **Terminology**: *"Deterministic controls", "not alignment", "trust deterministic controls", "guardrails fail"*.

#### 14. Paul Ntoumos
* **Current Role & Organisation**: Senior Business Analyst & Transformation Consultant | AI Governance & Decision Assurance
* **LinkedIn URL**: [linkedin.com/in/paul-ntoumos-2a24343/](https://www.linkedin.com/in/paul-ntoumos-2a24343/)
* **Source Search Query**: `("AI agent" OR "AI agents") AND (credentials OR permissions OR secrets OR IAM)`
* **Relevant Public Signal**: Article & Post: *Who Gave the AI Permission to Decide?*; introduces the **"Decision Assurance Traceability Chain"**: Intent → Owner → Delegated Authority → Policy → Agent → Decision → Action → Outcome.
* **Why Relevant**: Conceptual framework maps 1-to-1 onto our reconciliation axiom reconciling human grant, agent reason, and materialized action.
* **Problem Hypothesis**: Organisations lack end-to-end evidence chains proving that an agent's real-world API actions remained within delegated human authority.
* **Engagement Role**: Researcher / Governance Consultant
* **Confidence**: Medium | **Warm Route**: Cold via decision assurance discussion.
* **Terminology**: *"Decision Governance", "Decision Assurance", "traceability chain", "delegated authority", "permission to decide"*.

#### 15. Tom McLeod
* **Current Role & Organisation**: Global Advisor | Redesigning Internal Audit & Assurance for AI-Driven Organisations
* **LinkedIn URL**: [linkedin.com/in/tommcleod/](https://www.linkedin.com/in/tommcleod/)
* **Source Search Query**: `("AI assurance" OR "AI auditing") AND (agent OR agentic)`
* **Relevant Public Signal**: Post: *Internal Audit. Meet Market Failure*; highlights that organizations urgently need forms of AI assurance that have not yet been clearly defined, packaged, or priced.
* **Why Relevant**: Validates the commercial thesis of **CIT-104**: the market needs bounded, fixed-scope, evidence-backed AI assurance assessment products.
* **Problem Hypothesis**: Audit committees and boards demand AI assurance but cannot buy it because technical teams only offer abstract questionnaires rather than executable proof.
* **Engagement Role**: Researcher / Audit Advisor
* **Confidence**: High | **Warm Route**: Cold via audit market failure discussion.
* **Terminology**: *"AI assurance", "incomplete market definition", "market coordination failure", "internal audit", "independent judgement"*.

---

### Segment 4: Funders, Grantmakers, Program Officers, and Regrantors (5)

#### 16. Max Nadeau
* **Current Role & Organisation**: Program Officer (Technical AI Safety) at Coefficient
* **LinkedIn URL**: [linkedin.com/in/max-nadeau/](https://www.linkedin.com/in/max-nadeau/)
* **Source Search Query**: `("AI safety" OR "technical AI governance") AND (grantmaker OR "program officer" OR regrantor)`
* **Relevant Public Signal**: Public profile confirming his role as Program Officer for Technical AI Safety at Coefficient Giving (San Francisco Bay Area).
* **Why Relevant**: Direct evaluator and grantmaker for technical AI safety and governance proposals; primary contact for **CIT-179**.
* **Problem Hypothesis**: Funders receive abstract policy applications; they seek concrete, open-source, executable infrastructure tools with verified code repositories.
* **Engagement Role**: Funder / Program Officer
* **Confidence**: High | **Warm Route**: Grant application channel via Coefficient Giving portal.
* **Terminology**: *"Program Officer", "Technical AI Safety", "grantmaker", "research funding"*.

#### 17. Jake Mendel
* **Current Role & Organisation**: Program Officer, Technical AI Safety at Coefficient Giving
* **LinkedIn URL**: [linkedin.com/in/jake-mendel/](https://www.linkedin.com/in/jake-mendel/)
* **Source Search Query**: `("AI safety" OR "technical AI governance") AND (grantmaker OR "program officer" OR regrantor)`
* **Relevant Public Signal**: Public profile confirming his role evaluating Technical AI Safety grants at Coefficient Giving (London, UK).
* **Why Relevant**: Key evaluator alongside Max Nadeau for technical governance, scalable oversight, and agent safety infrastructure.
* **Problem Hypothesis**: Funders need evidence that early-stage safety primitives can bridge academic control theory into real developer environments.
* **Engagement Role**: Funder / Program Officer
* **Confidence**: High | **Warm Route**: Technical grant submission channel.
* **Terminology**: *"Technical AI Safety", "Program Officer", "Coefficient Giving", "grantmaking"*.

#### 18. Dewi Erwan
* **Current Role & Organisation**: Co-founder and CEO at BlueDot Impact
* **LinkedIn URL**: [linkedin.com/in/dewierwan/](https://www.linkedin.com/in/dewierwan/)
* **Source Search Query**: Target Funder search: `"BlueDot Impact"`
* **Relevant Public Signal**: Operates the **Rapid Grants** program providing small, fast funding (decisions in days) for concrete technical AI safety and transition projects.
* **Why Relevant**: Rapid Grants is the ideal fast-funding mechanism for initial compute, hosting, and practitioner validation expenses (**CIT-179**).
* **Problem Hypothesis**: Builders of early-stage open-source safety infrastructure face months-long grant cycles that stall prototyping.
* **Engagement Role**: Funder / Executive Director
* **Confidence**: High | **Warm Route**: Rapid Grants application pipeline.
* **Terminology**: *"Rapid Grants", "talent accelerator", "AI safety", "career transition"*.

#### 19. Austin Chen
* **Current Role & Organisation**: Founder of Manifund
* **LinkedIn URL**: [linkedin.com/in/austinch/](https://www.linkedin.com/in/austinch/)
* **Source Search Query**: Target Funder search: `"Manifund"`
* **Relevant Public Signal**: Founded and runs Manifund (*"Weird funding mechanisms"*), enabling decentralized regrantors to quickly fund AI safety and governance projects.
* **Why Relevant**: Manifund regrantors specifically look for open-source AI governance primitives and executable research prototypes.
* **Problem Hypothesis**: Traditional philanthropies require formal non-profit structures, whereas regrantors can fund targeted open-source developer tooling directly.
* **Engagement Role**: Funder / Regranting Platform Founder
* **Confidence**: High | **Warm Route**: Manifund public project submission.
* **Terminology**: *"Regranting", "regrantor", "fast grants", "mechanisms", "AI safety"*.

#### 20. Lowe Lundin
* **Current Role & Organisation**: Head of the Transformative AI Fund (TAIF)
* **LinkedIn URL**: [linkedin.com/in/lowe-lundin/](https://www.linkedin.com/in/lowe-lundin/)
* **Source Search Query**: Target Funder search: `"Transformative AI Fund"`
* **Relevant Public Signal**: Leads the Transformative AI Fund, focusing on mitigating catastrophic risks from advanced autonomous AI systems.
* **Why Relevant**: TAIF evaluates mid-size grants for projects that establish enforceable technical norms and developer guardrails before frontier capabilities deploy.
* **Problem Hypothesis**: Philanthropic funding needs high-leverage software interventions that prevent runaway capability composition in agent ecosystems.
* **Engagement Role**: Funder / Fund Head
* **Confidence**: High | **Warm Route**: TAIF grant application inquiry.
* **Terminology**: *"Transformative AI Fund", "TAIF", "AI governance", "risk mitigation"*.

---

### Segment 5: Sydney / AWS / Local Technical Contacts (5)

#### 21. Chirag D Joshi
* **Current Role & Organisation**: CISO | President - ISACA Sydney | Author
* **LinkedIn URL**: [linkedin.com/in/chiragdjoshi/](https://www.linkedin.com/in/chiragdjoshi/)
* **Source Search Query**: `("AI assurance" OR "AI auditing") AND (agent OR agentic)`
* **Relevant Public Signal**: Post discussing OpenAI/Anthropic model credential abuse; demands whole-environment assurance examining permissions, connections, and incentives before granting agents authority.
* **Why Relevant**: Prominent Sydney security executive; directly bridges ISACA audit standards with agent credential security.
* **Problem Hypothesis**: Sydney security executives are hesitant to permit autonomous agent integrations without independent verification of credential boundaries.
* **Engagement Role**: Local Leader / Buyer
* **Confidence**: High | **Warm Route**: Sydney security community / ISACA Sydney chapter.
* **Terminology**: *"Whole environment assurance", "credentials without authorisation", "broader authority", "independent verification"*.

#### 22. Daniel Phillips
* **Current Role & Organisation**: AI Safety Researcher (Sydney, Australia)
* **LinkedIn URL**: [linkedin.com/in/daniel-phillips-9b16191bb/](https://www.linkedin.com/in/daniel-phillips-9b16191bb/)
* **Source Search Query**: `("AI control" OR "scalable oversight" OR "agent safety") AND (researcher OR engineer OR founder)`
* **Relevant Public Signal**: Public profile as an AI Safety Researcher in Sydney, Australia; mutual connection Ben Sand.
* **Why Relevant**: Local technical researcher who can evaluate the epistemic model (CIT-150) and provide feedback on our Pkl axiom alignment invariant.
* **Problem Hypothesis**: Local Australian researchers lack concrete, executable software testbeds to demonstrate control failures to regional institutions.
* **Engagement Role**: Local Researcher / Connector
* **Confidence**: High | **Warm Route**: Mutual connection Ben Sand in Sydney.
* **Terminology**: *"AI safety researcher", "alignment", "evaluations", "technical AI governance"*.

#### 23. Mirco Bianchini
* **Current Role & Organisation**: Sr Technical Product Manager — Automation, APIs & MCP (Sydney)
* **LinkedIn URL**: [linkedin.com/in/mirco-bianchini/](https://www.linkedin.com/in/mirco-bianchini/)
* **Source Search Query**: `("AI evaluations" OR "AI evals") AND agent`
* **Relevant Public Signal**: Public profile in Sydney actively building and testing with MCP, LLMs, and computational workflows; mutual connection Nirlep Adhikari.
* **Why Relevant**: Hands-on Sydney product manager wrestling with the practical realities of MCP integration and tool execution.
* **Problem Hypothesis**: Product teams building MCP client tools lack verification tooling to ensure composed tools don't conflict or leak tokens.
* **Engagement Role**: Local Practitioner / Engineer
* **Confidence**: High | **Warm Route**: Mutual connection Nirlep Adhikari in Sydney.
* **Terminology**: *"MCP", "computational workflows", "APIs", "automation", "digital delivery"*.

#### 24. Saurabh Vashisht
* **Current Role & Organisation**: DevSecOps & Cloud Security Engineer (Longueville, NSW)
* **LinkedIn URL**: [linkedin.com/in/saurabh-vashisht-0a40b614b/](https://www.linkedin.com/in/saurabh-vashisht-0a40b614b/)
* **Source Search Query**: `"agentic AI" AND (security OR governance OR control)`
* **Relevant Public Signal**: Sydney-based cloud engineer specializing in AWS, DevSecOps, Kubernetes, Agentic AI, and LLM Security.
* **Why Relevant**: Direct representation of the Sydney AWS DevSecOps practitioner who must integrate agent checks into existing CI/CD pipelines.
* **Problem Hypothesis**: DevSecOps teams have automated scanners for infrastructure code but no checks for agent capability acquisitions.
* **Engagement Role**: Local Engineer / Practitioner
* **Confidence**: High | **Warm Route**: Sydney AWS User Group community.
* **Terminology**: *"Agentic AI", "LLM Security", "DevSecOps", "Cloud Security", "Kubernetes"*.

#### 25. Lixin Yang
* **Current Role & Organisation**: Senior Cloud Engineer & Enterprise Agent AI Specialist (Sydney)
* **LinkedIn URL**: [linkedin.com/in/lixin-yang-90891a38/](https://www.linkedin.com/in/lixin-yang-90891a38/)
* **Source Search Query**: `("AI agent" OR agentic) AND ("least privilege" OR "capability security")`
* **Relevant Public Signal**: Public profile as a Sydney-based Senior Cloud Engineer and Enterprise Agent AI Developer.
* **Why Relevant**: Enterprise cloud practitioner on the ground implementing AWS and Azure agent architectures for Sydney businesses.
* **Problem Hypothesis**: Enterprise platform engineers face immediate resistance from corporate risk teams when agents require write credentials to internal databases.
* **Engagement Role**: Local Engineer / Practitioner
* **Confidence**: Medium | **Warm Route**: Sydney cloud engineering network.
* **Terminology**: *"Enterprise Agent AI Specialist", "Agentic AI Developer", "Senior Cloud Engineer"*.

---

### Segment 6: Consulting Buyers and Partner Firms (5)

#### 26. Mandy Andress
* **Current Role & Organisation**: Chief Information Security Officer at Elastic
* **LinkedIn URL**: [linkedin.com/in/mandyandress/](https://www.linkedin.com/in/mandyandress/)
* **Source Search Query**: `("non-human identity" OR "machine identity") AND ("AI agent" OR agentic)`
* **Relevant Public Signal**: Published analysis on multi-agent triage: *"Lock down your AI agents and they'll just find a way to use a human account instead... We built multi-agent triage at Elastic and why the liability question isn't theoretical anymore."*
* **Why Relevant**: Exemplifies the target enterprise CISO wrestling with real production agent deployments and non-human identity risks.
* **Problem Hypothesis**: Restrictive static security policies force agent developers to bypass governance by utilizing borrowed human tokens.
* **Engagement Role**: Enterprise Buyer / Advisory Board
* **Confidence**: High | **Warm Route**: Cold via technical critique of Elastic multi-agent identity containment.
* **Terminology**: *"Non-human identity", "multi-agent triage", "liability", "borrowed human accounts"*.

#### 27. Amer Altaf
* **Current Role & Organisation**: Founder & CEO, Arkava | Managing Editor, *The Control Layer*
* **LinkedIn URL**: [linkedin.com/in/amer-altaf-98792b8/](https://www.linkedin.com/in/amer-altaf-98792b8/)
* **Source Search Query**: `("non-human identity" OR "machine identity") AND ("AI agent" OR agentic)`
* **Relevant Public Signal**: Operates *The Control Layer* publication and consults £1bn+ enterprises on secure AI transformation and multi-agent governance.
* **Why Relevant**: Direct consulting partner opportunity; his publication specifically covers the "Control Layer" for autonomous agents.
* **Problem Hypothesis**: Large enterprises require an independent verification and control layer between AI orchestration frameworks and business databases.
* **Engagement Role**: Consulting Partner / Distribution Channel
* **Confidence**: High | **Warm Route**: Editorial contribution to *The Control Layer*.
* **Terminology**: *"The Control Layer", "secure AI transformation", "multi-agent governance", "enterprise AI"*.

#### 28. Hasanul Chowdhury
* **Current Role & Organisation**: AI Controls Manager at JPMorganChase
* **LinkedIn URL**: [linkedin.com/in/hasanul-chowdhury/](https://www.linkedin.com/in/hasanul-chowdhury/)
* **Source Search Query**: Target Funder search / mutual network
* **Relevant Public Signal**: Holds the specific title *AI Controls Manager* at JPMorganChase; mutual connections Jen Seale and Aaron Cordova.
* **Why Relevant**: Direct enterprise buyer persona in global banking managing model risk and autonomous agent controls.
* **Problem Hypothesis**: Tier-1 banks cannot approve autonomous agent workflows without formal, auditable verification that actions strictly match supervisor approval.
* **Engagement Role**: Enterprise Buyer / Banking Controls
* **Confidence**: High | **Warm Route**: Warm via mutual connections in enterprise technology.
* **Terminology**: *"AI Controls Manager", "enterprise solutions", "technical enablement", "governance"*.

#### 29. Dr. Harish Kotadia Ph.D.
* **Current Role & Organisation**: Agentic AI Architect | Author, *Earned Autonomy*
* **LinkedIn URL**: [linkedin.com/in/hkotadia/](https://www.linkedin.com/in/hkotadia/)
* **Source Search Query**: `"agentic AI" AND (security OR governance OR control)`
* **Relevant Public Signal**: Published framework *Earned Autonomy* for regulated enterprises; insists on controls that *"stop the action by itself"*.
* **Why Relevant**: Highly influential advisor and consulting buyer in regulated loan origination and financial services.
* **Problem Hypothesis**: Regulated firms deploying agents suffer audit failures because policies are stated in documentation rather than enforced by mechanical gates.
* **Engagement Role**: Consulting Buyer / Practice Leader
* **Confidence**: High | **Warm Route**: Cold via critique of his 10 Agentic Governance Controls.
* **Terminology**: *"Earned Autonomy", "Intent In Outcomes Out", "deterministic controls", "stop the action by itself"*.

#### 30. Brian Peretti
* **Current Role & Organisation**: Former CTO & Deputy Chief AI Officer
* **LinkedIn URL**: [linkedin.com/in/brianperetti/](https://www.linkedin.com/in/brianperetti/)
* **Source Search Query**: `("AI control" OR "scalable oversight" OR "agent safety") AND (researcher OR engineer OR founder)`
* **Relevant Public Signal**: Published article: *AI Companies Must Control Themselves Before Claiming They Can Control AI*; argues that management and operational controls are the foundation of AI safety.
* **Why Relevant**: Influential executive voice connecting corporate governance, independent assurance, and operational AI controls.
* **Problem Hypothesis**: Executives treat AI safety as an abstract philosophical problem rather than a standard software engineering and change-management control issue.
* **Engagement Role**: Advisory Partner / Connector
* **Confidence**: Medium | **Warm Route**: Discussion on corporate AI management controls.
* **Terminology**: *"Management controls are AI safety controls", "local optimization", "independent assurance", "enterprise orchestration"*.

---

## 5. Synthesis: The 10 Highest-Signal Candidates for Human Review

These 10 candidates demonstrate the tightest alignment with our core technical claims, local event anchors, or grant opportunities. **No outbound action is authorized**; these are prioritized for subsequent review in **CIT-110**, **CIT-181**, and **CIT-179**:

| Priority | Name & Organisation | Segment | Why Selected for Immediate Review | Next Recommended Research Action |
|:---:|---|---|---|---|
| **1** | **Anurag Roy Barman**<br>Tech Area Architect (IAM), ANZ | Practitioner | Coined the **"planner-authoriser collision"**; directly solves the worker vs supervisor grant distinction in banking. Local in Australia. | Cross-reference his article against our supervisor protocol in `capability-spike/`. |
| **2** | **Dr. Harish Kotadia Ph.D.**<br>Agentic AI Architect | Practitioner / Buyer | Strongest conceptual match: *"Does the control stop the action by itself? I'd rather ship 3 real controls than 10 policies."* Regulated loan origination focus. | Map our `Reconcile.pkl` axiom against his 10 Agentic Governance Controls. |
| **3** | **Scott Wofford**<br>Redwood Research | Researcher | Direct engineer implementing open-source AI control software at Redwood Research. | Review Redwood's open-source control software repos for protocol integration points. |
| **4** | **Chirag D Joshi**<br>President, ISACA Sydney & CISO | Buyer / Local | Key local Sydney security leader; explicitly posted on models abusing credentials without authorization and demanded whole-environment assurance. | Prepare Sydney AWS Meetup talking points reflecting his whole-environment assurance criteria. |
| **5** | **Inna Carp**<br>AI ERP & Dynamics 365 Lead | Practitioner | Published firsthand evidence of **"agent tool drift"** where agents trial-and-error tools outside assigned prompt skills. | Prepare a walkthrough showing how Pkl declared-vs-observed axioms catch tool drift. |
| **6** | **Ofir Har-Chen**<br>CEO, Clutch Security | Practitioner | Demonstrated that the median agent holds 15 NHIs (with outliers holding 67,000); proves that credentials are the real control plane. | Compare Clutch's NHI measurement methodology with our Proton Pass CLI dual-ledger tracking. |
| **7** | **Max Nadeau & Jake Mendel**<br>Coefficient Giving | Funder | Technical Program Officers for Technical AI Safety grants at Coefficient Giving. | Prepare small-grant proposal brief for **CIT-179** focusing on open-source capability governance tooling. |
| **8** | **Dewi Erwan**<br>CEO, BlueDot Impact | Funder | Operates Rapid Grants for quick-turnaround micro-funding of impactful AI safety tooling. | Draft Rapid Grants application to support demo hosting and tutorial kit distribution. |
| **9** | **Mandy Andress**<br>CISO, Elastic | Buyer | High-profile enterprise CISO actively deploying multi-agent triage and managing human vs non-human token escalation. | Analyze Elastic's multi-agent triage architecture for case study comparison. |
| **10** | **Austin Chen**<br>Founder, Manifund | Funder | Runs Manifund regranting mechanism where independent regrantors fund technical governance prototypes. | Prepare Manifund project submission draft under technical governance and scalable oversight categories. |

---

## 6. Downstream Workflow Integration

1. **Feeding into CIT-110 (Direct Connection CRM)**:
   - High-priority local candidates (**Anurag Roy Barman**, **Chirag D Joshi**, **Mirco Bianchini**, **Saurabh Vashisht**) provide high-conviction additions to the existing 20-contact CRM ahead of the 25 September 2026 Sydney AWS Meetup.
2. **Feeding into CIT-181 (Practitioner Validation)**:
   - Formulate specific interview questions for **Inna Carp**, **Maycon Belfort**, **Scott Wofford**, and **Ofir Har-Chen** around whether capability-composition failures occur in their systems and how they currently detect them.
3. **Feeding into CIT-179 (Grant Applications)**:
   - The identification of specific program officers (**Max Nadeau**, **Jake Mendel**) and fast-grant operators (**Dewi Erwan**, **Austin Chen**, **Lowe Lundin**) allows immediate packaging of tailored 2-page grant applications targeting verified funding priorities.
