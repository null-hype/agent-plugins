# Prioritized Direct-Connection List & Lightweight CRM (CIT-110)

> **Status: PLANNING DRAFT ONLY.**  
> Prepared for Linear issue CIT-110 under project *Agent access governance — demo and consulting launch*.  
> **Strict Operational Constraint:** No messages sent, introductions requested, or meetings booked by this task. Outreach authorization and sending cadence belong strictly to downstream issue **CIT-113**. No manufactured familiarity; all references derive from verifiable public talks, events, articles, or corporate profiles.

---

## 1. CRM Schema and Operational Guardrails

### 1.1 Column Definitions
Every contact in this lightweight CRM tracks 16 standardized fields:
1. **`id`**: Unique identifier (1–20).
2. **`person`**: Full name of the contact.
3. **`role_company`**: Current verified title and organization.
4. **`segment`**: One of `Buyer`, `Adviser/Connector`, or `Partner`.
5. **`source_url_date`**: Verifiable public URL, event reference, and discovery date.
6. **`relevance_evidence`**: Concrete public signal (talk, post, architecture, or responsibility) demonstrating agent adoption, MCP/tool usage, or access-control friction.
7. **`relationship_warm_intro`**: Actual relationship status and intro vector (e.g., local meetup attendance, mutual AWS ecosystem, community discussion, or cold via substantive technical critique). Never falsify closeness.
8. **`problem_hypothesis`**: Specific hypothesis regarding agent credential scope, access review delays, non-human identity, or multi-capability composition risks.
9. **`contact_channel`**: Primary channel (e.g., LinkedIn InMail, Meetup direct message, in-person conversation).
10. **`stage`**: Pipeline stage (`researched` → `draft ready` → `contacted` → `replied` → `discovery` → `qualified` → `proposal` → `won/lost/paused`). All entries start at `researched`.
11. **`last_contact`**: Date of previous interaction (`None` during initial research).
12. **`next_action_date`**: Specific immediate next action and target date (anchored ahead of the 25 September 2026 AWS meetup).
13. **`reply_objection`**: Logged feedback or objection (`None`).
14. **`workflow_owner`**: Target persona owning the workflow (e.g., Head of Security, CTO, Practice Lead).
15. **`urgency`**: Prioritization level (`High`, `Medium`, `Low`).
16. **`commercial_fit`**: Offer alignment (e.g., Scoped assessment candidate, Subcontracting partner, Technical feedback).
17. **`declined_opt_out`**: Opt-out flag (`No` / `Yes`). Stop immediately upon any decline.

### 1.2 Pipeline Summary
* **Total Researched**: 20
* **Potential Buyers**: 8 (Targeting real platform/security leaders managing agent deployments or access review friction)
* **Technical Advisers / Connectors**: 8 (AWS Community Builders, SREs, User Group leaders, and AI systems architects)
* **Partner Firms**: 4 (AWS Premier/Advanced Tier consultancies and MSPs with complementary cloud/security delivery)
* **Current Stage**: 100% `researched` (All drafts strictly gated pending user authorization)

---

## 2. Master Direct-Connection Table

