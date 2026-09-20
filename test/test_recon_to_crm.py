#!/usr/bin/env python3
"""
test/test_recon_to_crm.py - Unit tests for repeatable recon-to-CRM pipeline (CIT-185)
"""

import os
import tempfile
import unittest
from scripts.recon_to_crm import (
    CANONICAL_FIELDS,
    IngestionEngine,
    detect_file_schema,
    normalize_person_name,
    normalize_profile_url,
    extract_organization,
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

        # Ingest secondary recon signal for same person
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

        # Record count must remain 1 (no duplicate row)
        self.assertEqual(len(engine.records), 1)
        self.assertEqual(engine.exact_duplicates_merged, 1)

        merged = engine.records[0]
        # Evidence must be preserved and appended
        self.assertIn("Talk on IAM architecture.", merged["observed_signal"])
        self.assertIn("Published post on Planner-Authoriser Collision.", merged["observed_signal"])
        self.assertEqual(merged["review_priority"], "P1")
        self.assertIn("Elevated via:", merged["priority_rationale"])
        self.assertIn("Planner-authoriser collision", merged["terminology_used"])

    def test_canonical_dataset_validation(self):
        header, rows = load_csv("docs/launch/crm.csv")
        self.assertEqual(detect_file_schema(header), "canonical_crm")
        self.assertEqual(len(rows), 50)
        is_valid, errors = validate_canonical_dataset(rows)
        self.assertTrue(is_valid, f"Validation errors: {errors}")

    def test_review_queue_ranking(self):
        header, rows = load_csv("docs/launch/crm.csv")
        queue = generate_review_queue(rows, limit=5)
        self.assertEqual(len(queue), 5)
        # All top 5 must be P1
        for candidate in queue:
            self.assertEqual(candidate["review_priority"], "P1")
            self.assertEqual(candidate["stage"], "review_queue")


if __name__ == "__main__":
    unittest.main()
