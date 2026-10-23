import Foundation
import XCTest
@testable import DuoCore

// The card content is provisional (see Cards.pkl), so these tests compare the decoded cards with
// the raw file rather than restating what is in it.
final class CardTests: XCTestCase {
    private let cardsURL = repoFile("tutorial-app/src/stories/duo/cards.json")

    private func rawCards() throws -> [[String: Any]] {
        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: cardsURL))
        return try XCTUnwrap(raw as? [[String: Any]])
    }

    func testDecodedCardsKeepEveryFieldOfTheCommittedFile() throws {
        let raw = try rawCards()
        XCTAssertFalse(raw.isEmpty)
        let cards = try Card.loadAll(contentsOf: cardsURL)
        let reencoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(cards))
        XCTAssertTrue((reencoded as? NSArray)?.isEqual(raw as NSArray) ?? false)
    }

    func testACardIsRefutedExactlyWhenTheFileGivesItACounterexample() throws {
        let raw = try rawCards()
        let cards = try Card.loadAll(contentsOf: cardsURL)
        XCTAssertEqual(cards.filter(\.isRefuted).map(\.id), raw.filter { $0["counterexample"] != nil }.compactMap { $0["id"] as? String })
        XCTAssertTrue(cards.contains(where: \.isRefuted))
        XCTAssertTrue(cards.contains(where: { !$0.isRefuted }))
    }

    private func bundle(containing file: URL?) throws -> Bundle {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let file { try FileManager.default.copyItem(at: file, to: dir.appendingPathComponent("cards.json")) }
        return try XCTUnwrap(Bundle(path: dir.path))
    }

    func testBundledCardsAreTheCommittedFileCopiedIntoTheBundle() throws {
        let bundled = try Card.loadBundled(in: bundle(containing: cardsURL))
        XCTAssertEqual(bundled, try Card.loadAll(contentsOf: cardsURL))
    }

    func testABundleWithoutCardsJsonFailsLoudly() throws {
        XCTAssertThrowsError(try Card.loadBundled(in: bundle(containing: nil)))
    }

    func testMissingRequiredFieldFails() {
        let json = #"[{"id":"x","line":1,"options":[]}]"#
        XCTAssertThrowsError(try Card.decodeAll(from: Data(json.utf8)))
    }
}
