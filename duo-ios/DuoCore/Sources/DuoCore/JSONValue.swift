public enum JSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    /// An integer literal that fits Int64, kept exact.
    case integer(Int64)
    /// An integer literal above Int64.max that fits UInt64, kept exact.
    case unsignedInteger(UInt64)
    /// Any other number; integral values are only accepted here up to 2^53.
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    private static let maxExactDouble = 9007199254740992.0

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int64.self) {
            self = .integer(value)
        } else if let value = try? container.decode(UInt64.self) {
            self = .unsignedInteger(value)
        } else if let value = try? container.decode(Double.self) {
            // Beyond 2^53 a Double cannot tell neighbouring integers apart, so an integral value
            // this large that did not fit Int64/UInt64 is refused rather than silently rounded.
            guard abs(value) <= Self.maxExactDouble || value != value.rounded() else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "number \(value) is integral but beyond 2^53 and does not fit a 64-bit integer, so it cannot be kept exact"
                )
            }
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .integer(let value): try container.encode(value)
        case .unsignedInteger(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    public subscript(key: String) -> JSONValue? {
        guard case .object(let object) = self else { return nil }
        return object[key]
    }

    public var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }
}
