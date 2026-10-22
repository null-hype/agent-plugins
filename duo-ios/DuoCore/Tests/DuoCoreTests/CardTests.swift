import Foundation
import XCTest
@testable import DuoCore

final class CardTests: XCTestCase {
    private let cardsURL = repoFile("tutorial-app/src/stories/duo/cards.json")

    func testLoadsTheCommittedCards() throws {
        let cards = try Card.loadAll(contentsOf: cardsURL)
        XCTAssertEqual(cards.map(\.id), ["mat-blocked", "mat-unblocked", "png-blocked", "png-unblocked"])
        XCTAssertTrue(cards.allSatisfy { $0.line == 2 })
        XCTAssertTrue(cards.allSatisfy { $0.options.map(\.id) == ["unless-blocked", "png-only"] })
        XCTAssertEqual(cards[0].options[0].from, "always resized")
        XCTAssertEqual(cards[0].options[0].to, "resized unless the loader is blocked")
    }

    func testOnlyTheCardWithACounterexampleIsRefuted() throws {
        let cards = try Card.loadAll(contentsOf: cardsURL)
        XCTAssertEqual(cards.filter(\.isRefuted).map(\.id), ["mat-blocked"])
        XCTAssertEqual(cards[0].counterexample, "matload: operation is blocked")
        XCTAssertNil(cards[1].counterexample)
    }

    func testMissingRequiredFieldFails() {
        let json = #"[{"id":"x","line":1,"options":[]}]"#
        XCTAssertThrowsError(try Card.decodeAll(from: Data(json.utf8)))
    }
}
