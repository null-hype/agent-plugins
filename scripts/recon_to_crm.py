#!/usr/bin/env python3
"""
scripts/recon_to_crm.py - Repeatable Recon-to-CRM Pipeline with Linear Triage (CIT-185 / CIT-186)

Separation of Responsibilities:
  1. Recon agents (e.g. Playwright-MCP): Discover public evidence.
  2. Code (this script): Mechanical reconciliation, deduplication, proposal generation.
  3. Linear: Human decision layer (Accept, Reject, Research, Merge).
  4. CRM (docs/launch/crm.csv): Accepted campaign state.
  5. CIT-113: Outbound action boundary (strictly no messaging in this pipeline).
"""

import argparse
import csv
import json
import os
import re
import sys
from typing import Dict, List, Optional, Tuple, Any

# ==============================================================================
# Canonical Schema Definitions
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

REJECTION_FIELDS = [
    "person",
    "role_organisation",
    "profile_url",
    "rejection_reason",
    "linear_issue_id",
    "rejected_date",
    "source_query_method",
    "observed_signal",
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
# Generic Heuristic Priority Proposal Engine (No Hard-Coded Batches)
# ==============================================================================

def propose_candidate_priority(row: Dict[str, str]) -> Tuple[str, str, str]:
    """
    Generically infer a proposed review priority, rationale, and stage from candidate attributes.
    Produces proposals, NOT unilateral decisions. Final decisions are recorded in Linear.
    """
    role = row.get("role_organisation", "").lower()
    signal = row.get("public_signal", "").lower()
    primitive = row.get("primitive_relevance", "").lower()
    hypothesis = row.get("problem_hypothesis", "").lower()
    terms = row.get("terminology_notes", row.get("terminology_used", "")).lower()
    confidence = row.get("confidence", "medium").lower()
    segment = row.get("segment", row.get("target_segment", "practitioner")).lower()
    eng_role = row.get("engagement_role", "practitioner").lower()

    # 1. P3 / Held for research heuristics
    if "retired" in role or "[retired]" in role or "former" in role:
        return (
            "P3",
            "Retired or former title; verify current active consulting/advisory availability before initiating dialogue",
            "held_for_research",
        )
    if "internal audit" in role and "agent" not in role and "ai" not in role:
        return (
            "P3",
            "Broad internal audit scope; monitor for explicit AI agent assurance frameworks before engagement",
            "held_for_research",
        )

    # 2. P1 Heuristics: Executive security buyers, funder program officers, direct control researchers, NHI architects
    p1_reasons = []
    if any(k in role for k in ["ciso", "head of security", "vp security", "director of security", "chief security"]):
        p1_reasons.append("CISO / Security Leadership")
    if any(k in role for k in ["program officer", "grantmaker", "head of the transformative", "bluedot impact", "manifund", "coefficient"]):
        p1_reasons.append("AI Safety Funder / Grantmaker (CIT-179 target)")
    if any(k in role for k in ["iam", "identity"]) or "non-human identity" in signal or "planner-authoriser collision" in signal:
        p1_reasons.append("Enterprise IAM & Non-Human Identity boundary alignment")
    if any(k in signal for k in ["stop the action by itself", "snapshot discipline", "agent tool drift", "deterministic controls", "decision assurance"]):
        p1_reasons.append("Directly validates executable pre-merge governance vs advisory policy")
    if "redwood research" in role or "ai control" in role or "foundational" in signal:
        p1_reasons.append("AI Control foundational research validation (CIT-181 target)")
    if "clutch security" in role or "credentials as agency" in terms:
        p1_reasons.append("NHI credential sprawl measurement & containment")

    if p1_reasons and confidence in ("high", "medium"):
        rationale = f"Proposed P1 ({confidence} confidence): " + "; ".join(p1_reasons)
        return "P1", rationale, "review_queue"

    # 3. P2 Heuristics: Active platform engineers, SDETs, solution architects, enterprise consultants
    if confidence == "high":
        rationale = f"Proposed P2 (high confidence): Qualified {segment} ({eng_role}) with active agent/tool implementation"
        return "P2", rationale, "researched"
    elif confidence == "medium":
        rationale = f"Proposed P2 (medium confidence): Relevant {segment} ({eng_role}) requiring secondary validation"
        return "P2", rationale, "researched"

    # Fallback to P3
    return "P3", f"Proposed P3 ({confidence} confidence): Low confidence match; monitor for further signals", "held_for_research"


# ==============================================================================
# Linear Triage Issue Template Generator
# ==============================================================================

def generate_linear_triage_description(
    candidate: Dict[str, str],
    org_matches: str = "None",
    proposed_priority: str = "P2",
    priority_rationale: str = "",
) -> Tuple[str, str]:
    """Generate compact title and markdown description for a Linear triage issue."""
    name = candidate.get("person", candidate.get("name", "Unknown"))
    role_org = candidate.get("role_organisation", candidate.get("role_company", ""))
    profile_url = candidate.get("profile_url", "")
    source_query = candidate.get("source_query_method", candidate.get("source_query", ""))
    source_date = candidate.get("source_date", candidate.get("signal_date", "2026-09"))
    observed_signal = candidate.get("observed_signal", candidate.get("public_signal", candidate.get("relevance_evidence", "")))
    primitive_relevance = candidate.get("primitive_relevance", "")
    problem_hypothesis = candidate.get("problem_hypothesis", "")
    segment = candidate.get("target_segment", candidate.get("segment", "practitioner"))
    engagement_role = candidate.get("engagement_role", segment)
    warm_path = candidate.get("relationship_warm_intro", candidate.get("warm_intro_route", "Cold substantive angle"))
    next_action = candidate.get("next_action_date", candidate.get("next_action", ""))
    terminology = candidate.get("terminology_used", candidate.get("terminology_notes", ""))
    confidence = candidate.get("confidence", "medium")

    title = f"[Triage] {name} — {role_org}"

    desc = f"""## Candidate Overview
* **Person:** {name}
* **Role & Organisation:** {role_org}
* **Profile URL:** {profile_url}
* **Proposed Segment / Role:** `{segment}` / `{engagement_role}`
* **Warm Path:** {warm_path}

## Observed Public Signal (Verbatim Evidence)
* **Source:** `{source_query}` ({source_date})
* **Signal:**
> {observed_signal}

## Relevance to Governance Primitive
{primitive_relevance}

## [INFERRED HYPOTHESIS]
> ⚠️ *Inferred operational friction, not directly stated by candidate.*  
{problem_hypothesis}

## Proposed Ingestion Action
* **Proposed Priority:** `{proposed_priority}` ({priority_rationale})
* **Confidence:** `{confidence}`
* **Suggested Next Action:** {next_action}
* **Terminology:** {terminology}
* **Organisation Matches:** {org_matches}

---
### Triage Decision Guide
To decide this triage item, update issue state or add comment:
* **Accept** (Move to `Todo` or `Done`): Ingest into canonical CRM (`docs/launch/crm.csv`).
* **Reject** (Move to `Canceled`): Add to `docs/launch/crm-rejections.csv` to suppress reproposal.
* **Research** (Move to `Backlog`): Needs missing fact via recon (e.g. Playwright-MCP).
* **Merge** (Move to `Duplicate`): Merge evidence into existing CRM ID.
"""
    return title, desc


# ==============================================================================
# Input File Detection & Parsing
# ==============================================================================

def detect_file_schema(header: List[str]) -> str:
    """Detect whether file is Canonical CRM, CIT-110 CRM, CIT-184 Recon, or Rejections format."""
    normalized_header = [h.strip().lower() for h in header]
    if "rejection_reason" in normalized_header and "linear_issue_id" in normalized_header:
        return "crm_rejections"
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
    """Normalize CIT-184 recon candidate into Canonical CRM representation using generic proposals."""
    person = row.get("name", "").strip()
    role_org = row.get("role_organisation", "").strip()
    confidence = row.get("confidence", "medium").strip().lower()
    segment = row.get("segment", "practitioner").strip()

    # Use generic heuristic priority proposal engine
    review_priority, priority_rationale, stage = propose_candidate_priority(row)

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
# Deduplication and Ingestion Engine
# ==============================================================================

class IngestionEngine:
    def __init__(
        self,
        existing_records: Optional[List[Dict[str, str]]] = None,
        rejection_records: Optional[List[Dict[str, str]]] = None,
    ):
        self.records: List[Dict[str, str]] = []
        self.rejections: List[Dict[str, str]] = rejection_records or []

        self.person_index: Dict[str, int] = {}    # norm_name -> record index
        self.url_index: Dict[str, int] = {}       # norm_url -> record index
        self.org_index: Dict[str, List[int]] = {} # norm_org -> list of record indices
        self.rejection_url_index: Dict[str, Dict[str, str]] = {}
        self.rejection_name_index: Dict[str, Dict[str, str]] = {}

        self.exact_duplicates_merged = 0
        self.newly_added = 0
        self.same_org_distinct_people = 0
        self.held_for_research_count = 0
        self.suppressed_rejections_count = 0
        self.org_clusters: Dict[str, List[str]] = {}

        # Index rejections
        for rej in self.rejections:
            norm_u = normalize_profile_url(rej.get("profile_url", ""))
            if norm_u:
                self.rejection_url_index[norm_u] = rej
            norm_n = normalize_person_name(rej.get("person", ""))
            if norm_n:
                self.rejection_name_index[norm_n] = rej

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

    def check_rejection(self, person: str, profile_url: str) -> Optional[Dict[str, str]]:
        norm_url = normalize_profile_url(profile_url)
        if norm_url and norm_url in self.rejection_url_index:
            return self.rejection_url_index[norm_url]
        norm_name = normalize_person_name(person)
        if norm_name and norm_name in self.rejection_name_index:
            return self.rejection_name_index[norm_name]
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

    def evaluate_recon_candidate(self, candidate_raw: Dict[str, str]) -> Dict[str, Any]:
        """
        Evaluate a recon candidate against canonical CRM state and rejections.
        Returns evaluation dict categorizing the candidate into:
          - 'mechanical_merge' (exact URL match -> append evidence)
          - 'suppressed_rejection' (found in rejections without new evidence)
          - 'triage_proposal' (genuinely new or ambiguous match requiring human decision)
        """
        person = candidate_raw.get("name", candidate_raw.get("person", "")).strip()
        url = candidate_raw.get("profile_url", "").strip()
        norm_url = normalize_profile_url(url)
        norm_name = normalize_person_name(person)

        # 1. Check exact profile URL match in active CRM (Purely mechanical merge)
        if norm_url and norm_url in self.url_index:
            existing_idx = self.url_index[norm_url]
            existing_rec = self.records[existing_idx]
            return {
                "action": "mechanical_merge",
                "target_crm_id": existing_rec["id"],
                "target_person": existing_rec["person"],
                "reason": f"Exact profile URL match with CRM ID {existing_rec['id']} ({existing_rec['person']})",
                "candidate": candidate_raw,
            }

        # 2. Check rejection registry (Purely mechanical suppression)
        rejection = self.check_rejection(person, url)
        if rejection:
            return {
                "action": "suppressed_rejection",
                "rejection_reason": rejection.get("rejection_reason", "Previously rejected"),
                "linear_issue_id": rejection.get("linear_issue_id", ""),
                "reason": f"Previously rejected in Linear ({rejection.get('linear_issue_id', 'no issue ID')}): {rejection.get('rejection_reason', '')}",
                "candidate": candidate_raw,
            }

        # 3. Check for same name with uncertain / different URL (Ambiguous candidate -> Triage)
        ambiguous_match = None
        if norm_name in self.person_index:
            existing_idx = self.person_index[norm_name]
            existing_rec = self.records[existing_idx]
            ambiguous_match = f"CRM ID {existing_rec['id']}: {existing_rec['person']} ({existing_rec['role_organisation']})"

        # 4. Check for organisation matches
        org = extract_organization(candidate_raw.get("role_organisation", candidate_raw.get("role_company", "")))
        org_matches = []
        if org and org in self.org_clusters:
            matched_people = self.org_clusters[org]
            org_matches = [f"{org.title()} (existing: {', '.join(matched_people)})"]

        org_match_str = "; ".join(org_matches) if org_matches else "None"
        if ambiguous_match:
            org_match_str = f"Ambiguous Name Match: {ambiguous_match}; " + org_match_str

        # Generate generic proposal
        proposed_priority, priority_rationale, proposed_stage = propose_candidate_priority(candidate_raw)

        # Generate Linear triage issue content
        issue_title, issue_desc = generate_linear_triage_description(
            candidate_raw,
            org_matches=org_match_str,
            proposed_priority=proposed_priority,
            priority_rationale=priority_rationale,
        )

        return {
            "action": "triage_proposal",
            "candidate": candidate_raw,
            "person": person,
            "role_organisation": candidate_raw.get("role_organisation", candidate_raw.get("role_company", "")),
            "profile_url": url,
            "proposed_priority": proposed_priority,
            "priority_rationale": priority_rationale,
            "proposed_stage": proposed_stage,
            "org_matches": org_match_str,
            "is_ambiguous": ambiguous_match is not None,
            "linear_issue_payload": {
                "title": issue_title,
                "description": issue_desc,
                "priority": 1 if proposed_priority == "P1" else (2 if proposed_priority == "P2" else 3),
            },
        }


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
    if not os.path.exists(file_path):
        return [], []
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


def save_rejections_csv(file_path: str, rejections: List[Dict[str, str]]):
    with open(file_path, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=REJECTION_FIELDS, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        for r in rejections:
            clean_row = {k: r.get(k, "") for k in REJECTION_FIELDS}
            writer.writerow(clean_row)


# ==============================================================================
# CLI Entrypoint
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Repeatable Recon-to-CRM Pipeline with Linear Triage (CIT-185 / CIT-186)",
        epilog="Operational Notice: Recon & Ingestion ONLY. Absolutely no outbound messages sent. Outreach belongs strictly to CIT-113.",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # Command: propose
    p_propose = subparsers.add_parser("propose", help="Evaluate recon candidates and generate Linear triage proposals")
    p_propose.add_argument("--recon", required=True, help="Path to incoming recon candidates CSV")
    p_propose.add_argument("--crm", default="docs/launch/crm.csv", help="Path to canonical CRM CSV")
    p_propose.add_argument("--rejections", default="docs/launch/crm-rejections.csv", help="Path to rejections CSV")
    p_propose.add_argument("--out", default="docs/launch/triage-proposals.json", help="Path to save proposals JSON")

    # Command: apply-triage
    p_apply = subparsers.add_parser("apply-triage", help="Apply decided triage outcomes to CRM and rejections")
    p_apply.add_argument("--decisions", required=True, help="Path to triage decisions JSON file")
    p_apply.add_argument("--crm", default="docs/launch/crm.csv", help="Path to canonical CRM CSV")
    p_apply.add_argument("--rejections", default="docs/launch/crm-rejections.csv", help="Path to rejections CSV")

    # Command: ingest (direct ingestion using generic proposal engine)
    p_ingest = subparsers.add_parser("ingest", help="Ingest recon file into CRM using generic proposal engine")
    p_ingest.add_argument("--recon", required=True, help="Path to incoming recon candidates CSV")
    p_ingest.add_argument("--crm", required=True, help="Path to canonical CRM CSV")
    p_ingest.add_argument("--rejections", default="docs/launch/crm-rejections.csv", help="Path to rejections CSV")
    p_ingest.add_argument("--apply", action="store_true", help="Apply changes and overwrite CRM CSV")
    p_ingest.add_argument("--dry-run", action="store_true", help="Dry run without writing files")

    # Command: validate
    p_validate = subparsers.add_parser("validate", help="Validate a CRM or Recon CSV")
    p_validate.add_argument("--file", required=True, help="File path to validate")

    # Command: review-queue
    p_queue = subparsers.add_parser("review-queue", help="Display top human review queue")
    p_queue.add_argument("--crm", default="docs/launch/crm.csv", help="Path to canonical CRM CSV")
    p_queue.add_argument("--limit", type=int, default=10, help="Number of candidates to display (default: 10)")
    p_queue.add_argument("--stage", choices=["review_queue", "researched"], help="Filter by specific stage")

    # Command: report
    p_report = subparsers.add_parser("report", help="Display summary metrics of the CRM")
    p_report.add_argument("--crm", default="docs/launch/crm.csv", help="Path to canonical CRM CSV")

    args = parser.parse_args()

    print("\n================================================================================")
    print("  CIT-186: Recon-to-CRM Pipeline with Linear Triage")
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
        elif schema_type == "crm_rejections":
            print(" Validation Result: PASSED. Valid rejection registry format.")
        else:
            print(f"Note: File is in '{schema_type}' format, not canonical. Use 'propose' or 'ingest'.")

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

    elif args.command == "propose":
        # Load existing CRM
        existing_records = []
        if os.path.exists(args.crm):
            _, crm_rows = load_csv(args.crm)
            existing_records = crm_rows

        # Load rejections
        rejections = []
        if os.path.exists(args.rejections):
            _, rej_rows = load_csv(args.rejections)
            rejections = rej_rows

        engine = IngestionEngine(existing_records, rejections)

        # Load incoming recon
        _, recon_rows = load_csv(args.recon)
        print(f"Evaluating {len(recon_rows)} incoming candidates against:")
        print(f"  - Active CRM contacts:     {len(existing_records)}")
        print(f"  - Rejection registry:      {len(rejections)}")

        mechanical_merges = []
        suppressed_rejections = []
        triage_proposals = []

        for row in recon_rows:
            eval_res = engine.evaluate_recon_candidate(row)
            action = eval_res["action"]
            if action == "mechanical_merge":
                mechanical_merges.append(eval_res)
            elif action == "suppressed_rejection":
                suppressed_rejections.append(eval_res)
            elif action == "triage_proposal":
                triage_proposals.append(eval_res)

        print("\n--------------------------------------------------------------------------------")
        print("Triage Evaluation Summary:")
        print(f"  - Purely Mechanical Merges (Auto-append to CRM):  {len(mechanical_merges)}")
        print(f"  - Suppressed Rejections (Known rejected):         {len(suppressed_rejections)}")
        print(f"  - Genuinely New / Ambiguous (Linear Triage):       {len(triage_proposals)}")
        print("--------------------------------------------------------------------------------\n")

        if mechanical_merges:
            print("Mechanical Merges (No Linear issue needed):")
            for m in mechanical_merges:
                print(f"  - {m['candidate']['name']} -> CRM ID {m['target_crm_id']} ({m['target_person']})")
            print()

        if suppressed_rejections:
            print("Suppressed Rejections (No Linear issue needed):")
            for s in suppressed_rejections:
                print(f"  - {s['candidate']['name']}: {s['reason']}")
            print()

        print(f"Saving {len(triage_proposals)} Linear triage proposals to {args.out}...")
        with open(args.out, mode="w", encoding="utf-8") as f:
            json.dump(triage_proposals, f, indent=2)

        print(f" Successfully saved triage proposals. Review in Linear or apply via 'apply-triage'.\n")

    elif args.command == "apply-triage":
        # Load existing CRM
        crm_header, crm_records = load_csv(args.crm)
        if not crm_records:
            print(f"Error: CRM file {args.crm} not found or empty.")
            sys.exit(1)

        # Load rejections
        rej_header, rejections = load_csv(args.rejections)

        with open(args.decisions, mode="r", encoding="utf-8") as f:
            decisions = json.load(f)

        print(f"Applying {len(decisions)} triage decisions to canonical CRM and rejections...")
        engine = IngestionEngine(crm_records, rejections)

        accepted_count = 0
        rejected_count = 0
        research_count = 0
        merged_count = 0

        for item in decisions:
            outcome = item.get("outcome", "").lower()
            candidate = item.get("candidate", {})
            linear_id = item.get("linear_issue_id", "N/A")

            if outcome == "accept":
                # Normalize and add to canonical CRM
                norm_rec = parse_cit184_record(candidate, len(engine.records) + 1)
                # Apply human decision overrides if specified
                if "review_priority" in item:
                    norm_rec["review_priority"] = item["review_priority"]
                if "stage" in item:
                    norm_rec["stage"] = item["stage"]
                else:
                    norm_rec["stage"] = "researched"
                engine.ingest_record(norm_rec)
                accepted_count += 1

            elif outcome == "reject":
                # Save to rejections registry
                rej_entry = {
                    "person": candidate.get("name", candidate.get("person", "")),
                    "role_organisation": candidate.get("role_organisation", candidate.get("role_company", "")),
                    "profile_url": candidate.get("profile_url", ""),
                    "rejection_reason": item.get("reason", "Rejected during Linear triage"),
                    "linear_issue_id": linear_id,
                    "rejected_date": item.get("date", "2026-09-20"),
                    "source_query_method": candidate.get("source_query", candidate.get("source_query_method", "")),
                    "observed_signal": candidate.get("public_signal", candidate.get("observed_signal", "")),
                }
                rejections.append(rej_entry)
                rejected_count += 1

            elif outcome == "research":
                # Mark as held_for_research
                norm_rec = parse_cit184_record(candidate, len(engine.records) + 1)
                norm_rec["stage"] = "held_for_research"
                norm_rec["priority_rationale"] = f"Held in Linear triage ({linear_id}): {item.get('missing_fact', 'Needs additional recon')}"
                engine.ingest_record(norm_rec)
                research_count += 1

            elif outcome == "merge":
                target_id = str(item.get("target_crm_id", ""))
                # Find target CRM record
                target_idx = None
                for idx, r in enumerate(engine.records):
                    if r["id"] == target_id:
                        target_idx = idx
                        break
                if target_idx is not None:
                    norm_rec = parse_cit184_record(candidate, 0)
                    engine.merge_evidence(target_idx, norm_rec)
                    merged_count += 1
                else:
                    print(f"Warning: Target CRM ID {target_id} not found for merge of {candidate.get('name')}")

        save_canonical_csv(args.crm, engine.records)
        save_rejections_csv(args.rejections, rejections)

        print("\n--------------------------------------------------------------------------------")
        print("Triage Decisions Applied:")
        print(f"  - Accepted into CRM:        {accepted_count}")
        print(f"  - Recorded in Rejections:   {rejected_count}")
        print(f"  - Held for Research:        {research_count}")
        print(f"  - Merged into Existing ID:  {merged_count}")
        print(f"  - Total Active CRM Total:   {len(engine.records)}")
        print(f"  - Total Rejection Registry: {len(rejections)}")
        print("--------------------------------------------------------------------------------\n")

    elif args.command == "ingest":
        existing_records = []
        if os.path.exists(args.crm):
            crm_header, crm_rows = load_csv(args.crm)
            crm_schema = detect_file_schema(crm_header)
            print(f"Loaded existing CRM ({args.crm}): {len(crm_rows)} records (Format: {crm_schema})")
            if crm_schema == "cit110_crm":
                for r in crm_rows:
                    existing_records.append(parse_cit110_record(r, len(existing_records) + 1))
            elif crm_schema == "canonical_crm":
                existing_records = crm_rows
            else:
                existing_records = crm_rows

        rejections = []
        if os.path.exists(args.rejections):
            _, rej_rows = load_csv(args.rejections)
            rejections = rej_rows

        engine = IngestionEngine(existing_records, rejections)

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
        print("Reconciliation & Ingestion Summary (Generic Proposals):")
        print(f"  - Existing CRM Records:        {len(existing_records)}")
        print(f"  - Incoming Recon Records:      {len(recon_rows)}")
        print(f"  - Exact Duplicates Merged:     {engine.exact_duplicates_merged}")
        print(f"  - Same Org, Distinct People:   {engine.same_org_distinct_people}")
        print(f"  - Records Held for Research:   {engine.held_for_research_count}")
        print(f"  - Newly Added Records:         {engine.newly_added}")
        print(f"  - Final Canonical CRM Total:   {len(engine.records)}")
        print("--------------------------------------------------------------------------------")

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
        print("Top 10 Human Review Queue:")
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
