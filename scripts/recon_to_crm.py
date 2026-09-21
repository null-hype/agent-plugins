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
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request
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
        "source_query_method": row.get("source_query", row.get("source_query_method", "")).strip(),
        "source_date": row.get("signal_date", row.get("source_date", "2026-09")).strip(),
        "target_segment": segment,
        "engagement_role": eng_role,
        "observed_signal": row.get("public_signal", row.get("observed_signal", "")).strip(),
        "primitive_relevance": row.get("primitive_relevance", "").strip(),
        "problem_hypothesis": row.get("problem_hypothesis", "").strip(),
        "terminology_used": row.get("terminology_notes", row.get("terminology_used", "")).strip(),
        "relationship_warm_intro": row.get("warm_intro_route", row.get("relationship_warm_intro", "")).strip(),
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
        """
        Strict mechanical identity match.
        ONLY exact normalized profile URL matches are considered mechanical matches.
        Same-name matches must NEVER auto-merge.
        """
        norm_url = normalize_profile_url(profile_url)
        if norm_url and norm_url in self.url_index:
            return self.url_index[norm_url]
        return None

    def check_rejection(self, person: str, profile_url: str) -> Optional[Dict[str, str]]:
        """
        Strict mechanical rejection check.
        ONLY exact normalized profile URL matches are considered mechanical suppressions.
        Same-name matches must NEVER auto-suppress.
        """
        norm_url = normalize_profile_url(profile_url)
        if norm_url and norm_url in self.rejection_url_index:
            return self.rejection_url_index[norm_url]
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

        # Invariant (CIT-198): Exact URL is authority to append evidence/provenance only,
        # NOT authority to change campaign decisions (priority or stage).
        # Operational reprioritization must go back through Linear human triage.

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
        ambiguous_matches = []
        if norm_name in self.person_index:
            existing_idx = self.person_index[norm_name]
            existing_rec = self.records[existing_idx]
            ambiguous_matches.append(
                f"Active CRM ID {existing_rec['id']}: {existing_rec['person']} ({existing_rec['role_organisation']})"
            )

        if norm_name in self.rejection_name_index:
            rej_rec = self.rejection_name_index[norm_name]
            ambiguous_matches.append(
                f"Rejection Registry: {rej_rec.get('person')} (Issue {rej_rec.get('linear_issue_id', 'N/A')}: {rej_rec.get('rejection_reason', '')})"
            )

        # 4. Check for organisation matches
        org = extract_organization(candidate_raw.get("role_organisation", candidate_raw.get("role_company", "")))
        org_matches = []
        if org and org in self.org_clusters:
            matched_people = self.org_clusters[org]
            org_matches = [f"{org.title()} (existing: {', '.join(matched_people)})"]

        org_match_str = "; ".join(org_matches) if org_matches else "None"
        if ambiguous_matches:
            org_match_str = f"⚠️ Ambiguous Name Match ({'; '.join(ambiguous_matches)}); " + org_match_str

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
            "is_ambiguous": len(ambiguous_matches) > 0,
            "ambiguous_details": ambiguous_matches,
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
# Linear Authority & Invariant Validation Engine (CIT-198)
# ==============================================================================

class AuthoritativeLinearError(Exception):
    """Raised when an operation violates Linear authority invariants."""
    pass


