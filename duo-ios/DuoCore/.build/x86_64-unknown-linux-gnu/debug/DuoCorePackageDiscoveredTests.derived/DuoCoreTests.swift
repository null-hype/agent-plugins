import XCTest
@testable import DuoCoreTests

fileprivate extension CardTests {
    @available(*, deprecated, message: "Not actually deprecated. Marked as deprecated to allow inclusion of deprecated tests (which test deprecated functionality) without warnings")
    static nonisolated(unsafe) let __allTests__CardTests = [
        ("testLoadsTheCommittedCards", testLoadsTheCommittedCards),
        ("testMissingRequiredFieldFails", testMissingRequiredFieldFails),
        ("testOnlyTheCardWithACounterexampleIsRefuted", testOnlyTheCardWithACounterexampleIsRefuted)
    ]
}

fileprivate extension EvidenceLogTests {
    @available(*, deprecated, message: "Not actually deprecated. Marked as deprecated to allow inclusion of deprecated tests (which test deprecated functionality) without warnings")
    static nonisolated(unsafe) let __allTests__EvidenceLogTests = [
        ("testBlankLinesCrlfAndMissingFinalNewlineAreTolerated", testBlankLinesCrlfAndMissingFinalNewlineAreTolerated),
        ("testEmptyLogHasNoRecords", testEmptyLogHasNoRecords),
        ("testKeepsNullsAndNestingInDiagnostics", testKeepsNullsAndNestingInDiagnostics),
        ("testMalformedLineThrowsWithItsNumber", testMalformedLineThrowsWithItsNumber),
        ("testReadsEveryLineOfARecordedDiff", testReadsEveryLineOfARecordedDiff)
    ]
}
@available(*, deprecated, message: "Not actually deprecated. Marked as deprecated to allow inclusion of deprecated tests (which test deprecated functionality) without warnings")
func __DuoCoreTests__allTests() -> [XCTestCaseEntry] {
    return [
        testCase(CardTests.__allTests__CardTests),
        testCase(EvidenceLogTests.__allTests__EvidenceLogTests)
    ]
}