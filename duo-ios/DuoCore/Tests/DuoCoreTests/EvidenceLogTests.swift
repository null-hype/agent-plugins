import Foundation
import XCTest
@testable import DuoCore

final class EvidenceLogTests: XCTestCase {
    // No Duo evidence file exists yet; these are committed JSONL files from the Spike on Rails history.
    func testReadsEveryLineOfARecordedDiff() throws {
        let records = try EvidenceLog.records(contentsOf: repoFile("docs/investigations/CIT-265/cit-277/restic-diff-before-to-after.jsonl"))
        XCTAssertEqual(records.count, 3153)
        XCTAssertEqual(records.first?.lineNumber, 1)
        XCTAssertEqual(records.first?.value["message_type"]?.stringValue, "change")
        XCTAssertEqual(records.first?.value["path"]?.stringValue, "/app/Gemfile")
        XCTAssertEqual(records.last?.lineNumber, 3153)
        XCTAssertEqual(records.last?.value["message_type"]?.stringValue, "statistics")
        XCTAssertEqual(records.last?.value["added"]?["files"], .integer(2631))
    }

    func testKeepsNullsAndNestingInDiagnostics() throws {
        let records = try EvidenceLog.records(contentsOf: repoFile("capability-spike/resolver/testdata/reason-log.jsonl"))
        XCTAssertEqual(records.count, 3)
        XCTAssertEqual(records[0].value["diagnostic"], .null)
        XCTAssertEqual(records[0].value["lossAxes"], .array([.string("session-lifecycle-detail"), .string("restoration-provenance")]))
        XCTAssertEqual(records[1].value["diagnostic"]?["code"]?.stringValue, "CAP_NO_GRANT")
        XCTAssertEqual(records[2].value["resolvedFactId"], .null)
    }

    func testBlankLinesCrlfAndMissingFinalNewlineAreTolerated() throws {
        let log = "{\"a\":1}\r\n\n  \n{\"a\":2}"
        let records = try EvidenceLog.records(from: Data(log.utf8))
        XCTAssertEqual(records.map(\.lineNumber), [1, 4])
        XCTAssertEqual(records.map { $0.value["a"] }, [.integer(1), .integer(2)])
    }

    func testIntegersAbove2Pow53StayDistinctAndRoundTrip() throws {
        let log = "{\"timestamp_ns\":9007199254740992}\n{\"timestamp_ns\":9007199254740993}\n{\"id\":-9223372036854775808}\n{\"id\":18446744073709551615}\n"
        let records = try EvidenceLog.records(from: Data(log.utf8))
        XCTAssertEqual(records[0].value["timestamp_ns"], .integer(9007199254740992))
        XCTAssertEqual(records[1].value["timestamp_ns"], .integer(9007199254740993))
        XCTAssertNotEqual(records[0].value, records[1].value)
        XCTAssertEqual(records[2].value["id"], .integer(Int64.min))
        XCTAssertEqual(records[3].value["id"], .unsignedInteger(UInt64.max))
        let encoded = try JSONEncoder().encode(records[1].value)
        XCTAssertEqual(String(decoding: encoded, as: UTF8.self), "{\"timestamp_ns\":9007199254740993}")
    }

    func testFractionsStayDoubles() throws {
        let records = try EvidenceLog.records(from: Data("{\"a\":1.5}\n{\"a\":-0.25}\n".utf8))
        XCTAssertEqual(records[0].value["a"], .number(1.5))
        XCTAssertEqual(records[1].value["a"], .number(-0.25))
    }

    func testIntegersBeyondSixtyFourBitsFailTheRunWithTheirLine() {
        for literal in ["18446744073709551616", "123456789012345678901234567890", "1e30"] {
            let log = "{\"a\":1}\n{\"a\":\(literal)}\n"
            XCTAssertThrowsError(try EvidenceLog.records(from: Data(log.utf8)), literal) { error in
                XCTAssertEqual((error as? EvidenceLogError)?.lineNumber, 2, literal)
            }
        }
    }

    func testEmptyLogHasNoRecords() throws {
        XCTAssertEqual(try EvidenceLog.records(from: Data()), [])
    }

    func testMalformedLineThrowsWithItsNumber() {
        let log = "{\"a\":1}\n\n{\"a\":\n{\"a\":3}\n"
        XCTAssertThrowsError(try EvidenceLog.records(from: Data(log.utf8))) { error in
            XCTAssertEqual((error as? EvidenceLogError)?.lineNumber, 3)
        }
    }
}
