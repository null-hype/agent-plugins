import Foundation

public struct EvidenceRecord: Sendable, Equatable {
    /// 1-based line in the file, so a reader can point at the source line.
    public let lineNumber: Int
    public let value: JSONValue
}

public struct EvidenceLogError: Error, Sendable, Equatable, CustomStringConvertible {
    public let lineNumber: Int
    public let reason: String

    public var description: String { "evidence line \(lineNumber) is not valid JSON: \(reason)" }
}

public enum EvidenceLog {
    /// Reads JSON Lines: one JSON value per line, blank lines and a missing final newline allowed.
    /// A line that does not parse throws with its number; it is never skipped, because the
    /// evidence the app shows would then silently be a different log from the one recorded.
    public static func records(from data: Data) throws -> [EvidenceRecord] {
        var records: [EvidenceRecord] = []
        var lineNumber = 0
        for rawLine in data.split(separator: UInt8(ascii: "\n"), omittingEmptySubsequences: false) {
            lineNumber += 1
            let line = rawLine.last == UInt8(ascii: "\r") ? rawLine.dropLast() : rawLine[...]
            if line.allSatisfy({ $0 == UInt8(ascii: " ") || $0 == UInt8(ascii: "\t") }) { continue }
            do {
                records.append(EvidenceRecord(lineNumber: lineNumber, value: try JSONValue(parsing: Data(line))))
            } catch {
                throw EvidenceLogError(lineNumber: lineNumber, reason: String(describing: error))
            }
        }
        return records
    }

    public static func records(contentsOf url: URL) throws -> [EvidenceRecord] {
        try records(from: Data(contentsOf: url))
    }
}
