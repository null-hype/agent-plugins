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
        self.assertEqual(len(rows), 49)
        is_valid, errors = validate_canonical_dataset(rows)
        self.assertTrue(is_valid, f"Validation errors: {errors}")

        rej_header, rej_rows = load_csv("docs/launch/crm-rejections.csv")
        self.assertEqual(detect_file_schema(rej_header), "crm_rejections")
        self.assertEqual(len(rej_rows), 1)
        self.assertEqual(rej_rows[0]["person"], "Tom McLeod")


if __name__ == "__main__":
    unittest.main()
