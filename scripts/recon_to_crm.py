#!/usr/bin/env python3
"""
scripts/recon_to_crm.py - Repeatable Recon-to-CRM Ingestion Pipeline (CIT-185)

Implements the deterministic pipeline:
  recon run -> evidence-backed candidates -> normalize -> dedupe -> prioritize -> human review -> canonical CRM -> outreach handoff

Strict Operational Guardrail:
  Recon and ingestion ONLY. Absolutely no messages sent, connections requested, or
  outbound actions performed. Downstream issue CIT-113 owns authorized outreach.
"""

import argparse
import csv
import json
import os
import re
import sys
from typing import Dict, List, Optional, Tuple, Any

# ==============================================================================
# Canonical Schema Definition (24 Fields)
# ==============================================================================

CANONICAL_FIELDS = [
    "id",
    "person",
    "role_organisation",
    "profile_url",
    "source_query_method",
    "source_date",
    "target_segment",
    "engagement_role",
    "observed_signal",
    "primitive_relevance",
    "problem_hypothesis",
    "terminology_used",
    "relationship_warm_intro",
    "confidence",
    "review_priority",
    "priority_rationale",
    "stage",
    "last_contact",
    "next_action_date",
    "reply_objection",
    "contact_channel",
    "workflow_owner",
    "commercial_fit",
    "declined_opt_out",
]

ALLOWED_STAGES = {
    "researched",
    "review_queue",
    "held_for_research",
    "approved_for_outreach",
    "contacted",
    "in_dialogue",
    "qualified",
    "closed",
    "opted_out",
}

ALLOWED_PRIORITIES = {"P1", "P2", "P3"}
ALLOWED_CONFIDENCE = {"high", "medium", "low"}
ALLOWED_OPT_OUT = {"No", "Yes"}

KNOWN_ORG_ALIASES = {
    "coefficient": "coefficient giving",
    "coefficient giving": "coefficient giving",
    "bluedot": "bluedot impact",
    "bluedot impact": "bluedot impact",
    "bluedot grant recipient": "bluedot impact",
    "cmd solutions": "mantel group",
    "cmd solutions (mantel group)": "mantel group",
    "mantel group": "mantel group",
    "polarseven": "polarseven",
    "versent": "versent",
    "canva": "canva",
    "redwood research": "redwood research",
    "anz": "anz",
    "elastic": "elastic",
    "jpmorganchase": "jpmorganchase",
    "jpmorgan": "jpmorganchase",
    "jpmorgan chase": "jpmorganchase",
}

RAW_CIT184_P1 = {
    "Anurag Roy Barman": (
        "P1",
        "Author of 'Planner-Authoriser Collision'; enterprise IAM architect at ANZ navigating APRA compliance for autonomous agents.",
        "review_queue",
    ),
    "Dr. Harish Kotadia Ph.D.": (
        "P1",
        "Published analysis proving advisory policies fail and controls must mechanically stop actions before execution.",
        "review_queue",
    ),
    "Inna Carp": (
        "P1",
        "Documented 'Agent Tool Drift' in Dynamics 365 ERP; proves prompts fail as security boundaries and validates typed capability checks.",
        "review_queue",
    ),
    "Jason Keirstead": (
        "P1",
        "Founding CTO/CISO; advocates deterministic pre-merge invariants over soft runtime alignment.",
        "review_queue",
    ),
    "Ofir Har-Chen": (
        "P1",
        "CEO Clutch Security; quantified non-human identity sprawl (median 15 NHIs per agent, max 67k); proves credentials are agency.",
        "review_queue",
    ),
    "Mandy Andress": (
        "P1",
        "CISO Elastic; established CISO requirements for identity-bound agent execution containment and least privilege.",
        "review_queue",
    ),
    "Paul Ntoumos": (
        "P1",
        "Enterprise transformation consultant; established 'Decision Governance vs Decision Assurance' traceability from human intent to agent.",
        "review_queue",
    ),
    "Ishmael Chibvuri": (
        "P1",
        "Security architect; pioneered 'Snapshot Discipline' and reversibility as prerequisites for agent autonomy; validates restic snapshot model.",
        "review_queue",
    ),
    "Dewi Erwan": (
        "P1",
        "CEO BlueDot Impact; directs Rapid Grants program funding open-source technical AI safety infrastructure (CIT-179 target).",
        "review_queue",
    ),
    "Max Nadeau": (
        "P1",
        "Program Officer at Coefficient Giving; directs grantmaking for technical AI safety and governance infrastructure (CIT-179 target).",
        "review_queue",
    ),
    "Jake Mendel": (
        "P1",
        "Program Officer at Coefficient Giving; co-leads technical AI safety grant portfolio with Max Nadeau (CIT-179 target).",
        "review_queue",
    ),
}

