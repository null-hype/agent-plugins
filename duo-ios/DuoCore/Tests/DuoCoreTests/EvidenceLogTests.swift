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
        XCTAssertEqual(records.last?.value["added"]?["files"], .number(2631))
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
        XCTAssertEqual(records.map { $0.value["a"] }, [.number(1), .number(2)])
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
