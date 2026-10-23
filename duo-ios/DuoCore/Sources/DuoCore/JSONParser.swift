import Foundation

public struct JSONParseError: Error, Sendable, Equatable, CustomStringConvertible {
    /// 0-based byte offset into the parsed input.
    public let offset: Int
    public let reason: String

    public var description: String { "\(reason) at byte \(offset)" }
}

extension JSONValue {
    /// Parses one JSON value (RFC 8259) from `data`, classifying every number from its source token.
    ///
    /// Foundation's decoder hides the token, so a rounded Int64/UInt64 conversion would decide what
    /// counts as exact. Here the token is reduced with exact decimal arithmetic instead, and a number
    /// that cannot be kept exact throws rather than being rounded into a different value.
    public init(parsing data: Data) throws {
        var parser = JSONParser(bytes: [UInt8](data))
        self = try parser.parseDocument()
    }
}

private struct JSONParser {
    private static let maxDepth = 512
    private static let twoPow53: UInt64 = 1 << 53
    private static let digitCap = 1_000_000_000

    let bytes: [UInt8]
    var index = 0

    init(bytes: [UInt8]) {
        self.bytes = bytes
    }

    mutating func parseDocument() throws -> JSONValue {
        skipWhitespace()
        let value = try parseValue(depth: 0)
        skipWhitespace()
        guard index == bytes.count else { throw fail("unexpected trailing content") }
        return value
    }

    private func fail(_ reason: String, at offset: Int? = nil) -> JSONParseError {
        JSONParseError(offset: offset ?? index, reason: reason)
    }

    private var current: UInt8? { index < bytes.count ? bytes[index] : nil }

    private mutating func skipWhitespace() {
        while let byte = current, byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D {
            index += 1
        }
    }

    private mutating func parseValue(depth: Int) throws -> JSONValue {
        guard depth <= Self.maxDepth else { throw fail("nesting deeper than \(Self.maxDepth) levels") }
        guard let byte = current else { throw fail("unexpected end of input") }
        switch byte {
        case UInt8(ascii: "{"): return try parseObject(depth: depth)
        case UInt8(ascii: "["): return try parseArray(depth: depth)
        case UInt8(ascii: "\""): return .string(try parseString())
        case UInt8(ascii: "t"): try expect("true"); return .bool(true)
        case UInt8(ascii: "f"): try expect("false"); return .bool(false)
        case UInt8(ascii: "n"): try expect("null"); return .null
        case UInt8(ascii: "-"), UInt8(ascii: "0")...UInt8(ascii: "9"): return try parseNumber()
        default: throw fail("unexpected byte 0x\(String(byte, radix: 16))")
        }
    }

    private mutating func expect(_ literal: StaticString) throws {
        let start = index
        for expected in literal.withUTF8Buffer({ Array($0) }) {
            guard current == expected else { throw fail("invalid literal", at: start) }
            index += 1
        }
    }

    private mutating func parseArray(depth: Int) throws -> JSONValue {
        index += 1
        var items: [JSONValue] = []
        skipWhitespace()
        if current == UInt8(ascii: "]") {
            index += 1
            return .array(items)
        }
        while true {
            skipWhitespace()
            items.append(try parseValue(depth: depth + 1))
            skipWhitespace()
            switch current {
            case UInt8(ascii: ","): index += 1
            case UInt8(ascii: "]"): index += 1; return .array(items)
            default: throw fail("expected ',' or ']'")
            }
        }
    }

    private mutating func parseObject(depth: Int) throws -> JSONValue {
        index += 1
        var members: [String: JSONValue] = [:]
        skipWhitespace()
        if current == UInt8(ascii: "}") {
            index += 1
            return .object(members)
        }
        while true {
            skipWhitespace()
            guard current == UInt8(ascii: "\"") else { throw fail("expected a string key") }
            let key = try parseString()
            skipWhitespace()
            guard current == UInt8(ascii: ":") else { throw fail("expected ':'") }
            index += 1
            skipWhitespace()
            members[key] = try parseValue(depth: depth + 1)
            skipWhitespace()
            switch current {
            case UInt8(ascii: ","): index += 1
            case UInt8(ascii: "}"): index += 1; return .object(members)
            default: throw fail("expected ',' or '}'")
            }
        }
    }

    private mutating func parseString() throws -> String {
        let start = index
        index += 1
        var utf8: [UInt8] = []
        while true {
            guard let byte = current else { throw fail("unterminated string", at: start) }
            index += 1
            switch byte {
            case UInt8(ascii: "\""):
                guard let string = String(validating: utf8, as: UTF8.self) else {
                    throw fail("string is not valid UTF-8", at: start)
                }
                return string
            case UInt8(ascii: "\\"):
                try parseEscape(into: &utf8)
            case 0x00..<0x20:
                throw fail("unescaped control character in string", at: index - 1)
            default:
                utf8.append(byte)
            }
        }
    }