RAW_CIT184_HELD = {
    "Brian Peretti": (
        "P3",
        "Retired CTO & Deputy Chief AI Officer; verify current advisory/consulting availability before initiating dialogue.",
        "held_for_research",
    ),
    "Daniel Phillips": (
        "P3",
        "Independent AI safety researcher; verify whether research covers software capability control vs pure alignment before outreach.",
        "held_for_research",
    ),
    "Mirco Bianchini": (
        "P3",
        "Sr TPM Automation & MCP; monitor upcoming MCP product releases for enterprise capability controls.",
        "held_for_research",
    ),
    "Tom McLeod": (
        "P3",
        "Global Advisor Internal Audit; monitor for specific AI agent assurance frameworks before outreach.",
        "held_for_research",
    ),
}

CIT184_P1_CANDIDATES = {}
CIT184_HELD_FOR_RESEARCH = {}

IGNORED_ORGS = {
    "regulated enterprises",
    "enterprise cloud & zero trust",
    "cybersecurity & ai leader",
    "ai safety researcher",
    "automation & mcp",
    "dynamics 365",
    "aws community builder",
    "cloud & ai engineer",
    "ai quality engineer & senior sdet",
    "agentic ai engineer & senior software engineer",
}


# ==============================================================================
# Helper Functions: String Normalization & Cleaning
# ==============================================================================

def normalize_person_name(name: str) -> str:
    """Normalize personal names by stripping honorifics, titles, and non-alphanumeric chars."""
    if not name:
        return ""
    cleaned = re.sub(r"(?i)\b(ph\.?d\.?|dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?|cpt?o|cto|ciso|ceo)\b", "", name)
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    tokens = [t.lower() for t in cleaned.split() if t.strip()]
    return " ".join(tokens)


# Initialize normalized candidate mappings
CIT184_P1_CANDIDATES.update({normalize_person_name(k): v for k, v in RAW_CIT184_P1.items()})
CIT184_HELD_FOR_RESEARCH.update({normalize_person_name(k): v for k, v in RAW_CIT184_HELD.items()})


def normalize_profile_url(url: str) -> str:
    """Normalize profile URLs by stripping query strings and trailing slashes."""
    if not url:
        return ""
    url = url.strip()
    url = re.split(r"[?#]", url)[0]
    return url.rstrip("/").lower()


def extract_organization(role_org: str) -> str:
    """Extract and normalize primary organization name."""
    if not role_org:
        return ""
    m = re.search(r"(?:at|@)\s+([^,|;&/(]+)", role_org, re.IGNORECASE)
    raw = m.group(1).strip() if m else ""
    if not raw:
        parts = re.split(r"[,|;&/(]", role_org)
        raw = parts[-1].strip() if parts else role_org.strip()
    norm = raw.lower().strip()
    for alias, canonical in KNOWN_ORG_ALIASES.items():
        if alias in norm or norm in alias:
            return canonical
    return norm


# ==============================================================================
# Input File Detection & Parsing
# ==============================================================================

def detect_file_schema(header: List[str]) -> str:
    """Detect whether file is Canonical CRM, CIT-110 CRM, or CIT-184 Recon format."""
    normalized_header = [h.strip().lower() for h in header]
    if "primitive_relevance" in normalized_header and "terminology_used" in normalized_header and "review_priority" in normalized_header:
        return "canonical_crm"
    elif "urgency" in normalized_header and "role_company" in normalized_header:
        return "cit110_crm"
    elif "primitive_relevance" in normalized_header and "terminology_notes" in normalized_header:
        return "cit184_recon"
    return "generic_recon"


