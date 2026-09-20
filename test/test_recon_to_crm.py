#!/usr/bin/env python3
"""
test/test_recon_to_crm.py - Unit tests for repeatable recon-to-CRM pipeline with Linear Triage (CIT-185 / CIT-186)
"""

import os
import tempfile
import unittest
from scripts.recon_to_crm import (
    CANONICAL_FIELDS,
    REJECTION_FIELDS,
    IngestionEngine,
    detect_file_schema,
    normalize_person_name,
    normalize_profile_url,
    extract_organization,
    propose_candidate_priority,
    generate_linear_triage_description,
    parse_cit110_record,
    parse_cit184_record,
    validate_canonical_dataset,
    generate_review_queue,
    load_csv,
    save_canonical_csv,
    load_linear_triage_state,
    validate_decision_against_linear,
    validate_invariants,
    AuthoritativeLinearError,
)


class TestReconToCRM(unittest.TestCase):
    def test_canonical_fields_count(self):
        self.assertEqual(len(CANONICAL_FIELDS), 24)
        self.assertIn("observed_signal", CANONICAL_FIELDS)
        self.assertIn("problem_hypothesis", CANONICAL_FIELDS)
        self.assertIn("primitive_relevance", CANONICAL_FIELDS)
        self.assertIn("terminology_used", CANONICAL_FIELDS)
        self.assertIn("review_priority", CANONICAL_FIELDS)

    def test_rejection_fields_count(self):
        self.assertEqual(len(REJECTION_FIELDS), 8)
        self.assertIn("rejection_reason", REJECTION_FIELDS)
        self.assertIn("linear_issue_id", REJECTION_FIELDS)

    def test_normalization_helpers(self):
        self.assertEqual(normalize_person_name("Dr. Harish Kotadia Ph.D."), "harish kotadia")
        self.assertEqual(normalize_person_name("Ofir Har-Chen"), "ofir har chen")
        self.assertEqual(normalize_person_name("Kane Narraway"), "kane narraway")

        self.assertEqual(
            normalize_profile_url("https://www.linkedin.com/in/hkotadia/?miniProfileUrn=123/"),
            "https://www.linkedin.com/in/hkotadia",
        )

        self.assertEqual(extract_organization("Head of Security at Canva"), "canva")
        self.assertEqual(extract_organization("Senior Cloud Consultant at Mantel Group"), "mantel group")
        self.assertEqual(extract_organization("Partner & CEO of CMD Solutions (Mantel Group)"), "mantel group")
        self.assertEqual(extract_organization("Program Officer, Technical AI Safety at Coefficient Giving"), "coefficient giving")

    def test_deduplication_and_evidence_preservation(self):
        engine = IngestionEngine()
        seed_record = {
            "id": "1",
            "person": "Anurag Roy Barman",
            "role_organisation": "Tech Area Architect at ANZ",
            "profile_url": "https://www.linkedin.com/in/anurag-roy-barman-96749519",
            "source_query_method": "Initial query",
            "source_date": "2026-09-01",
            "target_segment": "practitioner",
            "engagement_role": "practitioner",
            "observed_signal": "Talk on IAM architecture.",
            "primitive_relevance": "Relevant to access control.",
            "problem_hypothesis": "Agents need permissions.",
            "terminology_used": "IAM",
            "relationship_warm_intro": "Warm path",
            "confidence": "high",
            "review_priority": "P2",
            "priority_rationale": "Initial seed",
            "stage": "researched",
            "last_contact": "None",
            "next_action_date": "Follow up by Sep 25",
            "reply_objection": "None",
            "contact_channel": "LinkedIn InMail",
            "workflow_owner": "Principal Architect",
            "commercial_fit": "Advisory",
            "declined_opt_out": "No",
        }
        engine.ingest_record(seed_record)
        self.assertEqual(len(engine.records), 1)

        recon_signal = {
            "id": "99",
            "person": "Anurag Roy Barman",
            "role_organisation": "Tech Area Architect at ANZ",
            "profile_url": "https://www.linkedin.com/in/anurag-roy-barman-96749519/",
            "source_query_method": "Second query: planner-authoriser collision",
            "source_date": "2026-09-20",
            "target_segment": "practitioner",
            "engagement_role": "practitioner",
            "observed_signal": "Published post on Planner-Authoriser Collision.",
            "primitive_relevance": "Matches supervisor grant protocol.",
            "problem_hypothesis": "Agents write their own authority.",
            "terminology_used": "Planner-authoriser collision",
            "relationship_warm_intro": "Warm path",
            "confidence": "high",
            "review_priority": "P1",
            "priority_rationale": "Elevated via high-impact post",
            "stage": "review_queue",
            "last_contact": "None",
            "next_action_date": "Map to supervisor protocol",
            "reply_objection": "None",
            "contact_channel": "LinkedIn InMail",
            "workflow_owner": "Principal Architect",
            "commercial_fit": "Advisory",
            "declined_opt_out": "No",
        }
        engine.ingest_record(recon_signal)

        self.assertEqual(len(engine.records), 1)
        self.assertEqual(engine.exact_duplicates_merged, 1)

        merged = engine.records[0]
        self.assertIn("Talk on IAM architecture.", merged["observed_signal"])
        self.assertIn("Published post on Planner-Authoriser Collision.", merged["observed_signal"])
        self.assertEqual(merged["review_priority"], "P1")
        self.assertIn("Elevated via:", merged["priority_rationale"])
        self.assertIn("Planner-authoriser collision", merged["terminology_used"])

    def test_generic_proposal_heuristic(self):
        # Test CISO -> P1 proposal
        ciso_row = {
            "role_organisation": "CISO at Elastic",
            "public_signal": "Non-human identity containment is critical.",
            "confidence": "high",
            "segment": "buyer",
        }
        priority, rationale, stage = propose_candidate_priority(ciso_row)
        self.assertEqual(priority, "P1")
        self.assertIn("CISO", rationale)

        # Test Retired -> P3 proposal
        retired_row = {
            "role_organisation": "[Retired] CTO and Deputy Chief AI Officer",
            "public_signal": "AI safety controls are management controls.",
            "confidence": "medium",
            "segment": "practitioner",
        }
        priority, rationale, stage = propose_candidate_priority(retired_row)
        self.assertEqual(priority, "P3")
        self.assertEqual(stage, "held_for_research")

    def test_rejection_registry_and_evaluation(self):
        existing_crm = [{
            "id": "1",
            "person": "Matthew Hart",
            "role_organisation": "Head of Security at Canva",
            "profile_url": "https://www.linkedin.com/in/matthewhart",
            "observed_signal": "Oversees security",
            "problem_hypothesis": "Lateral access risk",
            "review_priority": "P1",
            "stage": "researched",
        }]
        rejections = [{
            "person": "Tom McLeod",
            "role_organisation": "Global Advisor in Internal Audit",
            "profile_url": "https://www.linkedin.com/in/tommcleod",
            "rejection_reason": "Out of scope",
            "linear_issue_id": "CIT-197",
            "rejected_date": "2026-09-20",
            "source_query_method": "AI auditing",
            "observed_signal": "Internal audit market failure",
        }]

        engine = IngestionEngine(existing_crm, rejections)

        # 1. Exact URL match -> mechanical merge
        eval_match = engine.evaluate_recon_candidate({
            "name": "Matthew Hart",
            "profile_url": "https://www.linkedin.com/in/matthewhart/",
        })
        self.assertEqual(eval_match["action"], "mechanical_merge")
        self.assertEqual(eval_match["target_crm_id"], "1")

        # 2. Known rejection -> suppressed
        eval_rej = engine.evaluate_recon_candidate({
            "name": "Tom McLeod",
            "profile_url": "https://www.linkedin.com/in/tommcleod/",
        })
        self.assertEqual(eval_rej["action"], "suppressed_rejection")
        self.assertEqual(eval_rej["linear_issue_id"], "CIT-197")

        # 3. Genuinely new candidate -> triage proposal
        eval_new = engine.evaluate_recon_candidate({
            "name": "Dr. Harish Kotadia Ph.D.",
            "role_organisation": "Agentic AI Architect",
            "profile_url": "https://www.linkedin.com/in/hkotadia/",
            "public_signal": "Does it stop the action by itself?",
            "confidence": "high",
        })
        self.assertEqual(eval_new["action"], "triage_proposal")
        self.assertIn("[Triage]", eval_new["linear_issue_payload"]["title"])
        self.assertIn("[INFERRED HYPOTHESIS]", eval_new["linear_issue_payload"]["description"])

    def test_canonical_dataset_validation(self):
        header, rows = load_csv("docs/launch/crm.csv")
        self.assertEqual(detect_file_schema(header), "canonical_crm")
        self.assertEqual(len(rows), 22)
        is_valid, errors = validate_canonical_dataset(rows)
        self.assertTrue(is_valid, f"Validation errors: {errors}")

        rej_header, rej_rows = load_csv("docs/launch/crm-rejections.csv")
        self.assertEqual(detect_file_schema(rej_header), "crm_rejections")
        self.assertEqual(len(rej_rows), 1)
        self.assertEqual(rej_rows[0]["person"], "Tom McLeod")

    def test_linear_invariants_hold_on_canonical_state(self):
        """Validate CIT-198 invariants on current canonical repo files."""
        _, crm_records = load_csv("docs/launch/crm.csv")
        _, rejections = load_csv("docs/launch/crm-rejections.csv")
        linear_state = load_linear_triage_state("docs/launch/linear-triage-state.json")

        valid, errors = validate_invariants(crm_records, linear_state, rejections, grandfathered_count=20)
        self.assertTrue(valid, f"Invariant violations: {errors}")

    def test_unresolved_triage_candidate_absent_from_crm(self):
        """Invariant: Unresolved Triage candidates must be completely absent from CRM."""
        _, crm_records = load_csv("docs/launch/crm.csv")
        crm_names = [r["person"].lower() for r in crm_records]
        crm_urls = [normalize_profile_url(r.get("profile_url", "")) for r in crm_records if r.get("profile_url")]

        # Candidates currently in Triage in Linear
        triage_candidates = [
            ("Ishmael Chibvuri", "https://www.linkedin.com/in/ishmaelchibvuri"),
            ("Inna Carp", "https://www.linkedin.com/in/innacarp"),
            ("Ofir Har-Chen", "https://www.linkedin.com/in/ofirhc"),
            ("Jason Keirstead", "https://www.linkedin.com/in/jasonkeirstead"),
            ("Mandy Andress", "https://www.linkedin.com/in/mandyandress"),
            ("Max Nadeau", "https://www.linkedin.com/in/max-nadeau"),
            ("Dewi Erwan", "https://www.linkedin.com/in/dewierwan"),
        ]

        for name, url in triage_candidates:
            self.assertNotIn(name.lower(), crm_names, f"Triage candidate {name} should NOT be in canonical CRM")
            self.assertNotIn(normalize_profile_url(url), crm_urls, f"Triage candidate URL {url} should NOT be in CRM")

    def test_research_candidate_absent_from_crm(self):
        """Invariant: Research/Backlog candidates must remain outside canonical CRM in staging."""
        _, crm_records = load_csv("docs/launch/crm.csv")
        crm_names = [r["person"].lower() for r in crm_records]
        crm_urls = [normalize_profile_url(r.get("profile_url", "")) for r in crm_records if r.get("profile_url")]

        self.assertNotIn("brian peretti", crm_names, "Brian Peretti (Research/Backlog) must not be in canonical CRM")
        self.assertNotIn("https://www.linkedin.com/in/brianperetti", crm_urls)

    def test_reject_candidate_absent_from_crm_and_present_in_rejections(self):
        """Invariant: Rejected candidates must be absent from CRM and recorded in rejections registry."""
        _, crm_records = load_csv("docs/launch/crm.csv")
        _, rejections = load_csv("docs/launch/crm-rejections.csv")

        crm_names = [r["person"].lower() for r in crm_records]
        rej_names = [r["person"].lower() for r in rejections]

        self.assertNotIn("tom mcleod", crm_names, "Tom McLeod (Rejected) must not be in CRM")
        self.assertIn("tom mcleod", rej_names, "Tom McLeod must be present in rejection registry")

    def test_accept_candidate_present_exactly_once(self):
        """Invariant: Every Accept decision corresponds to exactly one canonical CRM record."""
        _, crm_records = load_csv("docs/launch/crm.csv")

        kotadia_matches = [r for r in crm_records if "harish kotadia" in r["person"].lower()]
        self.assertEqual(len(kotadia_matches), 1, "Dr. Harish Kotadia must appear exactly once in CRM")
        self.assertEqual(kotadia_matches[0]["id"], "21")

        anurag_matches = [r for r in crm_records if "anurag roy barman" in r["person"].lower()]
        self.assertEqual(len(anurag_matches), 1, "Anurag Roy Barman must appear exactly once in CRM")
        self.assertEqual(anurag_matches[0]["id"], "22")

    def test_merge_does_not_create_second_identity(self):
        """Invariant: Merging evidence into an existing contact updates provenance without creating a new record."""
        engine = IngestionEngine()
        seed = {
            "id": "1",
            "person": "Matthew Hart",
            "profile_url": "https://www.linkedin.com/in/matthewhart",
            "role_organisation": "Head of Security at Canva",
            "observed_signal": "Initial signal",
        }
        engine.ingest_record(seed)
        self.assertEqual(len(engine.records), 1)

        # Merge new signal
        incoming = {
            "name": "Matthew Hart",
            "profile_url": "https://www.linkedin.com/in/matthewhart/",
            "observed_signal": "Second signal: agent governance",
            "terminology_notes": "NHI tokens",
        }
        norm_rec = parse_cit184_record(incoming, 0)
        engine.merge_evidence(0, norm_rec)

        self.assertEqual(len(engine.records), 1, "Merge must not increase record count")
        self.assertIn("Initial signal", engine.records[0]["observed_signal"])
        self.assertIn("Second signal: agent governance", engine.records[0]["observed_signal"])

    def test_same_name_different_person_does_not_automerge_or_suppress(self):
        """Invariant: Same-name-only matches must NEVER auto-merge or suppress; route to ambiguous triage."""
        crm = [{
            "id": "1",
            "person": "John Smith",
            "profile_url": "https://www.linkedin.com/in/johnsmith-canva",
            "role_organisation": "Security Engineer at Canva",
        }]
        rejections = [{
            "person": "Alice Johnson",
            "profile_url": "https://www.linkedin.com/in/alice-johnson-auditor",
            "role_organisation": "Auditor at Firm A",
            "rejection_reason": "Out of scope",
            "linear_issue_id": "CIT-999",
        }]
        engine = IngestionEngine(crm, rejections)

        # 1. Different person with same name as CRM contact -> MUST NOT auto-merge!
        eval_diff_crm = engine.evaluate_recon_candidate({
            "name": "John Smith",
            "profile_url": "https://www.linkedin.com/in/johnsmith-different-company",
            "role_organisation": "DevOps at Other Corp",
        })
        self.assertNotEqual(eval_diff_crm["action"], "mechanical_merge", "Different URL must NOT auto-merge")
        self.assertEqual(eval_diff_crm["action"], "triage_proposal")
        self.assertTrue(eval_diff_crm["is_ambiguous"])
        self.assertIn("Ambiguous Name Match", eval_diff_crm["org_matches"])

        # 2. Different person with same name as rejected contact -> MUST NOT auto-suppress!
        eval_diff_rej = engine.evaluate_recon_candidate({
            "name": "Alice Johnson",
            "profile_url": "https://www.linkedin.com/in/alice-johnson-ai-researcher",
            "role_organisation": "AI Safety Lead at Labs",
        })
        self.assertNotEqual(eval_diff_rej["action"], "suppressed_rejection", "Different URL must NOT auto-suppress")
        self.assertEqual(eval_diff_rej["action"], "triage_proposal")
        self.assertTrue(eval_diff_rej["is_ambiguous"])

    def test_rerunning_decisions_is_idempotent(self):
        """Invariant: Applying the same Accept or Reject decisions multiple times produces identical state."""
        crm = [{
            "id": "1",
            "person": "Matthew Hart",
            "profile_url": "https://www.linkedin.com/in/matthewhart",
            "priority_rationale": "Seed",
        }]
        rejections = []
        engine = IngestionEngine(crm, rejections)

        # Ingest new record
        rec = {
            "id": "2",
            "person": "Dr. Harish Kotadia Ph.D.",
            "profile_url": "https://www.linkedin.com/in/hkotadia",
            "role_organisation": "Agentic Architect",
            "priority_rationale": "Accepted via Linear CIT-187",
            "stage": "researched",
        }
        engine.ingest_record(rec)
        self.assertEqual(len(engine.records), 2)

        # Re-ingest same record -> merges evidence, does NOT append duplicate
        engine.ingest_record(rec)
        self.assertEqual(len(engine.records), 2, "Idempotent: record count must not change on duplicate ingest")

    def test_linear_authorization_validation_rejections(self):
        """Invariant: Local decisions contradicting authoritative Linear state are rejected."""
        mock_linear = {
            "CIT-188": {"id": "CIT-188", "status": "Triage", "statusType": "triage"},
            "CIT-196": {"id": "CIT-196", "status": "Backlog", "statusType": "backlog"},
            "CIT-197": {"id": "CIT-197", "status": "Canceled", "statusType": "canceled"},
            "CIT-187": {"id": "CIT-187", "status": "Todo", "statusType": "unstarted"},
        }

        # 1. Attempting to Accept an issue still in Triage -> REJECTED
        valid, reason = validate_decision_against_linear({"linear_issue_id": "CIT-188", "outcome": "accept"}, mock_linear)
        self.assertFalse(valid)
        self.assertIn("still in 'Triage'", reason)

        # 2. Attempting to Accept an issue that is Backlog (Research) -> REJECTED
        valid, reason = validate_decision_against_linear({"linear_issue_id": "CIT-196", "outcome": "accept"}, mock_linear)
        self.assertFalse(valid)
        self.assertIn("does not authorize 'accept'", reason)

        # 3. Attempting to Accept an issue that is Canceled (Rejected) -> REJECTED
        valid, reason = validate_decision_against_linear({"linear_issue_id": "CIT-197", "outcome": "accept"}, mock_linear)
        self.assertFalse(valid)
        self.assertIn("does not authorize 'accept'", reason)

        # 4. Unknown Linear issue ID -> REJECTED
        valid, reason = validate_decision_against_linear({"linear_issue_id": "CIT-9999", "outcome": "accept"}, mock_linear)
        self.assertFalse(valid)
        self.assertIn("not found in authoritative Linear state", reason)

        # 5. Correct outcome matching Linear state -> ACCEPTED
        valid, _ = validate_decision_against_linear({"linear_issue_id": "CIT-187", "outcome": "accept"}, mock_linear)
        self.assertTrue(valid)

        valid, _ = validate_decision_against_linear({"linear_issue_id": "CIT-197", "outcome": "reject"}, mock_linear)
        self.assertTrue(valid)

        valid, _ = validate_decision_against_linear({"linear_issue_id": "CIT-196", "outcome": "research"}, mock_linear)
        self.assertTrue(valid)


if __name__ == "__main__":
    unittest.main()