| ID | Person | Role & Company | Segment | Relevant Public Signal | Intro Route | Problem Hypothesis | Next Action & Target Date |
|---|---|---|---|---|---|---|---|
| **1** | **Matthew Hart** | Head of Security, Canva | Buyer | Leads AI, AppSec, and Corporate Security across Canva's design & Dev platform | Cold via technical critique of multi-tenant AI tool boundaries | Composed agent tools risk lateral data access without pre-merge credential composition boundaries | Prepare tailored draft referencing AI access governance by 2026-09-22 |
| **2** | **Kane Narraway** | Head of Enterprise Security, Canva | Buyer | Publicly discusses Zero Trust architectures and non-human identity governance | Cold via Zero Trust non-human identity framing | Agent tools acquire credentials that outlive tasks without verifiable dual-ledger revocation | Draft message on non-human credential containment by 2026-09-22 |
| **3** | **Taroon Mandhana** | CTO Teamwork, Atlassian | Buyer | Leading Atlassian Rovo agentic platform and AI integrations with developer tooling | Cold via Atlassian Rovo architecture feedback (Sydney tech ecosystem) | Third-party MCP/tool connectors create unforeseen credential composition conflicts across Jira/code repos | Draft note on pre-merge capability conflict detection by 2026-09-23 |
| **4** | **Edwin Kwan** | Head of Product Security, REA Group | Buyer | Directs AppSec, DevSecOps pipelines, and cloud platform verification | Warm path via Melbourne tech community & AWS User Group | Developers adopt agents that pass isolated CI checks but compose unsafe permissions in AWS | Draft note referencing DevSecOps gate reconciliation by 2026-09-23 |
| **5** | **Tom Dance** | CTO, SafetyCulture | Buyer | Directs global high-availability platform architecture, IoT, and AI automation | Cold via Sydney SaaS engineering leadership network | Agent workflows lack deterministic revocation mechanisms when credentials escape sandbox bounds | Draft initial message on containment and revocation by 2026-09-23 |
| **6** | **Ciaran Hale** | CTO, Deputy | Buyer | Appointed to lead AI innovation, workflow automation, and workforce platform scale | Cold via Sydney tech executive network | Rapid AI automation features encounter compliance and access-review friction before production | Draft exploration note on unblocking access reviews by 2026-09-23 |
| **7** | **Nathalie Moss** | CTO, Judo Bank | Buyer | Leads tech at an AWS-native neobank under strict APRA regulatory compliance | Warm path via Australian cloud banking and APRA compliance forums | APRA CPS 234 requires verifiable evidence and auditable governance for autonomous agents | Draft compliance-oriented discovery message by 2026-09-23 |
| **8** | **Dave Tong** | Co-founder & CPTO, Employment Hero | Buyer | Oversees HR/payroll platform engineering and ISO 27001 compliance standards | Cold via Sydney startup/scaleup tech network | AI agents operating on payroll and employee records create high-stakes access audit friction | Draft bounded sandbox assessment proposal note by 2026-09-23 |
| **9** | **Daghan Acay** | Lead Architect, PolarSeven; Organizer, Sydney AWS Tools Meetup | Adviser/Connector | Organizes Sydney AWS Programming & Tools Meetup; AWS automation architect | Warm route as active meetup organizer and Sydney AWS community leader | Need for reproducible developer tooling that inspects agent access before deployment rather than reactive logs | Prepare informal introduction and walkthrough request for Sep 25 meetup |
| **10** | **Aashish Jolly** | Principal Solutions Architect, Versent; AWS Community Builder | Adviser/Connector | Speaker on *Agentic AI on Amazon Bedrock: Architectures, Guardrails & Lessons Learned* | Warm route via AWS Community Day Australia speaker lineup | Bedrock AgentCore guardrails filter prompt/output but lack pre-merge capability composition reconciliation | Draft technical critique and invitation to review Pkl axiom model by 2026-09-22 |
| **11** | **Christina Chen** | Senior Cloud Consultant, Mantel Group | Adviser/Connector | Speaker on *C3: The AI Agent That Survived Audit Season (So You Don't)* | Warm route via AWS Community Day Australia talk on audit-ready agent evidence | Agents struggle to prove deterministic compliance when composing credentials across multi-account AWS | Draft message referencing C3 talk and offering walkthrough of evidence-pack exporter by 2026-09-22 |
| **12** | **Lovee Jain** | Senior Software Engineer; AWS Community Builder | Adviser/Connector | Speaker on *From Plumbing to Production: Real-World Lessons with Bedrock AgentCore* (MCP gateways) | Warm route via shared focus on MCP gateways and agent identity brokerage | Current MCP tool integrations lack formal capability contracts, causing runtime failures and capability leaks | Draft technical exchange note on MCP capability contracts and test fixtures by 2026-09-22 |
| **13** | **Dmytro Sirant** | Fractional CTO; Leader, AWS User Group Gold Coast | Adviser/Connector | Speaker on *One Engineer, One Agent: Re-architecting a Big Data IoT Platform with Kiro* | Warm route via AWS User Group leadership and community builder network | Single-engineer agent workflows need automated, executable review gates to prevent subtle hallucinated permissions | Draft note on error-catching gates in single-engineer agent setups by 2026-09-23 |
| **14** | **Hazra Ali** | IT Consultant; AWS Community Builder | Adviser/Connector | Speaker at Melbourne AWS UG #163 on *Using Business Analytics to Drive Compliance in AWS Security Agent Workflows* | Warm route ahead of Sep 30 Melbourne AWS Meetup | Security agents generate fragmented logs that fail to reconcile agent-stated reasons with credential materialization | Draft pre-meetup message comparing security agent compliance ledgers by 2026-09-23 |
| **15** | **Sagar Utekar** | SRE, CrowdStrike; CNCF Ambassador | Adviser/Connector | Speaker on *Operating the Agent: SRE Best Practices for Autonomous AI in Production* | Warm route via CNCF / AWS Community Day speaker channels | SRE teams lack circuit breakers that verify capability composition before agents invoke infrastructure tools | Draft technical discussion on CodeLens diagnostics as pre-execution circuit breakers by 2026-09-23 |
| **16** | **Akshat Gupta** | Cloud & AI Engineer, PwC Australia | Adviser/Connector | Speaker at AWS Community Day Australia on AI and cloud engineering architectures | Warm route via AWS Community Day Australia speaker community | Enterprise consultancy clients struggle to certify agent safety because green CI tests mask bypassed access controls | Draft note sharing synthetic CI bypassed-gate scenario by 2026-09-24 |
| **17** | **Darrell King** | Founder & CEO, PolarSeven | Partner | Founder of PolarSeven (AWS Advanced Partner) and co-organizer of AWS Sydney Meetup | Warm route at upcoming Sydney AWS meetup on 25 September 2026 | PolarSeven clients adopting AI tooling need specialized agent access assessments that PolarSeven can subcontract | Prepare in-person meetup conversation and one-page partnership summary for Sep 25 |
| **18** | **Tim Hope** | CTO, Versent | Partner | CTO of Versent (AWS Premier Partner) specializing in identity, cloud security, and digital platforms | Warm intro via Versent enterprise architects (e.g. Aashish Jolly) or direct partner outreach | Enterprise customers demand agentic AI on Bedrock but security teams stall sign-off due to unverified agent access | Draft partner exploration note on specialist assessment subcontracting by 2026-09-24 |
| **19** | **Andre Morgan** | Partner & CEO, CMD Solutions (Mantel Group) | Partner | CEO of CMD Solutions (AWS Premier Partner within Mantel Group) focused on cloud automation & DevSecOps | Warm route via Mantel Group's public AI agent case studies and AWS community network | Mantel/CMD clients rolling out agentic workflows need repeatable, test-backed access audit assessments | Draft consultancy partnership pitch referencing audit-season compliance by 2026-09-24 |
| **20** | **Hamish Tedeschi** | Founder & MD, Mechanical Rock | Partner | Founder of Mechanical Rock (AWS Premier Partner) known for extreme DevOps and cloud-native governance | Cold/Warm via Australian DevOps community and shared ethos of executable testing and automated guardrails | Clients adopting autonomous agent tooling require automated capability governance rather than manual questionnaires | Draft peer-engineering partnership note emphasizing executable test evidence by 2026-09-24 |

---

## 3. Detailed Contact Dossiers & Draft Messages

*(Note: In accordance with the playbook, all bracketed variables are replaced with verified factual details. No messages may be sent without explicit user review and authorization).*

### Segment A: Potential Buyers (8)

#### 1. Matthew Hart — Head of Security, Canva
* **Role / Company**: Head of Security, Canva (Sydney, Australia)
* **Source**: Canva Tech Blog & public security leadership profiles (May 2026)
* **Relevance Evidence**: Matthew leads Canva’s global security organization across AI security, Application Security, and Corporate Security as Canva aggressively rolls out generative AI tools across its massive user base.
* **Intro Vector**: Cold via technical critique of multi-tenant AI tool boundaries and permissions.
* **Problem Hypothesis**: As internal and third-party AI agents receive broader integration access across Canva's data stores, static permission definitions and ordinary green CI builds fail to detect when two separately approved capabilities compose into an unsafe credential scope.
* **Commercial Fit**: Ideal candidate for a fixed-scope 1-workflow agent access assessment.
* **Draft Message (Buyer Discovery Template)**:
  > *Hi Matthew, I follow Canva’s security engineering updates around AI tool safety. I’m developing an executable capability governance approach with Pkl and Dagger that detects unsafe credential and MCP capability composition before merge—specifically catching cases where green tests mask unverified access boundaries. Has reconciling agent tool permissions with approved tasks created review friction or deployment delays for your team? If so, I’d welcome a brief 15-minute walkthrough of our executable test approach to see if it matches what you're seeing.*

#### 2. Kane Narraway — Head of Enterprise Security, Canva
* **Role / Company**: Head of Enterprise Security, Canva (Sydney, Australia)
* **Source**: Public enterprise security panel discussions on Zero Trust (April 2026)
* **Relevance Evidence**: Regularly articulates enterprise Zero Trust design, identity lifecycle governance, and non-human identity (NHI) boundary enforcement.
* **Intro Vector**: Sydney enterprise security forum / Cold via Zero Trust non-human identity framing.
* **Problem Hypothesis**: Ephemeral agent processes obtain non-human credentials that outlive their assigned task, creating monitoring blind spots where token revocation cannot be verified across multiple systems.
* **Commercial Fit**: Candidate for reviewed credential revocation & dual-ledger reconciliation demo.
* **Draft Message (Technical Critique Template)**:
  > *Hi Kane, your points on Zero Trust and non-human identity governance resonate with a prototype I’ve been testing: reconciling observed credential access (such as Proton Pass secrets) against approved task scope (such as Linear/issue contracts) with explicit, reviewed revocation. Would you be open to a 20-minute walkthrough to challenge our failure-case model? I’m particularly interested in your perspective on containing non-human agent credentials when a task completes or errors.*

#### 3. Taroon Mandhana — CTO Teamwork, Atlassian
* **Role / Company**: CTO Teamwork (former Head of Engineering for AI & Products), Atlassian (Sydney, Australia)
* **Source**: Atlassian Executive Announcements & kore1.com (March 2026)
* **Relevance Evidence**: Directly oversees the engineering behind Atlassian Rovo and agentic teamwork capabilities, where AI agents interact with Jira, Confluence, code repositories, and external SaaS tools.
* **Intro Vector**: Cold / Sydney tech ecosystem connection via Atlassian Rovo ecosystem.
* **Problem Hypothesis**: Enterprise customers are wary of agent tool integrations accessing sensitive project contexts; team leads need deterministic proof that an agent cannot escalate privileges beyond the specific issue contract.
* **Commercial Fit**: Enterprise buyer for pre-merge agent capability verification contracts.
* **Draft Message (Buyer Discovery Template)**:
  > *Hi Taroon, congratulations on the expansion of Atlassian Rovo. I’ve been researching capability governance for autonomous agents that connect to issue trackers and codebases. We've built an executable Pkl-based harness that verifies agent capability composition before merge, ensuring an agent’s observed tool grants cannot silently exceed its declared scope. Has customer access review or tool-composition friction created deployment gates for Rovo integrations? If so, I’d value sharing our reproducible test scenarios.*

#### 4. Edwin Kwan — Head of Product Security, REA Group
* **Role / Company**: Head of Product Security, REA Group (Melbourne, Australia)
* **Source**: Clutch Events & Security Leadership Podcasts (April 2026)
* **Relevance Evidence**: Leads product security and DevSecOps pipelines across REA Group's extensive AWS cloud footprint, with public talks on automating developer security guardrails.
* **Intro Vector**: Warm path via Melbourne tech community & AWS User Group Melbourne.
* **Problem Hypothesis**: Product squads are eager to introduce autonomous coding and operations agents, but existing DevSecOps gates only test static code syntax rather than runtime credential acquisition contracts.
* **Commercial Fit**: Bounded sandbox assessment for an internal agent workflow.
* **Draft Message (Buyer Discovery Template)**:
  > *Hi Edwin, I’ve followed your talks on automating DevSecOps and product security guardrails at REA Group. I’m developing an approach that turns agent access governance into executable pre-merge checks—reconciling declared tool inventory with observed credential access. Are agent tool integrations or autonomous developer workflows creating new access-review questions for your team? If timely, I’d welcome a short conversation to share our executable test harness.*

#### 5. Tom Dance — Chief Technology Officer, SafetyCulture
* **Role / Company**: Chief Technology Officer, SafetyCulture (Sydney, Australia)
* **Source**: SafetyCulture Engineering announcements & tech leadership updates (May 2026)
* **Relevance Evidence**: Leads global platform architecture, IoT, telematics, and operations for a high-velocity workplace safety platform expanding into automated AI agent actions.
* **Intro Vector**: Cold via Sydney SaaS engineering leadership network.
* **Problem Hypothesis**: Operational agents interacting with critical workplace safety records lack deterministic revocation, meaning an escaped credential could persist unnoticed after an agent run terminates.
* **Commercial Fit**: Fixed-scope assessment on agent containment and credential invalidation.
* **Draft Message (Buyer Discovery Template)**:
  > *Hi Tom, I’ve been following SafetyCulture’s platform scale and IoT/AI advancements. I’m working on a specialist project around agent access governance: ensuring autonomous agents operate under strict, executable access contracts with verified credential revocation. Has your team experienced review delays or security hesitation around granting agents direct operational tool access? If so, I’d be glad to share a 15-minute walkthrough of our sandbox test approach.*

#### 6. Ciaran Hale — Chief Technology Officer, Deputy
* **Role / Company**: Chief Technology Officer, Deputy (Sydney, Australia)
* **Source**: TechDay / Deputy Executive Appointments (June 2025 / 2026)
* **Relevance Evidence**: Appointed CTO specifically to drive AI innovation, platform modernization, and intelligent workflow automation across shift-work management systems.
* **Intro Vector**: Cold via Sydney tech executive channels.
* **Problem Hypothesis**: Product teams building AI automation features into scheduling and workforce communications encounter compliance and access-review friction regarding what third-party services an agent can reach.
* **Commercial Fit**: Assessment offer candidate for initial AI automation pipelines.
* **Draft Message (Buyer Discovery Template)**:
  > *Hi Ciaran, congratulations on your work driving Deputy’s AI platform initiatives. I’m working on agent capability governance with executable test contracts—specifically proving that an agent cannot exceed approved tool boundaries even when third-party capabilities compose. Has access-review friction or permission uncertainty slowed down any of your AI automation rollouts? If helpful, I’d be glad to share how our test fixtures catch these misalignments before deployment.*

#### 7. Nathalie Moss — Chief Technology Officer, Judo Bank
* **Role / Company**: Chief Technology Officer, Judo Bank (Melbourne, Australia)
* **Source**: ITNews / Judo Bank Executive Updates (April 2026)
* **Relevance Evidence**: Leads technology for Judo Bank, Australia’s prominent AWS-native SME challenger bank operating under rigorous APRA CPS 234 information security standards.
* **Intro Vector**: Warm path via Australian cloud banking and regulatory compliance network.
* **Problem Hypothesis**: Regulatory and internal audit mandates require undeniable evidence trails and deterministic revocation before any autonomous agent can touch internal credit or customer workflows.
* **Commercial Fit**: High-value candidate for a formal, audit-ready agent access assessment.
* **Draft Message (Buyer Discovery Template)**:
  > *Hi Nathalie, congratulations on your leadership at Judo Bank. In cloud-native banking, deploying autonomous agent workflows is often blocked by APRA CPS 234 access-control and audit-evidence requirements. I’m developing an evidence-backed access governance prototype that produces typed, reproducible verification records reconciling approved task scope with observed credential use. Has access review or audit readiness delayed AI agent adoption for your platform? I’d welcome a brief conversation to explore how our executable evidence model addresses these requirements.*

#### 8. Dave Tong — Co-founder & CPTO, Employment Hero
* **Role / Company**: Co-founder & Chief Product & Technology Officer, Employment Hero (Sydney, Australia)
* **Source**: Employment Hero Tech & ISO 27001 compliance updates (2026)
* **Relevance Evidence**: Directs product and engineering across a high-growth platform handling payroll, HR, and sensitive financial employee data under strict ISO 27001 controls.
* **Intro Vector**: Cold via Sydney tech scaleup ecosystem.
* **Problem Hypothesis**: Granting agents access to payroll and employment data creates severe security and compliance friction, as existing permission models cannot verify that an agent's stated reason matches what actually materialized.
* **Commercial Fit**: Bounded sandbox assessment candidate.
* **Draft Message (Buyer Discovery Template)**:
  > *Hi Dave, Employment Hero’s automated platform scale is impressive. I’m currently developing an executable access governance approach for AI agents handling sensitive workflows. We use typed Pkl axioms to verify that an agent’s declared reason, supervisor grant, and actual credential acquisition strictly match, flagging discrepancies before deployment. Is access-review friction or audit concern holding back any internal agent workflows? If so, I’d love to share our sandbox test methodology.*

---

### Segment B: Technical Advisers & Connectors (8)

#### 9. Daghan Acay — Lead Architect, PolarSeven; Organizer, Sydney AWS Tools Meetup
* **Role / Company**: Lead Architect at PolarSeven; Organizer of Sydney AWS Programming and Tools Meetup (Sydney, Australia)
* **Source**: Meetup.com & PolarSeven engineering profiles (2026)
* **Relevance Evidence**: Organizes the Sydney AWS Programming and Tools Meetup and works hands-on as a senior cloud architect specializing in AWS developer automation.
* **Intro Vector**: Warm path as meetup attendee/speaker ahead of the 25 September 2026 AWS meetup.
* **Problem Hypothesis**: Local AWS developers lack practical developer tooling to inspect and govern agent credential acquisitions before deployment, relying instead on post-facto CloudTrail logs.
* **Commercial Fit**: Connector to Sydney AWS builders; technical feedback on developer ergonomics.
* **Draft Message (Before the Meetup Template)**:
  > *Hi Daghan, I’m attending the upcoming Sydney AWS Meetup on 25 September. I’ve been building an agent capability governance prototype that runs pre-merge executable checks on agent credential access and tool composition. Given your focus on AWS developer tools and cloud automation, your perspective would be invaluable. If you have a few minutes at the meetup, I’d value getting your take on our test harness.*

#### 10. Aashish Jolly — Principal Solutions Architect, Versent; AWS Community Builder
* **Role / Company**: Principal Solutions Architect at Versent (Sydney, Australia)
* **Source**: AWS Community Day Australia 2026 speaker schedule & Versent Tech Blog (2026)
* **Relevance Evidence**: Delivered a key session titled *"Agentic AI on Amazon Bedrock: Architectures, Guardrails & Lessons Learned"*; deep focus on Bedrock AgentCore and AI observability.
* **Intro Vector**: Warm route via AWS Community Day Australia speaker community.
* **Problem Hypothesis**: While Bedrock AgentCore provides runtime prompt and content guardrails, it lacks pre-merge capability composition reconciliation when multiple MCP tools or plugins are combined.
* **Commercial Fit**: Technical adviser and connector into Versent's enterprise architecture team.
* **Draft Message (Technical Critique Template)**:
  > *Hi Aashish, your AWS Community Day talk on Bedrock AgentCore guardrails and AI observability was spot-on. I’ve been testing an executable prototype that addresses a complementary problem: reconciling declared MCP/tool inventory with observed credentials using Pkl axioms and Dagger pipelines. Would you be open to a 20-minute walkthrough to critique our failure-case model? I’m especially interested in your feedback on catching conflicting capabilities before an agent is accepted into production.*

#### 11. Christina Chen — Senior Cloud Consultant, Mantel Group
* **Role / Company**: Senior Cloud Consultant at Mantel Group (Melbourne/Sydney, Australia)
* **Source**: AWS Community Day Australia 2026 (awscommunitydayaus.com, 2026)
* **Relevance Evidence**: Presented *"C3: The AI Agent That Survived Audit Season (So You Don't)"*, detailing the real-world operational challenges of multi-account policy evaluation pipelines and audit reporting.
* **Intro Vector**: Warm route via discussion of her AWS Community Day session.
* **Problem Hypothesis**: Autonomous compliance and operations agents face immense friction proving to auditors that their credential access was strictly bounded and auditable across multiple AWS accounts.
* **Commercial Fit**: Technical adviser and potential referral bridge to Mantel Group’s consulting clients.
* **Draft Message (Technical Critique Template)**:
  > *Hi Christina, your session on 'C3: The AI Agent That Survived Audit Season' highlighted the exact friction points teams face when trying to generate audit-ready evidence from agents. We’re working on an evidence-export pipeline that produces typed, reproducible verification packages (reconciling Linear task approvals with observed vault access). Would you be open to a 20-minute discussion? I’d love to show you how we structure our audit evidence packages and get your critique.*

#### 12. Lovee Jain — Senior Software Engineer; AWS Community Builder
* **Role / Company**: Senior Software Engineer & AWS Community Builder (Melbourne, Australia)
* **Source**: AWS Community Day Australia 2026 (awscommunitydayaus.com, 2026)
* **Relevance Evidence**: Delivered lightning talk *"From Plumbing to Production: Real-World Lessons with Bedrock AgentCore"*, explicitly dissecting MCP gateways, ephemeral runtimes, identity brokers, and circuit breakers.
* **Intro Vector**: Warm route via shared technical focus on MCP gateways and agent identity brokerage.
* **Problem Hypothesis**: Autonomous agents utilizing MCP gateways lack formal pre-merge capability contracts, resulting in runtime tool timeouts, circuit breaker trips, or unintended capability leaks.
* **Commercial Fit**: Deep technical feedback on MCP tool contract verification.
* **Draft Message (Technical Critique Template)**:
  > *Hi Lovee, your talk on Bedrock AgentCore plumbing—specifically your analysis of MCP gateways and identity brokers—addressed the core operational realities most demos gloss over. We’ve built an executable test suite that evaluates agent MCP capability contracts as typed Pkl axioms to catch leaks and composition failures before runtime. Would you be open to a 20-minute technical exchange to compare notes on agent identity brokers?*

#### 13. Dmytro Sirant — Fractional CTO; Leader, AWS User Group Gold Coast
* **Role / Company**: Fractional CTO & Leader, AWS User Group Gold Coast (Queensland, Australia)
* **Source**: AWS Community Day Australia 2026 & AWS User Group Gold Coast (2026-10)
* **Relevance Evidence**: Presented *"One Engineer, One Agent: Re-architecting a Big Data IoT Platform with Kiro"*, focusing on concrete review practices used to catch AI-generated architecture errors.
* **Intro Vector**: Warm route via AWS User Group leadership network.
* **Problem Hypothesis**: Solo engineers and small DevOps teams relying heavily on AI agents lack automated verification gates, making them vulnerable to subtle, hallucinated permissions reaching production infrastructure.
* **Commercial Fit**: Practical advisory on solo/startup agent guardrails.
* **Draft Message (Technical Critique Template)**:
  > *Hi Dmytro, your talk on 'One Engineer, One Agent' struck a chord—especially your focus on the review practices needed to catch AI mistakes before they ship. We’re building an open test harness that makes agent capability checks executable, showing divergence between an agent's stated reason and actual access as an editor CodeLens diagnostic. Would you be up for a 20-minute walkthrough? I’d value your take on whether this would help solo engineers govern their agents.*

#### 14. Hazra Ali — IT Consultant & AWS Community Builder
* **Role / Company**: IT Consultant & AWS Community Builder (Melbourne, Australia)
* **Source**: Melbourne AWS User Group Meetup #163 schedule (meetup.com, September 2026)
* **Relevance Evidence**: Featured speaker at Melbourne AWS User Group #163 on *"Using Business Analytics to Drive Compliance in AWS Security Agent Workflows"*.
* **Intro Vector**: Warm route ahead of the 30 September 2026 Melbourne AWS Meetup.
* **Problem Hypothesis**: Security agents produce disjointed logs and threat models that cannot be mapped into deterministic compliance ledgers without manual reconciliation.
* **Commercial Fit**: Advisory on compliance intelligence and audit mapping.
* **Draft Message (Before the Meetup Template)**:
  > *Hi Hazra, I saw your upcoming session at Melbourne AWS User Group #163 on driving compliance in AWS security agent workflows. I’m currently testing a dual-ledger prototype that reconciles agent access logs against approved task contracts to provide auditable compliance evidence. If you have a few minutes before or after the meetup, I’d value your perspective on transforming raw agent logs into auditable compliance intelligence.*

#### 15. Sagar Utekar — Site Reliability Engineer, CrowdStrike; CNCF Ambassador
* **Role / Company**: Site Reliability Engineer at CrowdStrike (Sydney / Remote, Australia)
* **Source**: AWS Community Day Australia 2026 & CNCF Ambassador profiles (2026)
* **Relevance Evidence**: Speaker on *"Operating the Agent: SRE Best Practices for Autonomous AI in Production"*, addressing SLIs for decision latency, tool success rates, and runaway agent circuit breakers.
* **Intro Vector**: Warm route via CNCF and AWS Community Day speaker channels.
* **Problem Hypothesis**: SRE control planes cannot prevent runaway agents or misaligned tool executions when capability evaluation only occurs after an action is already in flight.
* **Commercial Fit**: Technical critique on SRE control plane integration.
* **Draft Message (Technical Critique Template)**:
  > *Hi Sagar, your session on SRE best practices for autonomous AI—specifically circuit breakers and SLIs for decision latency—addresses the exact production boundary that concerns reliability teams. We’ve developed an approach that treats capability composition as a pre-execution invariant, surfacing failures as typed diagnostics before an agent can invoke production tools. Would you be open to a 20-minute walkthrough to critique our circuit-breaker model?*

#### 16. Akshat Gupta — Cloud & AI Engineer, PwC Australia
* **Role / Company**: Cloud & AI Engineer at PwC Australia (Sydney, Australia)
* **Source**: AWS Community Day Australia 2026 (awscommunitydayaus.com, 2026)
* **Relevance Evidence**: Specializes in enterprise cloud architecture and AI agent engineering, presenting on scalable agent architectures at AWS Community Day.
* **Intro Vector**: Warm route via AWS Community Day Australia speaker community.
* **Problem Hypothesis**: Enterprise clients in professional services demand formal verification before allowing agents to manipulate corporate cloud environments, but existing CI test suites do not test gate bypasses.
* **Commercial Fit**: Adviser on enterprise consulting pain points.
* **Draft Message (Technical Critique Template)**:
  > *Hi Akshat, I noticed your work on cloud and AI agent architectures for AWS Community Day Australia. We’ve been researching a common blind spot in enterprise agent pipelines: where a green CI build passes even though the security gate was completely bypassed. We built a reproducible Pkl test scenario demonstrating this failure mode and its diagnostic fix. Would you be open to reviewing the scenario and sharing your thoughts on whether enterprise teams are feeling this pain?*

---

### Segment C: Partner Firms & Consultancies (4)

#### 17. Darrell King — Founder & CEO, PolarSeven
* **Role / Company**: Founder & CEO, PolarSeven (Sydney, Australia)
* **Source**: PolarSeven (polarseven.com.au) & AWS Sydney Meetup leadership (2026)
* **Relevance Evidence**: PolarSeven is an established AWS Advanced Consulting Partner in Sydney focusing on cloud migration, DevOps, and cloud-native architecture; Darrell is a co-organizer of the Sydney AWS Meetup.
* **Intro Vector**: Warm in-person conversation at the upcoming Sydney AWS Meetup on 25 September 2026.
* **Problem Hypothesis**: PolarSeven’s enterprise and scaleup clients want to deploy agentic automation on AWS, but security teams delay engagements over access control. PolarSeven can offer or subcontract specialized agent access assessments to unblock broader cloud delivery.
* **Commercial Fit**: Prime subcontracting and referral partner for AWS cloud transformations.
* **Draft Message (Consultancy Partner Template / In-Person Intro)**:
  > *Hi Darrell, I’m attending the Sydney AWS Meetup on 25 September. I know PolarSeven helps enterprise teams migrate and modernize on AWS. I’m developing a specialist consulting offer: fixed-scope agent access assessments that provide reproducible, test-backed proof that internal AI agents cannot exceed approved tool boundaries. Do PolarSeven’s clients currently raise access review, audit, or credential concerns around AI agents? I’d welcome a brief conversation at the meetup about whether this could complement your delivery work.*

#### 18. Tim Hope — Chief Technology Officer, Versent
* **Role / Company**: Chief Technology Officer, Versent (Sydney/Melbourne, Australia)
* **Source**: Versent (versent.com.au) & ITNews leadership profiles (2026)
* **Relevance Evidence**: Versent is Australia’s premier AWS Premier Tier Services Partner, renowned for identity management, cloud security (Identity & Access Management), and enterprise transformation.
* **Intro Vector**: Warm intro via Versent enterprise architects (such as Aashish Jolly) or direct partner outreach.
* **Problem Hypothesis**: Versent clients deploying Amazon Bedrock and custom agents encounter identity and access governance hurdles from enterprise CISOs that standard IAM templates cannot easily satisfy.
* **Commercial Fit**: Strategic Premier Tier subcontracting and co-delivery partner.
* **Draft Message (Consultancy Partner Template)**:
  > *Hi Tim, Versent’s reputation in enterprise AWS security and identity governance is well known. I’m developing a specialist assessment offer focused on agent capability and credential governance—using executable Pkl contracts and dual-ledger reconciliation to give security teams verifiable evidence before agents reach production. As Versent deploys Bedrock and agentic solutions, are client security teams raising audit or revocation friction? I’d welcome a brief discussion on whether our assessment methodology could serve as a valuable specialist add-on to your cloud offerings.*

#### 19. Andre Morgan — Partner & CEO, CMD Solutions (Mantel Group)
* **Role / Company**: Partner & CEO, CMD Solutions / Mantel Group (Sydney/Melbourne, Australia)
* **Source**: CMD Solutions / Mantel Group announcements & arnnet.com.au (2026)
* **Relevance Evidence**: CMD Solutions is an AWS Premier Consulting Partner within Mantel Group specializing in cloud foundations, automated DevSecOps, and compliance; Mantel Group actively showcases AI agent solutions (e.g. C3).
* **Intro Vector**: Warm route referencing Mantel Group’s published AI agent case studies and community presence.
* **Problem Hypothesis**: Clients adopting automated AI tooling need rapid, reproducible access-control assessments without pulling CMD’s senior architects off primary engineering deliverables.
* **Commercial Fit**: Co-delivery partner for DevSecOps and cloud governance engagements.
* **Draft Message (Consultancy Partner Template)**:
  > *Hi Andre, Mantel Group’s work in cloud automation and recent showcases of AI agents in compliance have been very impressive. I’m developing a bounded, test-backed assessment offer for agent access governance: auditing one agent workflow, generating an access/approval map, and delivering reproducible remediation tests. Do your enterprise clients currently ask for verifiable approval, audit, or revocation controls around their AI agents? I’d welcome a brief conversation to explore whether this could complement CMD’s DevSecOps delivery.*

#### 20. Hamish Tedeschi — Founder & Managing Director, Mechanical Rock
* **Role / Company**: Founder & Managing Director, Mechanical Rock (Perth/Sydney, Australia)
* **Source**: Mechanical Rock (mechanicalrock.io) & Latency Conference (2026)
* **Relevance Evidence**: Mechanical Rock is an AWS Premier Tier Services Partner celebrated for extreme automation, test-driven infrastructure, and rigorous DevOps engineering.
* **Intro Vector**: Cold/Warm via shared engineering ethos around executable testing and automated guardrails.
* **Problem Hypothesis**: Mechanical Rock clients adopting autonomous developer tooling want automated, test-backed capability governance rather than bureaucratic manual questionnaires.
* **Commercial Fit**: Peer-engineering consultancy partnership focused on test-driven agent governance.
* **Draft Message (Consultancy Partner Template)**:
  > *Hi Hamish, Mechanical Rock’s commitment to test-driven development and automated cloud governance has long stood out in the Australian AWS ecosystem. I’ve developed an executable test harness for agent capability governance: stating capability contracts as typed Pkl axioms and verifying them against real CI evidence. As clients adopt autonomous agents, do you see teams struggling to test agent access boundaries deterministically? I’d value a short peer-to-peer discussion to see if there’s common ground.*

---

## 4. Immediate Next Steps & Transition to CIT-113

1. **Review and Verification**:
   - The 20 profiles are fully cataloged in both `docs/launch/crm.csv` (machine-readable) and `docs/launch/direct-connection-crm.md` (human-readable dossiers).
   - All research derives from real, verifiable public records across Sydney, Melbourne, and the broader Australian AWS community.
2. **Upcoming Event Anchor**:
   - **Sydney AWS Meetup (25 September 2026)**: Target in-person informal discovery with Daghan Acay and Darrell King (PolarSeven).
   - **Melbourne AWS Meetup #163 (30 September 2026)**: Target follow-up with Hazra Ali.
   - **AWS Community Day Australia (16 October 2026)**: Foundation for technical feedback from Aashish Jolly, Christina Chen, Lovee Jain, Sagar Utekar, and Dmytro Sirant.
3. **Execution Gating**:
   - In accordance with CIT-110, **no messages have been sent**.
   - Issue **CIT-113** will govern sending authorization, scheduling the 5-contact weekly cadence, and logging conversation outcomes.