def parse_cit110_record(row: Dict[str, str], next_id: int) -> Dict[str, str]:
    """Normalize legacy CIT-110 CRM record into Canonical CRM representation."""
    source_raw = row.get("source_url_date", "")
    source_method = source_raw
    source_date = "2026-05"
    if "," in source_raw:
        parts = source_raw.rsplit(",", 1)
        source_method = parts[0].strip()
        source_date = parts[1].strip()

    urgency = row.get("urgency", "Medium").strip().capitalize()
    priority_map = {"High": "P1", "Medium": "P2", "Low": "P3"}
    review_priority = priority_map.get(urgency, "P2")

    person = row.get("person", "").strip()
    role_company = row.get("role_company", "").strip()

    priority_rationale = f"CIT-110 seed contact ({urgency} urgency): {role_company}"
    evidence = row.get("relevance_evidence", "")
    hypothesis = row.get("problem_hypothesis", "")

    primitive_rel = (
        "Directly relevant to pre-merge capability gates, credential containment, and auditable access governance."
    )
    terminology = "Least privilege, Zero Trust, non-human identity, access review friction"

    canonical = {
        "id": str(next_id),
        "person": person,
        "role_organisation": role_company,
        "profile_url": "",
        "source_query_method": source_method,
        "source_date": source_date,
        "target_segment": row.get("segment", "Buyer").strip(),
        "engagement_role": row.get("segment", "Buyer").strip().lower().replace("/", "_"),
        "observed_signal": evidence.strip(),
        "primitive_relevance": primitive_rel,
        "problem_hypothesis": hypothesis.strip(),
        "terminology_used": terminology,
        "relationship_warm_intro": row.get("relationship_warm_intro", "").strip(),
        "confidence": "high" if urgency == "High" else "medium",
        "review_priority": review_priority,
        "priority_rationale": priority_rationale,
        "stage": row.get("stage", "researched").strip(),
        "last_contact": row.get("last_contact", "None").strip(),
        "next_action_date": row.get("next_action_date", "").strip(),
        "reply_objection": row.get("reply_objection", "None").strip(),
        "contact_channel": row.get("contact_channel", "LinkedIn InMail").strip(),
        "workflow_owner": row.get("workflow_owner", "Head of Security").strip(),
        "commercial_fit": row.get("commercial_fit", "Target for scoped assessment offer").strip(),
        "declined_opt_out": row.get("declined_opt_out", "No").strip(),
    }
    return canonical


def parse_cit184_record(row: Dict[str, str], next_id: int) -> Dict[str, str]:
    """Normalize CIT-184 recon candidate into Canonical CRM representation."""
    person = row.get("name", "").strip()
    norm_name = normalize_person_name(person)
    role_org = row.get("role_organisation", "").strip()
    confidence = row.get("confidence", "medium").strip().lower()
    segment = row.get("segment", "practitioner").strip()

    # Determine Review Priority, Rationale, and Stage
    if norm_name in CIT184_P1_CANDIDATES:
        review_priority, priority_rationale, stage = CIT184_P1_CANDIDATES[norm_name]
    elif norm_name in CIT184_HELD_FOR_RESEARCH:
        review_priority, priority_rationale, stage = CIT184_HELD_FOR_RESEARCH[norm_name]
    else:
        review_priority = "P2" if confidence == "high" else "P3"
        priority_rationale = f"CIT-184 recon candidate ({segment}): {role_org}"
        stage = "researched"

    eng_role = row.get("engagement_role", "practitioner").strip().lower()
    if eng_role == "funder" or "funder" in segment:
        commercial_fit = "Grant funding candidate (CIT-179)"
    elif eng_role == "buyer" or "buyer" in segment:
        commercial_fit = "Target for scoped assessment offer"
    elif eng_role == "partner":
        commercial_fit = "Strategic consulting partner"
    else:
        commercial_fit = "Technical advisory / practitioner validation (CIT-181)"

    workflow_owner = "Security / Platform Lead"
    if "ciso" in role_org.lower():
        workflow_owner = "CISO"
    elif "cto" in role_org.lower():
        workflow_owner = "CTO"
    elif "funder" in eng_role or "program officer" in role_org.lower() or "grant" in role_org.lower():
        workflow_owner = "AI Safety Grantmaker"
    elif "architect" in role_org.lower():
        workflow_owner = "Principal Architect"

    canonical = {
        "id": str(next_id),
        "person": person,
        "role_organisation": role_org,
        "profile_url": row.get("profile_url", "").strip(),
        "source_query_method": row.get("source_query", "").strip(),
        "source_date": row.get("signal_date", "2026-09").strip(),
        "target_segment": segment,
        "engagement_role": eng_role,
        "observed_signal": row.get("public_signal", "").strip(),
        "primitive_relevance": row.get("primitive_relevance", "").strip(),
        "problem_hypothesis": row.get("problem_hypothesis", "").strip(),
        "terminology_used": row.get("terminology_notes", "").strip(),
        "relationship_warm_intro": row.get("warm_intro_route", "").strip(),
        "confidence": confidence,
        "review_priority": review_priority,
        "priority_rationale": priority_rationale,
        "stage": stage,
        "last_contact": "None",
        "next_action_date": row.get("next_action", "").strip(),
        "reply_objection": "None",
        "contact_channel": "LinkedIn InMail",
        "workflow_owner": workflow_owner,
        "commercial_fit": commercial_fit,
        "declined_opt_out": "No",
    }
    return canonical