    private mutating func parseEscape(into utf8: inout [UInt8]) throws {
        guard let byte = current else { throw fail("unterminated escape") }
        index += 1
        switch byte {
        case UInt8(ascii: "\""): utf8.append(0x22)
        case UInt8(ascii: "\\"): utf8.append(0x5C)
        case UInt8(ascii: "/"): utf8.append(0x2F)
        case UInt8(ascii: "b"): utf8.append(0x08)
        case UInt8(ascii: "f"): utf8.append(0x0C)
        case UInt8(ascii: "n"): utf8.append(0x0A)
        case UInt8(ascii: "r"): utf8.append(0x0D)
        case UInt8(ascii: "t"): utf8.append(0x09)
        case UInt8(ascii: "u"):
            let unit = try parseHex4()
            var scalarValue = UInt32(unit)
            if (0xD800..<0xDC00).contains(unit) {
                guard current == UInt8(ascii: "\\"), index + 1 < bytes.count, bytes[index + 1] == UInt8(ascii: "u") else {
                    throw fail("unpaired high surrogate")
                }
                index += 2
                let low = try parseHex4()
                guard (0xDC00..<0xE000).contains(low) else { throw fail("high surrogate not followed by a low surrogate") }
                scalarValue = 0x10000 + ((UInt32(unit) - 0xD800) << 10) + (UInt32(low) - 0xDC00)
            } else if (0xDC00..<0xE000).contains(unit) {
                throw fail("unpaired low surrogate")
            }
            guard let scalar = Unicode.Scalar(scalarValue) else { throw fail("invalid unicode escape") }
            utf8.append(contentsOf: String(Character(scalar)).utf8)
        default:
            throw fail("invalid escape", at: index - 1)
        }
    }

    private mutating func parseHex4() throws -> UInt16 {
        var value: UInt16 = 0
        for _ in 0..<4 {
            guard let byte = current, let digit = Self.hexValue(byte) else { throw fail("invalid \\u escape") }
            value = value << 4 | UInt16(digit)
            index += 1
        }
        return value
    }

    private static func hexValue(_ byte: UInt8) -> UInt8? {
        switch byte {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): return byte - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): return byte - UInt8(ascii: "a") + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): return byte - UInt8(ascii: "A") + 10
        default: return nil
        }
    }

    private func isDigit(_ byte: UInt8?) -> Bool {
        guard let byte else { return false }
        return byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "9")
    }

    private mutating func scanDigits() -> ArraySlice<UInt8> {
        let start = index
        while isDigit(current) { index += 1 }
        return bytes[start..<index]
    }

    /// Reduces the token to `±digits × 10^scale` with no leading or trailing zeros in `digits`, then
    /// decides from that alone: an integral value is `.integer`/`.unsignedInteger` or throws; a
    /// non-integral value is a `Double` only while its integer part is below 2^53.
    private mutating func parseNumber() throws -> JSONValue {
        let start = index
        let negative = current == UInt8(ascii: "-")
        if negative { index += 1 }

        guard isDigit(current) else { throw fail("expected a digit", at: start) }
        let integerDigits = scanDigits()
        if integerDigits.count > 1 && integerDigits.first == UInt8(ascii: "0") {
            throw fail("leading zero in number", at: start)
        }

        var fractionDigits: ArraySlice<UInt8> = []
        if current == UInt8(ascii: ".") {
            index += 1
            guard isDigit(current) else { throw fail("expected a digit after '.'", at: start) }
            fractionDigits = scanDigits()
        }

        var exponent = 0
        if current == UInt8(ascii: "e") || current == UInt8(ascii: "E") {
            index += 1
            var exponentNegative = false
            if current == UInt8(ascii: "+") || current == UInt8(ascii: "-") {
                exponentNegative = current == UInt8(ascii: "-")
                index += 1
            }
            guard isDigit(current) else { throw fail("expected a digit in exponent", at: start) }
            for digit in scanDigits() where exponent < Self.digitCap {
                exponent = exponent * 10 + Int(digit - UInt8(ascii: "0"))
            }
            if exponentNegative { exponent = -exponent }
        }

        let token = String(decoding: bytes[start..<index], as: UTF8.self)
        var digits = Array((integerDigits + fractionDigits).drop { $0 == UInt8(ascii: "0") })
        var scale = exponent - fractionDigits.count
        while digits.last == UInt8(ascii: "0") {
            digits.removeLast()
            scale += 1
        }

        if digits.isEmpty {
            return negative ? .number(-0.0) : .integer(0)
        }

        if scale >= 0 {
            guard digits.count + scale <= 20 else {
                throw fail("number \(token) is integral but does not fit a 64-bit integer, so it cannot be kept exact", at: start)
            }
            var magnitude: UInt64 = 0
            for digit in digits + Array(repeating: UInt8(ascii: "0"), count: scale) {
                let (times, overflowMultiply) = magnitude.multipliedReportingOverflow(by: 10)
                let (sum, overflowAdd) = times.addingReportingOverflow(UInt64(digit - UInt8(ascii: "0")))
                guard !overflowMultiply, !overflowAdd else {
                    throw fail("number \(token) is integral but does not fit a 64-bit integer, so it cannot be kept exact", at: start)
                }
                magnitude = sum
            }
            if negative {
                guard magnitude <= UInt64(Int64.max) + 1 else {
                    throw fail("number \(token) is below Int64.min, so it cannot be kept exact", at: start)
                }
                return .integer(Int64(truncatingIfNeeded: 0 &- magnitude))
            }
            return magnitude <= UInt64(Int64.max) ? .integer(Int64(magnitude)) : .unsignedInteger(magnitude)
        }

        let fractionLength = -scale
        let integerPartCount = max(digits.count - fractionLength, 0)
        guard integerPartCount <= 16 else {
            throw fail("number \(token) has an integer part beyond 2^53, so a Double would change it", at: start)
        }
        var integerPart: UInt64 = 0
        for digit in digits.prefix(integerPartCount) {
            integerPart = integerPart * 10 + UInt64(digit - UInt8(ascii: "0"))
        }
        guard integerPart < Self.twoPow53 else {
            throw fail("number \(token) has an integer part beyond 2^53, so a Double would change it", at: start)
        }
        guard let value = Double(token), value.isFinite, value != 0 else {
            throw fail("number \(token) is outside the range of a Double", at: start)
        }
        return .number(value)
    }
}
