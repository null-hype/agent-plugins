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

    func testFractionsWhoseRoundedIntegerPartWouldBeInventedAreRefused() {
        for literal in ["9007199254740993.1", "90071992547409931e-1", "9007199254740992.5", "-9007199254740993.1"] {
            let log = "{\"a\":1}\n{\"a\":\(literal)}\n"
            XCTAssertThrowsError(try EvidenceLog.records(from: Data(log.utf8)), literal) { error in
                XCTAssertEqual((error as? EvidenceLogError)?.lineNumber, 2, literal)
            }
        }
    }

    func testIntegralValuesAreJudgedOnTheirValueNotTheirSpelling() throws {
        let cases: [(String, JSONValue)] = [
            ("18446744073709551615", .unsignedInteger(UInt64.max)),
            ("18446744073709551615e0", .unsignedInteger(UInt64.max)),
            ("1844674407370955161.5e1", .unsignedInteger(UInt64.max)),
            ("9223372036854775808", .unsignedInteger(UInt64(Int64.max) + 1)),
            ("-9223372036854775808", .integer(Int64.min)),
            ("-92233720368547758080e-1", .integer(Int64.min)),
            ("9007199254740993.0", .integer(9007199254740993)),
            ("1.5e3", .integer(1500)),
            ("1E2", .integer(100)),
            ("150e-2", .number(1.5)),
            ("0", .integer(0)),
            ("0.0", .integer(0)),
            ("0e5", .integer(0)),
            ("4503599627370495.5", .number(4503599627370495.5)),
            ("1e-5", .number(1e-5)),
        ]
        for (literal, expected) in cases {
            let records = try EvidenceLog.records(from: Data("{\"a\":\(literal)}".utf8))
            XCTAssertEqual(records.first?.value["a"], expected, literal)
        }
    }

    func testIntegersOutsideSixtyFourBitsInAnySpellingFail() {
        for literal in ["1e400", "1e20", "18446744073709551616e0", "184467440737095516160e-1", "-9223372036854775809", "-9223372036854775809e0", "1e999999999999999999999"] {
            XCTAssertThrowsError(try JSONValue(parsing: Data(literal.utf8)), literal)
        }
    }

    func testValuesOutsideDoubleRangeFailInsteadOfBecomingZero() {
        for literal in ["1e-400", "-1e-400", "0.000000000000000000001e-310", "1e-999999999999999999999"] {
            XCTAssertThrowsError(try JSONValue(parsing: Data(literal.utf8)), literal)
        }
    }

    func testNegativeZeroKeepsItsSign() throws {
        for literal in ["-0", "-0.0", "-0e5"] {
            guard case .number(let value) = try JSONValue(parsing: Data(literal.utf8)) else {
                return XCTFail("\(literal) should stay a number")
            }
            XCTAssertEqual(value, 0, literal)
            XCTAssertEqual(value.sign, .minus, literal)
        }
        XCTAssertEqual(try JSONValue(parsing: Data("0".utf8)), .integer(0))
    }

    func testParserRejectsWhatRfc8259Rejects() {
        for text in ["01", "-", "1.", ".5", "+1", "1e", "1e+", "NaN", "Infinity", "[1,]", "{\"a\":1,}", "{'a':1}", "\"a", "\"\\x\"", "\"\\ud800\"", "\"\\udc00\"", "\"\u{01}\"", "[1] 2", "tru", "", "   "] {
            XCTAssertThrowsError(try JSONValue(parsing: Data(text.utf8)), text)
        }
        XCTAssertThrowsError(try JSONValue(parsing: Data([0x22, 0xFF, 0x22])))
        XCTAssertThrowsError(try JSONValue(parsing: Data(String(repeating: "[", count: 600).utf8)))
    }

    func testParserDecodesStringsAndStructure() throws {
        let value = try JSONValue(parsing: Data(" {\"k\\u00e9\":[true,false,null,\"a\\n\\\"\\ud83d\\ude00\\/é\"],\"\":{}} ".utf8))
        XCTAssertEqual(value, .object([
            "ké": .array([.bool(true), .bool(false), .null, .string("a\n\"😀/é")]),
            "": .object([:]),
        ]))
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