# ==============================================================================
# Deduplication and Evidence Preservation Engine
# ==============================================================================

class IngestionEngine:
    def __init__(self, existing_records: Optional[List[Dict[str, str]]] = None):
        self.records: List[Dict[str, str]] = []
        self.person_index: Dict[str, int] = {}  # norm_name -> record index
        self.url_index: Dict[str, int] = {}     # norm_url -> record index
        self.org_index: Dict[str, List[int]] = {} # norm_org -> list of record indices

        self.exact_duplicates_merged = 0
        self.newly_added = 0
        self.same_org_distinct_people = 0
        self.held_for_research_count = 0
        self.org_clusters: Dict[str, List[str]] = {}

        if existing_records:
            for rec in existing_records:
                self._index_record(rec)

    def _index_record(self, record: Dict[str, str]):
        idx = len(self.records)
        self.records.append(record)

        norm_name = normalize_person_name(record.get("person", ""))
        if norm_name:
            self.person_index[norm_name] = idx

        norm_url = normalize_profile_url(record.get("profile_url", ""))
        if norm_url:
            self.url_index[norm_url] = idx

        org = extract_organization(record.get("role_organisation", ""))
        if org and org not in IGNORED_ORGS:
            self.org_index.setdefault(org, []).append(idx)
            self.org_clusters.setdefault(org, []).append(record.get("person", ""))

    def find_match(self, person: str, profile_url: str) -> Optional[int]:
        norm_url = normalize_profile_url(profile_url)
        if norm_url and norm_url in self.url_index:
            return self.url_index[norm_url]

        norm_name = normalize_person_name(person)
        if norm_name and norm_name in self.person_index:
            return self.person_index[norm_name]

        return None

    def merge_evidence(self, existing_idx: int, incoming: Dict[str, str]):
        existing = self.records[existing_idx]
        self.exact_duplicates_merged += 1

        if not existing.get("profile_url") and incoming.get("profile_url"):
            existing["profile_url"] = incoming["profile_url"]

        incoming_signal = incoming.get("observed_signal", "").strip()
        if incoming_signal and incoming_signal not in existing.get("observed_signal", ""):
            existing["observed_signal"] = (
                f"{existing.get('observed_signal', '').rstrip()} | [Additional signal ({incoming.get('source_date', '')})]: {incoming_signal}"
            )

        new_terms = incoming.get("terminology_used", "").strip()
        if new_terms and new_terms not in existing.get("terminology_used", ""):
            existing["terminology_used"] = (
                f"{existing.get('terminology_used', '').rstrip()}; {new_terms}"
            ).lstrip("; ")

        new_query = incoming.get("source_query_method", "").strip()
        if new_query and new_query not in existing.get("source_query_method", ""):
            existing["source_query_method"] = (
                f"{existing.get('source_query_method', '')} / {new_query}"
            )

        if incoming.get("review_priority") == "P1" and existing.get("review_priority") != "P1":
            existing["review_priority"] = "P1"
            existing["priority_rationale"] = (
                f"{existing.get('priority_rationale', '')} Elevated via: {incoming.get('priority_rationale', '')}"
            )

    def ingest_record(self, record: Dict[str, str]):
        person = record.get("person", "")
        profile_url = record.get("profile_url", "")

        match_idx = self.find_match(person, profile_url)
        if match_idx is not None:
            self.merge_evidence(match_idx, record)
            return

        org = extract_organization(record.get("role_organisation", ""))
        if org and org in self.org_index and len(self.org_index[org]) > 0:
            self.same_org_distinct_people += 1

        record["id"] = str(len(self.records) + 1)

        if record.get("stage") == "held_for_research":
            self.held_for_research_count += 1

        self._index_record(record)
        self.newly_added += 1


