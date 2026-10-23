import Foundation

/// One rewrite a question card offers: applying it changes `from` to `to` in the claim.
public struct CardOption: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let from: String
    public let to: String
}

/// A question card, decoded from the JSON that `tutorial-app/src/stories/duo/Cards.pkl`
/// evaluates to (CIT-465). That JSON is the only source of what a card contains.
public struct Card: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    /// The line of the claim sentence this card is about.
    public let line: Int
    public let title: String
    /// Present only when a recorded run refutes the claim.
    public let counterexample: String?
    public let options: [CardOption]

    public var isRefuted: Bool { counterexample != nil }
}

extension Card {
    public static func decodeAll(from data: Data) throws -> [Card] {
        try JSONDecoder().decode([Card].self, from: data)
    }

    public static func loadAll(contentsOf url: URL) throws -> [Card] {
        try decodeAll(from: Data(contentsOf: url))
    }

    /// The cards the build copied into the app bundle as `cards.json` (the Duo target's resources).
    public static func loadBundled(in bundle: Bundle = .main) throws -> [Card] {
        guard let url = bundle.url(forResource: "cards", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "cards.json is not in the bundle \(bundle.bundlePath)"])
        }
        return try loadAll(contentsOf: url)
    }
}
