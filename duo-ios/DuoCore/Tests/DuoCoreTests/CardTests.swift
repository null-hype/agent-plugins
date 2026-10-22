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

    func testMissingRequiredFieldFails() {
        let json = #"[{"id":"x","line":1,"options":[]}]"#
        XCTAssertThrowsError(try Card.decodeAll(from: Data(json.utf8)))
    }
}