# ==============================================================================
# Validation Engine
# ==============================================================================

def validate_canonical_dataset(records: List[Dict[str, str]]) -> Tuple[bool, List[str]]:
    """Validate that records strictly follow the canonical CRM schema and constraints."""
    errors = []
    seen_ids = set()

    for idx, row in enumerate(records, start=1):
        for field in CANONICAL_FIELDS:
            if field not in row:
                errors.append(f"Row {idx} missing canonical column: '{field}'")

        for critical in ["id", "person", "role_organisation", "observed_signal", "problem_hypothesis", "review_priority", "stage"]:
            val = row.get(critical, "").strip()
            if not val:
                errors.append(f"Row {idx} has empty critical field: '{critical}'")

        rec_id = row.get("id", "").strip()
        if rec_id in seen_ids:
            errors.append(f"Row {idx} has duplicate ID: {rec_id}")
        seen_ids.add(rec_id)

        priority = row.get("review_priority", "").strip()
        if priority not in ALLOWED_PRIORITIES:
            errors.append(f"Row {idx} ({row.get('person')}) invalid review_priority: '{priority}' (must be P1, P2, P3)")

        stage = row.get("stage", "").strip()
        if stage not in ALLOWED_STAGES:
            errors.append(f"Row {idx} ({row.get('person')}) invalid stage: '{stage}'")

        confidence = row.get("confidence", "").strip().lower()
        if confidence not in ALLOWED_CONFIDENCE:
            errors.append(f"Row {idx} ({row.get('person')}) invalid confidence: '{confidence}'")

        opt_out = row.get("declined_opt_out", "").strip()
        if opt_out not in ALLOWED_OPT_OUT:
            errors.append(f"Row {idx} ({row.get('person')}) invalid declined_opt_out: '{opt_out}'")

    is_valid = len(errors) == 0
    return is_valid, errors


# ==============================================================================
# Review Queue & Reporting
# ==============================================================================

def generate_review_queue(records: List[Dict[str, str]], limit: int = 10, stage_filter: Optional[str] = None) -> List[Dict[str, str]]:
    """Generate prioritized human review queue (Stage: review_queue > researched, then P1 > P2 > P3)."""
    candidates = [
        r for r in records
        if r.get("declined_opt_out", "No") == "No"
        and (stage_filter is None or r.get("stage") == stage_filter)
        and r.get("stage") in ("review_queue", "researched")
    ]

    stage_weights = {"review_queue": 1, "researched": 2}
    priority_weights = {"P1": 1, "P2": 2, "P3": 3}
    confidence_weights = {"high": 1, "medium": 2, "low": 3}

    def sort_key(rec):
        s_val = stage_weights.get(rec.get("stage", "researched"), 3)
        p_val = priority_weights.get(rec.get("review_priority", "P3"), 4)
        c_val = confidence_weights.get(rec.get("confidence", "low").lower(), 4)
        return (s_val, p_val, c_val, int(rec.get("id", "999")))

    candidates.sort(key=sort_key)
    return candidates[:limit]


