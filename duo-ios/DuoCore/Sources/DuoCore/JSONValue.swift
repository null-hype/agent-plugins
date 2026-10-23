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
