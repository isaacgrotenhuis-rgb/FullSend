import Foundation

/// Mirrors FullSend's parseIndoorBikeData (src/main/ble/ftms.ts) in reverse:
/// encodes speed, cadence, resistance level, and power into the FTMS Indoor
/// Bike Data payload FullSend already knows how to decode.
enum FTMSEncoding {
    static let controlPointResponseOpcode: UInt8 = 0x80
    static let resultSuccess: UInt8 = 0x01

    static func encodeIndoorBikeData(speedKmh: Double, cadenceRpm: Double, resistanceLevel: Double, powerWatts: Double, distanceMeters: Double?) -> Data {
        let instCadencePresent: UInt16 = 0x0004
        let totalDistancePresent: UInt16 = 0x0010
        let resistancePresent: UInt16 = 0x0020
        let instPowerPresent: UInt16 = 0x0040
        var flags = instCadencePresent | resistancePresent | instPowerPresent
        if distanceMeters != nil {
            flags |= totalDistancePresent
        }

        var data = Data()
        appendUInt16LE(flags, to: &data)
        appendUInt16LE(UInt16(clamping: Int(speedKmh * 100)), to: &data)
        appendUInt16LE(UInt16(clamping: Int(cadenceRpm * 2)), to: &data)
        if let distanceMeters {
            appendUInt24LE(UInt32(clamping: Int(distanceMeters)), to: &data)
        }
        appendInt16LE(Int16(clamping: Int(resistanceLevel)), to: &data)
        appendInt16LE(Int16(clamping: Int(powerWatts)), to: &data)
        return data
    }

    static func encodeControlPointResponse(requestOpCode: UInt8, resultCode: UInt8 = resultSuccess) -> Data {
        Data([controlPointResponseOpcode, requestOpCode, resultCode])
    }

    static func readUInt16LE(_ data: Data, at offset: Int) -> UInt16 {
        let bytes = [UInt8](data)
        guard offset + 1 < bytes.count else { return 0 }
        return UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
    }

    static func readInt16LE(_ data: Data, at offset: Int) -> Int16 {
        Int16(bitPattern: readUInt16LE(data, at: offset))
    }

    private static func appendUInt16LE(_ value: UInt16, to data: inout Data) {
        data.append(UInt8(value & 0xff))
        data.append(UInt8((value >> 8) & 0xff))
    }

    private static func appendInt16LE(_ value: Int16, to data: inout Data) {
        appendUInt16LE(UInt16(bitPattern: value), to: &data)
    }

    private static func appendUInt24LE(_ value: UInt32, to data: inout Data) {
        data.append(UInt8(value & 0xff))
        data.append(UInt8((value >> 8) & 0xff))
        data.append(UInt8((value >> 16) & 0xff))
    }
}