def format_review_queue_table(queue: List[Dict[str, str]]) -> str:
    lines = [
        "| # | ID | Candidate | Role & Organisation | Segment | Priority | Priority Rationale | Proposed Next Action |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for i, r in enumerate(queue, start=1):
        person = f"**{r.get('person', '')}**"
        role_org = r.get("role_organisation", "")
        segment = r.get("target_segment", "")
        priority = f"`{r.get('review_priority', '')}`"
        rationale = r.get("priority_rationale", "")
        next_action = r.get("next_action_date", "")
        rec_id = r.get("id", "")
        lines.append(f"| {i} | {rec_id} | {person} | {role_org} | {segment} | {priority} | {rationale} | {next_action} |")
    return "\n".join(lines)


# ==============================================================================
# File I/O
# ==============================================================================

def load_csv(file_path: str) -> Tuple[List[str], List[Dict[str, str]]]:
    with open(file_path, mode="r", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            return [], []
        dict_reader = csv.DictReader(f, fieldnames=header)
        rows = list(dict_reader)
    return header, rows


def save_canonical_csv(file_path: str, records: List[Dict[str, str]]):
    with open(file_path, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CANONICAL_FIELDS, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        for r in records:
            clean_row = {k: r.get(k, "") for k in CANONICAL_FIELDS}
            writer.writerow(clean_row)


# ==============================================================================
# CLI Entrypoint
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Repeatable Recon-to-CRM Ingestion Pipeline (CIT-185)",
        epilog="Operational Notice: Recon & Ingestion ONLY. Absolutely no outbound messages sent. Outreach belongs strictly to CIT-113.",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    p_ingest = subparsers.add_parser("ingest", help="Ingest recon file into CRM")
    p_ingest.add_argument("--recon", required=True, help="Path to incoming recon candidates CSV")
    p_ingest.add_argument("--crm", required=True, help="Path to existing or target canonical CRM CSV")
    p_ingest.add_argument("--apply", action="store_true", help="Apply changes and overwrite/write CRM CSV")
    p_ingest.add_argument("--dry-run", action="store_true", help="Dry run without writing files")

    p_validate = subparsers.add_parser("validate", help="Validate a CRM or Recon CSV")
    p_validate.add_argument("--file", required=True, help="File path to validate")

    p_queue = subparsers.add_parser("review-queue", help="Display top human review queue")
    p_queue.add_argument("--crm", required=True, help="Path to canonical CRM CSV")
    p_queue.add_argument("--limit", type=int, default=10, help="Number of candidates to display (default: 10)")
    p_queue.add_argument("--stage", choices=["review_queue", "researched"], help="Filter by specific stage")

    p_report = subparsers.add_parser("report", help="Display summary metrics of the CRM")
    p_report.add_argument("--crm", required=True, help="Path to canonical CRM CSV")

    args = parser.parse_args()

    print("\n================================================================================")
    print("  CIT-185: Repeatable Recon-to-CRM Pipeline")
    print("  [SAFETY GUARD] Recon only. Strictly NO outbound actions. Handoff to CIT-113.")
    print("================================================================================\n")

    if args.command == "validate":
        header, rows = load_csv(args.file)
        schema_type = detect_file_schema(header)
        print(f"File: {args.file}")
        print(f"Detected Schema: {schema_type} ({len(rows)} records, {len(header)} columns)")
        if schema_type == "canonical_crm":
            valid, errors = validate_canonical_dataset(rows)
            if valid:
                print(" Validation Result: PASSED. 100% compliant with canonical CRM contract.")
            else:
                print(f" Validation Result: FAILED with {len(errors)} error(s):")
                for e in errors[:10]:
                    print(f"   - {e}")
                sys.exit(1)
        else:
            print(f"Note: File is in '{schema_type}' format, not canonical. Use 'ingest' to normalize.")

    elif args.command == "review-queue":
        header, rows = load_csv(args.crm)
        queue = generate_review_queue(rows, limit=args.limit, stage_filter=getattr(args, "stage", None))
        print(f"Human Review Queue (Top {len(queue)} Candidates from {len(rows)} total records):")
        print("--------------------------------------------------------------------------------")
        print(format_review_queue_table(queue))
        print("--------------------------------------------------------------------------------")
        print("Reminder: Human review required before approving records for CIT-113 outreach.\n")

    elif args.command == "report":
        header, rows = load_csv(args.crm)
        print(f"CRM Dataset Report: {args.crm}")
        print(f"Total Contacts: {len(rows)}")

        segments: Dict[str, int] = {}
        for r in rows:
            seg = r.get("target_segment", "Unknown")
            segments[seg] = segments.get(seg, 0) + 1
        print("\nTarget Segments:")
        for seg, count in sorted(segments.items(), key=lambda x: x[1], reverse=True):
            print(f"  - {seg}: {count}")

        priorities: Dict[str, int] = {}
        for r in rows:
            p = r.get("review_priority", "Unknown")
            priorities[p] = priorities.get(p, 0) + 1
        print("\nReview Priorities:")
        for p, count in sorted(priorities.items()):
            print(f"  - {p}: {count}")

        stages: Dict[str, int] = {}
        for r in rows:
            s = r.get("stage", "Unknown")
            stages[s] = stages.get(s, 0) + 1
        print("\nLifecycle Stages:")
        for s, count in sorted(stages.items(), key=lambda x: x[1], reverse=True):
            print(f"  - {s}: {count}")

    elif args.command == "ingest":
        existing_records = []
        if os.path.exists(args.crm):
            crm_header, crm_rows = load_csv(args.crm)
            crm_schema = detect_file_schema(crm_header)
            print(f"Loaded existing CRM ({args.crm}): {len(crm_rows)} records (Format: {crm_schema})")
            if crm_schema == "cit110_crm":
                print("Normalizing existing legacy CIT-110 CRM records to Canonical Schema...")
                for r in crm_rows:
                    existing_records.append(parse_cit110_record(r, len(existing_records) + 1))
            elif crm_schema == "canonical_crm":
                existing_records = crm_rows
            else:
                print(f"Warning: Unknown existing CRM format '{crm_schema}'. Treating as raw dicts.")
                existing_records = crm_rows
        else:
            print(f"Target CRM file {args.crm} does not exist yet. Initializing new canonical CRM.")

        engine = IngestionEngine(existing_records)

        recon_header, recon_rows = load_csv(args.recon)
        recon_schema = detect_file_schema(recon_header)
        print(f"Loaded incoming Recon file ({args.recon}): {len(recon_rows)} records (Format: {recon_schema})")

        for row in recon_rows:
            if recon_schema == "cit184_recon":
                canonical_rec = parse_cit184_record(row, len(engine.records) + 1)
            elif recon_schema == "canonical_crm":
                canonical_rec = row
            else:
                canonical_rec = parse_cit184_record(row, len(engine.records) + 1)
            engine.ingest_record(canonical_rec)

        print("\n--------------------------------------------------------------------------------")
        print("Reconciliation & Ingestion Summary:")
        print(f"  - Existing CRM Records:        {len(existing_records)}")
        print(f"  - Incoming Recon Records:      {len(recon_rows)}")
        print(f"  - Exact Duplicates Merged:     {engine.exact_duplicates_merged}")
        print(f"  - Same Org, Distinct People:   {engine.same_org_distinct_people}")
        print(f"  - Records Held for Research:   {engine.held_for_research_count}")
        print(f"  - Newly Added Records:         {engine.newly_added}")
        print(f"  - Final Canonical CRM Total:   {len(engine.records)}")
        print("--------------------------------------------------------------------------------")

        # Display detected organization clusters
        multi_orgs = {org: people for org, people in engine.org_clusters.items() if len(people) > 1}
        if multi_orgs:
            print("\nDetected Organisation Clusters (Multiple contacts in same entity):")
            for org, people in sorted(multi_orgs.items()):
                print(f"  - {org.title()}: {', '.join(people)}")

        print("\n--------------------------------------------------------------------------------\n")

        valid, errors = validate_canonical_dataset(engine.records)
        if not valid:
            print(f"Validation Warning: Canonical records generated {len(errors)} issue(s):")
            for e in errors[:5]:
                print(f"  - {e}")
        else:
            print("Validation Check: 100% compliant with Canonical CRM schema.\n")

        queue = generate_review_queue(engine.records, limit=10)
        print("Top 10 Human Review Queue (Awaiting Review):")
        print("--------------------------------------------------------------------------------")
        print(format_review_queue_table(queue))
        print("--------------------------------------------------------------------------------\n")

        if args.apply:
            save_canonical_csv(args.crm, engine.records)
            print(f" Successfully wrote {len(engine.records)} canonical records to {args.crm}")
        else:
            print("DRY-RUN MODE: Changes were not written to disk. Use --apply to save.")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