def get_linear_state_metadata(path: str) -> Dict[str, Any]:
    """Retrieve metadata from Linear triage state cache file."""
    if not os.path.exists(path):
        return {}
    try:
        with open(path, mode="r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("_metadata", {})
    except Exception:
        return {}


def save_linear_triage_state(path: str, state: Dict[str, Any]):
    """Save Linear triage state dict with metadata to disk."""
    with open(path, mode="w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def fetch_live_linear_triage_state(
    parent_id: str = "CIT-186",
    api_key: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Fetch live triage child issues directly from Linear GraphQL API.
    Linear live state is the ultimate authority; disk cache is evidence.
    """
    key = api_key or os.environ.get("LINEAR_API_KEY")
    if not key:
        raise AuthoritativeLinearError(
            "LINEAR_API_KEY environment variable or --api-key required to query Linear live API directly."
        )

    query = """
    query GetChildIssues($parentId: String!) {
      issue(id: $parentId) {
        id
        identifier
        children(first: 100) {
          nodes {
            id
            identifier
            title
            description
            url
            updatedAt
            state {
              id
              name
              type
            }
          }
        }
      }
    }
    """
    req_data = json.dumps({"query": query, "variables": {"parentId": parent_id}}).encode("utf-8")
    req = urllib.request.Request(
        "https://api.linear.app/graphql",
        data=req_data,
        headers={
            "Content-Type": "application/json",
            "Authorization": key,
            "User-Agent": "recon_to_crm/1.0",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            res = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        raise AuthoritativeLinearError(f"Failed to communicate with Linear GraphQL API: {e}")

    if "errors" in res:
        raise AuthoritativeLinearError(f"Linear GraphQL error: {res['errors']}")

    issue_data = res.get("data", {}).get("issue")
    if not issue_data:
        raise AuthoritativeLinearError(f"Linear issue '{parent_id}' not found via live API.")

    nodes = issue_data.get("children", {}).get("nodes", [])
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    state_dict = {
        "_metadata": {
            "version": "1.0",
            "fetched_at": now_iso,
            "source": "linear_live_api",
            "parent_issue": parent_id,
            "issue_count": len(nodes),
        }
    }

    for node in nodes:
        ident = node.get("identifier")
        title = node.get("title", "")
        desc = node.get("description", "")
        title_clean = title.replace("[Triage]", "").strip()
        person = title_clean.split("—")[0].strip() if "—" in title_clean else title_clean
        role = title_clean.split("—")[1].strip() if "—" in title_clean else ""

        profile_url = ""
        url_match = re.search(r"https://[a-zA-Z0-9.\-_/]*linkedin\.com/in/[a-zA-Z0-9.\-_/]+", desc)
        if url_match:
            profile_url = url_match.group(0).rstrip(")")

        state_obj = node.get("state", {})
        state_dict[ident] = {
            "id": ident,
            "uuid": node.get("id"),
            "title": title,
            "person": person,
            "role_organisation": role,
            "profile_url": profile_url,
            "status": state_obj.get("name"),
            "statusType": state_obj.get("type"),
            "linear_url": node.get("url"),
            "updatedAt": node.get("updatedAt"),
            "parentId": parent_id,
        }

    return state_dict


def load_linear_triage_state(
    path: str,
    max_age_hours: Optional[float] = 24.0,
    allow_stale: bool = False,
) -> Dict[str, Dict[str, Any]]:
    """
    Load authoritative Linear triage state snapshot from disk as cached evidence.
    Validates cache freshness and schema metadata.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Linear triage state cache file not found: {path}")
    with open(path, mode="r", encoding="utf-8") as f:
        data = json.load(f)

    meta = data.get("_metadata", {})
    fetched_at_str = meta.get("fetched_at")
    if fetched_at_str and max_age_hours is not None and not allow_stale:
        try:
            clean_ts = fetched_at_str.replace("Z", "+00:00")
            fetched_at = datetime.datetime.fromisoformat(clean_ts)
            now = datetime.datetime.now(datetime.timezone.utc)
            age_hours = (now - fetched_at).total_seconds() / 3600.0
            if age_hours > max_age_hours:
                raise AuthoritativeLinearError(
                    f"Linear triage state cache '{path}' is STALE (fetched {age_hours:.1f}h ago, max allowed is {max_age_hours}h). "
                    f"Refresh cache from Linear live state via 'refresh-linear-state' or set LINEAR_API_KEY, or pass --allow-stale."
                )
        except (ValueError, TypeError):
            pass

    # Filter out _metadata so callers receive only issue objects
    issues = {k: v for k, v in data.items() if not k.startswith("_")}
    return issues


def validate_decision_against_linear(
    decision: Dict[str, Any],
    linear_state: Dict[str, Dict[str, Any]],
) -> Tuple[bool, str]:
    """
    Validate a decision item against current authoritative Linear state.
    Returns (is_valid, reason).
    """
    linear_id = decision.get("linear_issue_id", "").strip()
    if not linear_id or linear_id == "N/A":
        return False, "Decision is missing a valid 'linear_issue_id'. Every non-grandfathered identity requires a Linear issue."

    if linear_id not in linear_state:
        return False, f"Linear issue '{linear_id}' was not found in authoritative Linear state."

    issue_info = linear_state[linear_id]
    status = issue_info.get("status", "")
    status_type = issue_info.get("statusType", "").lower()
    outcome = decision.get("outcome", "").lower().strip()

    # Rule 1: No unresolved Triage candidate may mutate CRM or rejections
    if status == "Triage" or status_type == "triage":
        return False, f"Linear issue '{linear_id}' is still in 'Triage' (unresolved). Unresolved triage issues cannot mutate CRM."

    # Rule 2: Outcome must match Linear status
    if outcome == "accept":
        if status not in ("Todo", "Done") and status_type not in ("unstarted", "completed"):
            return False, f"Linear issue '{linear_id}' has status '{status}' (type: {status_type}), which does not authorize 'accept'. Status must be 'Todo' or 'Done'."
    elif outcome == "reject":
        if status != "Canceled" and status_type != "canceled":
            return False, f"Linear issue '{linear_id}' has status '{status}' (type: {status_type}), which does not authorize 'reject'. Status must be 'Canceled'."
    elif outcome == "research":
        if status != "Backlog" and status_type != "backlog":
            return False, f"Linear issue '{linear_id}' has status '{status}' (type: {status_type}), which does not authorize 'research'. Status must be 'Backlog'."
    elif outcome == "merge":
        if status != "Duplicate" and status_type != "duplicate":
            return False, f"Linear issue '{linear_id}' has status '{status}' (type: {status_type}), which does not authorize 'merge'. Status must be 'Duplicate'."
    else:
        return False, f"Unknown decision outcome '{outcome}'. Must be 'accept', 'reject', 'research', or 'merge'."

    return True, "Valid according to Linear authority."


def validate_invariants(
    crm_records: List[Dict[str, str]],
    linear_state: Dict[str, Dict[str, Any]],
    rejections: List[Dict[str, str]],
    grandfathered_count: int = 20,
) -> Tuple[bool, List[str]]:
    """
    Validate the core CIT-198 invariants:
    1. Every non-grandfathered CRM record must have an explicit Accept decision in Linear.
    2. Every Accept decision must correspond to at most one CRM identity (no duplicate records).
    3. No unresolved Triage candidate is present in CRM.
    4. No Research/Backlog candidate is present in canonical CRM.
    5. No Reject/Canceled candidate is present in canonical CRM.
    6. All Reject candidates are recorded in the rejection registry.
    7. No duplicate profile URLs exist in canonical CRM.
    """
    errors = []
    seen_urls = set()
    accepted_in_linear = {}

    for iid, info in linear_state.items():
        status = info.get("status")
        status_type = info.get("statusType", "").lower()
        if status in ("Todo", "Done") or status_type in ("unstarted", "completed"):
            accepted_in_linear[iid] = info

    # 1. Inspect CRM records
    for idx, r in enumerate(crm_records, start=1):
        pid = int(r.get("id", idx)) if r.get("id", "").isdigit() else idx
        p_url = normalize_profile_url(r.get("profile_url", ""))
        person = r.get("person", "")
        rationale = r.get("priority_rationale", "")

        # Check duplicate profile URL
        if p_url:
            if p_url in seen_urls:
                errors.append(f"Invariant Violation: Duplicate profile URL in CRM: {p_url} ({person})")
            seen_urls.add(p_url)

        # Check non-grandfathered contacts (id > grandfathered_count)
        if pid > grandfathered_count:
            has_linear_accept = False
            for iid in accepted_in_linear:
                if iid in rationale or iid in r.get("relationship_warm_intro", ""):
                    has_linear_accept = True
                    break
            if not has_linear_accept:
                for iid, info in accepted_in_linear.items():
                    if person.lower() in info.get("title", "").lower():
                        has_linear_accept = True
                        break
            if not has_linear_accept:
                errors.append(
                    f"Invariant Violation: Non-grandfathered CRM record ID {pid} ({person}) has no explicit Accept decision in Linear."
                )

        # Check that no unresolved triage candidate is in CRM
        for iid, info in linear_state.items():
            if info.get("status") == "Triage" or info.get("statusType") == "triage":
                if person.lower() in info.get("title", "").lower():
                    errors.append(
                        f"Invariant Violation: Candidate '{person}' is still in unresolved 'Triage' in Linear ({iid}) but is present in CRM."
                    )

        # Check that no research candidate is in canonical CRM
        for iid, info in linear_state.items():
            if info.get("status") == "Backlog" or info.get("statusType") == "backlog":
                if person.lower() in info.get("title", "").lower():
                    errors.append(
                        f"Invariant Violation: Candidate '{person}' is in 'Research/Backlog' in Linear ({iid}) but is present in CRM."
                    )

        # Check that no rejected candidate is in CRM
        for iid, info in linear_state.items():
            if info.get("status") == "Canceled" or info.get("statusType") == "canceled":
                if person.lower() in info.get("title", "").lower():
                    errors.append(
                        f"Invariant Violation: Candidate '{person}' is in 'Reject/Canceled' in Linear ({iid}) but is present in CRM."
                    )

    # 2. Check that all rejected candidates are in rejections registry
    rejection_names = {normalize_person_name(rej.get("person", "")) for rej in rejections}
    rejection_urls = {normalize_profile_url(rej.get("profile_url", "")) for rej in rejections if rej.get("profile_url")}
    for iid, info in linear_state.items():
        if info.get("status") == "Canceled" or info.get("statusType") == "canceled":
            title = info.get("title", "")
            title_clean = title.replace("[Triage]", "").strip()
            name_part = title_clean.split("—")[0].strip() if "—" in title_clean else title_clean
            norm_name = normalize_person_name(name_part)
            if norm_name and norm_name not in rejection_names:
                errors.append(
                    f"Invariant Violation: Rejected candidate '{name_part}' ({iid}) is not recorded in the rejection provenance registry."
                )

    is_valid = len(errors) == 0
    return is_valid, errors


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
    p_propose.add_argument("--apply-mechanical", dest="apply_mechanical", action="store_true", default=True, help="Persist mechanical enrichments to canonical CRM (default: True)")
    p_propose.add_argument("--no-apply-mechanical", dest="apply_mechanical", action="store_false", help="Do not write mechanical enrichments to disk")

    # Command: apply-triage
    p_apply = subparsers.add_parser("apply-triage", help="Apply decided triage outcomes to CRM and rejections")
    p_apply.add_argument("--decisions", help="Path to triage decisions JSON file (optional if --from-linear is set)")
    p_apply.add_argument("--from-linear", action="store_true", help="Derive decisions directly from authoritative Linear state")
    p_apply.add_argument("--linear-state", default="docs/launch/linear-triage-state.json", help="Path to authoritative Linear triage state JSON")
    p_apply.add_argument("--proposals", default="docs/launch/triage-proposals.json", help="Path to triage proposals JSON")
    p_apply.add_argument("--crm", default="docs/launch/crm.csv", help="Path to canonical CRM CSV")
    p_apply.add_argument("--rejections", default="docs/launch/crm-rejections.csv", help="Path to rejections CSV")
    p_apply.add_argument("--research", default="docs/launch/crm-research.json", help="Path to CRM research staging JSON")
    p_apply.add_argument("--refresh", action="store_true", help="Refresh cache from Linear live API before applying")
    p_apply.add_argument("--no-live", action="store_true", help="Disable automatic live refresh attempt even if LINEAR_API_KEY is present")
    p_apply.add_argument("--max-cache-age", type=float, default=24.0, help="Max allowed cache age in hours (default: 24.0)")
    p_apply.add_argument("--allow-stale", action="store_true", help="Allow stale cache without raising error")
    p_apply.add_argument("--offline", action="store_true", help="Operate strictly offline on cached Linear state without live API requests")

    # Command: refresh-linear-state
    p_refresh = subparsers.add_parser("refresh-linear-state", help="Refresh cached Linear triage state from Linear live API")
    p_refresh.add_argument("--parent", default="CIT-186", help="Parent Linear issue identifier (default: CIT-186)")
    p_refresh.add_argument("--out", default="docs/launch/linear-triage-state.json", help="Path to write state cache JSON")
    p_refresh.add_argument("--api-key", default=None, help="Linear API key (or LINEAR_API_KEY env var)")

    # Command: validate-invariants
    p_inv = subparsers.add_parser("validate-invariants", help="Validate CIT-198 Linear authority invariants on CRM")
    p_inv.add_argument("--crm", default="docs/launch/crm.csv", help="Path to canonical CRM CSV")
    p_inv.add_argument("--linear-state", default="docs/launch/linear-triage-state.json", help="Path to authoritative Linear triage state JSON")
    p_inv.add_argument("--rejections", default="docs/launch/crm-rejections.csv", help="Path to rejections CSV")
    p_inv.add_argument("--grandfathered", type=int, default=20, help="Number of grandfathered CIT-110 contacts (default: 20)")
    p_inv.add_argument("--max-cache-age", type=float, default=24.0, help="Max allowed cache age in hours (default: 24.0)")
    p_inv.add_argument("--allow-stale", action="store_true", help="Allow stale cache without raising error")
    p_inv.add_argument("--offline", action="store_true", help="Operate strictly offline on cached Linear state without live API requests")

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
                if getattr(args, "apply_mechanical", True):
                    target_id = eval_res["target_crm_id"]
                    target_idx = None
                    for idx, r in enumerate(engine.records):
                        if r["id"] == str(target_id):
                            target_idx = idx
                            break
                    if target_idx is not None:
                        norm_rec = parse_cit184_record(row, 0)
                        engine.merge_evidence(target_idx, norm_rec)
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
            print("Mechanical Merges:")
            for m in mechanical_merges:
                print(f"  - {m['candidate']['name']} -> CRM ID {m['target_crm_id']} ({m['target_person']})")
            if getattr(args, "apply_mechanical", True):
                save_canonical_csv(args.crm, engine.records)
                print(f"  [PERSISTED] Mechanically enriched {len(mechanical_merges)} contacts in {args.crm}.")
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

        # Load research staging
        research_records = []
        if os.path.exists(args.research):
            with open(args.research, mode="r", encoding="utf-8") as f:
                try:
                    research_records = json.load(f)
                except Exception:
                    research_records = []

        # Check if live Linear refresh is requested or possible
        api_key = os.environ.get("LINEAR_API_KEY")
        is_offline = getattr(args, "offline", False) or getattr(args, "no_live", False)
        should_refresh = (getattr(args, "refresh", False) or (api_key and not is_offline)) and not is_offline
        if should_refresh:
            try:
                print("Refreshing triage state directly from Linear live API for CIT-186...")
                live_state = fetch_live_linear_triage_state(parent_id="CIT-186", api_key=api_key)
                save_linear_triage_state(args.linear_state, live_state)
                print(f"  [Linear Live Sync] Updated {args.linear_state} from Linear live API.")
            except Exception as e:
                # Fail-closed by default: abort mutation unless --allow-stale or --offline is explicitly provided
                if not getattr(args, "allow_stale", False) and not getattr(args, "offline", False):
                    raise AuthoritativeLinearError(
                        f"Linear live state fetch failed: {e}. State mutation aborted (fail-closed). "
                        "Specify --allow-stale or --offline to authorize mutation using cached evidence."
                    )
                print(f"  [Linear Live Sync] Warning: Live fetch failed ({e}). Proceeding with cached evidence (--allow-stale/--offline specified).")

        meta = get_linear_state_metadata(args.linear_state)
        source = meta.get("source", "cached_snapshot")
        fetched_at = meta.get("fetched_at", "unknown")
        print(f"  [Linear Cached Evidence] Using state from {args.linear_state} (source: {source}, fetched: {fetched_at})")

        # Load authoritative Linear state
        linear_state = load_linear_triage_state(
            args.linear_state,
            max_age_hours=getattr(args, "max_cache_age", 24.0),
            allow_stale=getattr(args, "allow_stale", False) or getattr(args, "offline", False),
        )

        # Build decisions list
        decisions = []
        if getattr(args, "from_linear", False):
            # Derive decisions directly from authoritative Linear state
            proposals_by_id = {}
            proposals_by_url = {}
            if os.path.exists(args.proposals):
                with open(args.proposals, mode="r", encoding="utf-8") as f:
                    try:
                        props = json.load(f)
                        for p in props:
                            cand = p.get("candidate", {})
                            url = cand.get("profile_url", p.get("profile_url", ""))
                            norm_u = normalize_profile_url(url)
                            if norm_u:
                                proposals_by_url[norm_u] = cand
                            lid = p.get("linear_issue_id", cand.get("linear_issue_id", ""))
                            if lid:
                                proposals_by_id[lid] = cand
                    except Exception:
                        pass

            for iid, info in linear_state.items():
                status = info.get("status")
                status_type = info.get("statusType", "").lower()
                title = info.get("title", "")
                title_clean = title.replace("[Triage]", "").strip()
                person_from_info = info.get("person", "")
                if not person_from_info:
                    person_from_info = title_clean.split("—")[0].strip() if "—" in title_clean else title_clean
                role_from_info = info.get("role_organisation", title_clean)
                url_from_info = info.get("profile_url", "")
                norm_info_url = normalize_profile_url(url_from_info)

                # Bind candidate strictly through Linear issue ID or exact normalized URL — NEVER by name!
                cand = None
                if iid in proposals_by_id:
                    cand = proposals_by_id[iid]
                elif norm_info_url and norm_info_url in proposals_by_url:
                    cand = proposals_by_url[norm_info_url]
                else:
                    cand = {
                        "name": person_from_info,
                        "person": person_from_info,
                        "role_organisation": role_from_info,
                        "profile_url": url_from_info,
                    }

                if not cand.get("profile_url") and url_from_info:
                    cand["profile_url"] = url_from_info
                if not cand.get("name"):
                    cand["name"] = person_from_info
                if not cand.get("person"):
                    cand["person"] = person_from_info

                if status in ("Todo", "Done") or status_type in ("unstarted", "completed"):
                    decisions.append({
                        "linear_issue_id": iid,
                        "outcome": "accept",
                        "candidate": cand,
                        "review_priority": "P1",
                    })
                elif status == "Canceled" or status_type == "canceled":
                    decisions.append({
                        "linear_issue_id": iid,
                        "outcome": "reject",
                        "candidate": cand,
                        "reason": f"Rejected in Linear ({iid})",
                    })
                elif status == "Backlog" or status_type == "backlog":
                    decisions.append({
                        "linear_issue_id": iid,
                        "outcome": "research",
                        "candidate": cand,
                        "missing_fact": f"Held in Linear triage ({iid}) for research",
                    })
                elif status == "Duplicate" or status_type == "duplicate":
                    decisions.append({
                        "linear_issue_id": iid,
                        "outcome": "merge",
                        "candidate": cand,
                    })
                # 'Triage' status is deliberately skipped as unresolved
        elif getattr(args, "decisions", None):
            with open(args.decisions, mode="r", encoding="utf-8") as f:
                decisions = json.load(f)
        else:
            print("Error: Either --decisions <path> or --from-linear must be specified.")
            sys.exit(1)

        print(f"Applying {len(decisions)} triage decisions verified against Linear authority ({args.linear_state})...")
        engine = IngestionEngine(crm_records, rejections)

        accepted_count = 0
        rejected_count = 0
        research_count = 0
        merged_count = 0

        for item in decisions:
            # 1. VERIFY AGAINST LINEAR AUTHORITY
            valid, reason = validate_decision_against_linear(item, linear_state)
            if not valid:
                print(f"❌ Linear Authorization Error: {reason}")
                raise AuthoritativeLinearError(reason)

            outcome = item.get("outcome", "").lower()
            candidate = item.get("candidate", {})
            linear_id = item.get("linear_issue_id", "N/A")
            person_name = candidate.get("name", candidate.get("person", ""))
            profile_url = candidate.get("profile_url", "")
            norm_url = normalize_profile_url(profile_url)
            norm_name = normalize_person_name(person_name)

            if outcome == "accept":
                # Check if candidate is ALREADY in CRM by exact normalized URL OR Linear ID (Idempotent)
                # Invariant (CIT-198): No name-only fallback! Same-name different-URL candidates MUST NOT merge.
                existing_match_idx = None
                if norm_url and norm_url in engine.url_index:
                    existing_match_idx = engine.url_index[norm_url]
                elif linear_id and linear_id != "N/A":
                    for idx, r in enumerate(engine.records):
                        if linear_id in r.get("priority_rationale", "") or linear_id in r.get("relationship_warm_intro", ""):
                            existing_match_idx = idx
                            break

                if existing_match_idx is not None:
                    norm_rec = parse_cit184_record(candidate, 0)
                    engine.merge_evidence(existing_match_idx, norm_rec)
                    print(f"  - Idempotent Accept: {person_name} already in CRM ID {engine.records[existing_match_idx]['id']} (evidence merged)")
                else:
                    next_id = len(engine.records) + 1
                    norm_rec = parse_cit184_record(candidate, next_id)
                    norm_rec["priority_rationale"] = f"Accepted via Linear {linear_id}: {norm_rec['priority_rationale']}"
                    if "review_priority" in item:
                        norm_rec["review_priority"] = item["review_priority"]
                    norm_rec["stage"] = item.get("stage", "researched")
                    engine.records.append(norm_rec)
                    if norm_url:
                        engine.url_index[norm_url] = len(engine.records) - 1
                    if norm_name:
                        engine.person_index[norm_name] = len(engine.records) - 1
                    accepted_count += 1
                    print(f"  - Accept: Ingested {person_name} as CRM ID {next_id} (Authorized by {linear_id})")

                # Remove from research staging if previously held for research
                research_records = [
                    r for r in research_records
                    if not (
                        (linear_id and linear_id != "N/A" and r.get("linear_issue_id") == linear_id)
                        or (norm_url and normalize_profile_url(r.get("profile_url", "")) == norm_url)
                    )
                ]

            elif outcome == "reject":
                # Save to rejection provenance idempotently
                # Identity bound strictly through linear_id or exact normalized URL — NEVER by name!
                already_rej = False
                for r in rejections:
                    if linear_id and linear_id != "N/A" and r.get("linear_issue_id") == linear_id:
                        already_rej = True
                        break
                    if norm_url and normalize_profile_url(r.get("profile_url", "")) == norm_url:
                        already_rej = True
                        break

                if not already_rej:
                    rej_entry = {
                        "person": person_name,
                        "role_organisation": candidate.get("role_organisation", candidate.get("role_company", "")),
                        "profile_url": profile_url,
                        "rejection_reason": item.get("reason", f"Rejected during Linear triage ({linear_id})"),
                        "linear_issue_id": linear_id,
                        "rejected_date": item.get("date", "2026-09-20"),
                        "source_query_method": candidate.get("source_query", candidate.get("source_query_method", "")),
                        "observed_signal": candidate.get("public_signal", candidate.get("observed_signal", "")),
                    }
                    rejections.append(rej_entry)
                    rejected_count += 1
                    print(f"  - Reject: Recorded negative provenance for {person_name} ({linear_id})")

                # Remove from active CRM if present
                # Identity bound strictly through exact normalized URL or linear_id — NEVER by name!
                crm_before = len(engine.records)
                def is_rejected_crm_match(rec):
                    r_u = normalize_profile_url(rec.get("profile_url", ""))
                    if norm_url and r_u == norm_url:
                        return True
                    if linear_id and linear_id != "N/A" and (linear_id in rec.get("priority_rationale", "") or linear_id in rec.get("relationship_warm_intro", "")):
                        return True
                    return False

                engine.records = [r for r in engine.records if not is_rejected_crm_match(r)]
                if len(engine.records) < crm_before:
                    print(f"    (Removed {person_name} from active CRM by URL/Linear ID match)")

                # Remove from research staging if previously held for research
                research_records = [
                    r for r in research_records
                    if not (
                        (linear_id and linear_id != "N/A" and r.get("linear_issue_id") == linear_id)
                        or (norm_url and normalize_profile_url(r.get("profile_url", "")) == norm_url)
                    )
                ]

            elif outcome == "research":
                # Staged outside CRM idempotently
                # Identity bound strictly through linear_id or exact normalized URL — NEVER by name!
                already_staged = False
                for r in research_records:
                    if linear_id and linear_id != "N/A" and r.get("linear_issue_id") == linear_id:
                        already_staged = True
                        break
                    if norm_url and normalize_profile_url(r.get("profile_url", "")) == norm_url:
                        already_staged = True
                        break

                if not already_staged:
                    research_entry = {
                        "linear_issue_id": linear_id,
                        "person": person_name,
                        "role_organisation": candidate.get("role_organisation", candidate.get("role_company", "")),
                        "profile_url": profile_url,
                        "missing_fact": item.get("missing_fact", f"Held in Linear triage ({linear_id}) for missing fact"),
                        "status": "held_for_research",
                        "staged_date": item.get("date", "2026-09-20"),
                    }
                    research_records.append(research_entry)
                    research_count += 1
                    print(f"  - Research: Staged {person_name} outside canonical CRM ({linear_id})")

                # Remove from active CRM if present
                # Identity bound strictly through exact normalized URL or linear_id — NEVER by name!
                crm_before = len(engine.records)
                def is_research_crm_match(rec):
                    r_u = normalize_profile_url(rec.get("profile_url", ""))
                    if norm_url and r_u == norm_url:
                        return True
                    if linear_id and linear_id != "N/A" and (linear_id in rec.get("priority_rationale", "") or linear_id in rec.get("relationship_warm_intro", "")):
                        return True
                    return False

                engine.records = [r for r in engine.records if not is_research_crm_match(r)]
                if len(engine.records) < crm_before:
                    print(f"    (Removed {person_name} from active CRM by URL/Linear ID match)")

            elif outcome == "merge":
                target_id = str(item.get("target_crm_id", "")).strip()
                target_idx = None
                if target_id:
                    for idx, r in enumerate(engine.records):
                        if r["id"] == target_id:
                            target_idx = idx
                            break
                elif norm_url and norm_url in engine.url_index:
                    target_idx = engine.url_index[norm_url]

                if target_idx is not None:
                    norm_rec = parse_cit184_record(candidate, 0)
                    engine.merge_evidence(target_idx, norm_rec)
                    merged_count += 1
                    print(f"  - Merge: Merged evidence for {person_name} into CRM ID {engine.records[target_idx]['id']}")
                else:
                    print(f"Warning: Target CRM ID '{target_id}' or exact URL match not found for merge of {person_name}")

        # Renumber canonical records sequentially
        for idx, r in enumerate(engine.records, start=1):
            r["id"] = str(idx)

        # Save files
        save_canonical_csv(args.crm, engine.records)
        save_rejections_csv(args.rejections, rejections)
        with open(args.research, mode="w", encoding="utf-8") as f:
            json.dump(research_records, f, indent=2)

        print("\n--------------------------------------------------------------------------------")
        print("Authoritative Linear Triage Decisions Applied:")
        print(f"  - Accepted into CRM:             {accepted_count}")
        print(f"  - Recorded in Rejections:        {rejected_count}")
        print(f"  - Staged in Research (non-CRM):  {research_count}")
        print(f"  - Merged into Existing ID:       {merged_count}")
        print(f"  - Total Active CRM Total:        {len(engine.records)}")
        print(f"  - Total Rejection Registry:      {len(rejections)}")
        print(f"  - Total Staged Research Leads:   {len(research_records)}")
        print("--------------------------------------------------------------------------------\n")

    elif args.command == "refresh-linear-state":
        print(f"Fetching live triage state from Linear for parent {args.parent}...")
        api_key = args.api_key or os.environ.get("LINEAR_API_KEY")
        live_state = fetch_live_linear_triage_state(parent_id=args.parent, api_key=api_key)
        save_linear_triage_state(args.out, live_state)
        issue_count = len([k for k in live_state if not k.startswith("_")])
        print(f"✅ Successfully refreshed {issue_count} issues from Linear live API to {args.out}.\n")

    elif args.command == "validate-invariants":
        crm_header, crm_records = load_csv(args.crm)
        if not crm_records:
            print(f"Error: CRM file {args.crm} not found or empty.")
            sys.exit(1)

        rej_header, rejections = load_csv(args.rejections)
        meta = get_linear_state_metadata(args.linear_state)
        source = meta.get("source", "cached_snapshot")
        fetched_at = meta.get("fetched_at", "unknown")
        print(f"[Linear Cached Evidence] Validating against state from {args.linear_state} (source: {source}, fetched: {fetched_at})")

        linear_state = load_linear_triage_state(
            args.linear_state,
            max_age_hours=getattr(args, "max_cache_age", 24.0),
            allow_stale=getattr(args, "allow_stale", False),
        )

        print(f"Validating CIT-198 Invariants:")
        print(f"  - Canonical CRM Contacts:  {len(crm_records)} ({args.crm})")
        print(f"  - Linear Triage State:     {len(linear_state)} issues ({args.linear_state})")
        print(f"  - Rejection Registry:      {len(rejections)} entries ({args.rejections})")
        print(f"  - Grandfathered Contacts:  {args.grandfathered} (IDs 1..{args.grandfathered})\n")

        valid, errors = validate_invariants(
            crm_records,
            linear_state,
            rejections,
            grandfathered_count=args.grandfathered,
        )

        if valid:
            print("✅ Invariant Check PASSED: 100% compliant with CIT-198 Linear authority invariants.")
            print("  - All non-grandfathered CRM records have explicit Linear Accept decisions.")
            print("  - Zero unresolved Triage, Research, or Rejected candidates in canonical CRM.")
            print("  - Negative provenance verified for all rejected leads.")
            print("  - Every Accept decision corresponds to exactly one CRM record.")
        else:
            print(f"❌ Invariant Check FAILED with {len(errors)} violation(s):")
            for e in errors:
                print(f"  - {e}")
            sys.exit(1)

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

        enriched_count = 0
        bypassed_candidates = []

        for row in recon_rows:
            url = row.get("profile_url", "")
            norm_url = normalize_profile_url(url)
            # Only exact profile URL match to an existing accepted CRM contact is permitted
            if norm_url and norm_url in engine.url_index:
                target_idx = engine.url_index[norm_url]
                canonical_rec = parse_cit184_record(row, 0)
                engine.merge_evidence(target_idx, canonical_rec)
                enriched_count += 1
            else:
                # Direct ingestion bypass blocked!
                cname = row.get("person", row.get("name", "Unknown"))
                bypassed_candidates.append(f"{cname} ({url})")

        print("\n--------------------------------------------------------------------------------")
        print("Reconciliation & Ingestion Summary (Linear Authority Invariant):")
        print(f"  - Existing CRM Records:               {len(existing_records)}")
        print(f"  - Incoming Recon Records:             {len(recon_rows)}")
        print(f"  - Permitted Mechanical Enrichments:   {enriched_count}")
        print(f"  - Blocked Direct Ingestion Attempts:  {len(bypassed_candidates)}")
        print(f"  - Final Canonical CRM Total:          {len(engine.records)}")
        print("--------------------------------------------------------------------------------")

        if bypassed_candidates:
            print("\n🚫 DIRECT INGESTION BYPASS PREVENTED:")
            print("  Invariant: Ingest cannot add genuinely new recon candidates directly to CRM.")
            print("  New identities must flow through 'propose' -> Linear Triage -> 'apply-triage'.")
            print(f"  Blocked {len(bypassed_candidates)} unapproved candidate(s):")
            for b in bypassed_candidates[:5]:
                print(f"    - {b}")
            if len(bypassed_candidates) > 5:
                print(f"    ... and {len(bypassed_candidates) - 5} more.")

        if args.apply:
            if enriched_count > 0:
                save_canonical_csv(args.crm, engine.records)
                print(f"\n Successfully wrote {len(engine.records)} canonical records (mechanically enriched {enriched_count}) to {args.crm}")
            else:
                print("\nNo mechanical enrichments to persist.")
        else:
            print("\nDRY-RUN MODE: Changes were not written to disk. Use --apply to save.")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
