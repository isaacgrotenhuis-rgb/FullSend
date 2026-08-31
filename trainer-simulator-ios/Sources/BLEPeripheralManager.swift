import CoreBluetooth
import Foundation

private let ftmsServiceUUID = CBUUID(string: "1826")
private let indoorBikeDataUUID = CBUUID(string: "2AD2")
private let controlPointUUID = CBUUID(string: "2AD9")
private let deviceName = "FullSend Simulator"

private let opcodeRequestControl: UInt8 = 0x00
private let opcodeReset: UInt8 = 0x01
private let opcodeSetTargetResistance: UInt8 = 0x04
private let opcodeSetTargetPower: UInt8 = 0x05
private let opcodeStartOrResume: UInt8 = 0x07
private let opcodeStopOrPause: UInt8 = 0x08

private let opcodeNames: [UInt8: String] = [
    opcodeRequestControl: "Request Control",
    opcodeReset: "Reset",
    opcodeSetTargetResistance: "Set Target Resistance Level",
    opcodeSetTargetPower: "Set Target Power",
    opcodeStartOrResume: "Start or Resume",
    opcodeStopOrPause: "Stop or Pause"
]

private let ergRampStepWattsPerSecond = 15.0
private let notifyIntervalSeconds = 1.0
private let maxLogEntries = 30

final class BLEPeripheralManager: NSObject, ObservableObject, CBPeripheralManagerDelegate {
    @Published var powerWatts: Double = 150
    @Published var cadenceRpm: Double = 85
    @Published var speedKmh: Double = 25
    @Published var resistanceLevel: Double = 0
    @Published var distanceMeters: Double = 0
    @Published var autoFollowErg: Bool = true
    @Published var broadcastDistance: Bool = true
    @Published var ergTargetWatts: Int?
    @Published var rideState: String = "stopped"
    @Published var commandLog: [String] = []
    @Published var isAdvertising: Bool = false

    private var peripheralManager: CBPeripheralManager!
    private var indoorBikeDataCharacteristic: CBMutableCharacteristic!
    private var controlPointCharacteristic: CBMutableCharacteristic!
    private var notifyTimer: Timer?
    private var rampTimer: Timer?
    private var distanceTimer: Timer?

    override init() {
        super.init()
        peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
        startErgRampLoop()
        startDistanceAccumulationLoop()
    }

    // MARK: - CBPeripheralManagerDelegate

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if peripheral.state == .poweredOn {
            setupServices()
        } else {
            isAdvertising = false
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        guard error == nil else {
            logCommand("Failed to add service: \(error!.localizedDescription)")
            return
        }
        peripheral.startAdvertising([
            CBAdvertisementDataLocalNameKey: deviceName,
            CBAdvertisementDataServiceUUIDsKey: [ftmsServiceUUID]
        ])
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        isAdvertising = error == nil
        if let error {
            logCommand("Failed to start advertising: \(error.localizedDescription)")
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        if characteristic.uuid == indoorBikeDataCharacteristic.uuid {
            startIndoorBikeDataNotifyTimer()
            logCommand("Central subscribed to Indoor Bike Data")
        } else if characteristic.uuid == controlPointCharacteristic.uuid {
            logCommand("Central subscribed to Control Point")
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        if characteristic.uuid == indoorBikeDataCharacteristic.uuid {
            notifyTimer?.invalidate()
            notifyTimer = nil
            logCommand("Central unsubscribed from Indoor Bike Data")
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            guard let value = request.value, !value.isEmpty else {
                peripheral.respond(to: request, withResult: .invalidAttributeValueLength)
                continue
            }

            let opCode = value[value.startIndex]
            handleControlPointWrite(opCode: opCode, data: value)
            peripheral.respond(to: request, withResult: .success)

            let response = FTMSEncoding.encodeControlPointResponse(requestOpCode: opCode)
            peripheralManager.updateValue(response, for: controlPointCharacteristic, onSubscribedCentrals: nil)
        }
    }

    // MARK: - Setup

    private func setupServices() {
        let indoorBikeData = CBMutableCharacteristic(
            type: indoorBikeDataUUID,
            properties: [.notify],
            value: nil,
            permissions: []
        )
        let controlPoint = CBMutableCharacteristic(
            type: controlPointUUID,
            properties: [.write, .indicate],
            value: nil,
            permissions: [.writeable]
        )
        indoorBikeDataCharacteristic = indoorBikeData
        controlPointCharacteristic = controlPoint

        let service = CBMutableService(type: ftmsServiceUUID, primary: true)
        service.characteristics = [indoorBikeData, controlPoint]
        peripheralManager.add(service)
    }

    // MARK: - Control Point handling

    private func handleControlPointWrite(opCode: UInt8, data: Data) {
        switch opCode {
        case opcodeRequestControl:
            logCommand("Request Control")
        case opcodeReset:
            ergTargetWatts = nil
            rideState = "stopped"
            distanceMeters = 0
            logCommand("Reset")
        case opcodeSetTargetPower:
            let target = Int(FTMSEncoding.readUInt16LE(data, at: 1))
            ergTargetWatts = target
            logCommand("Set Target Power -> \(target)W")
        case opcodeSetTargetResistance:
            let target = Double(FTMSEncoding.readInt16LE(data, at: 1)) / 10
            resistanceLevel = target
            logCommand("Set Target Resistance -> \(target)")
        case opcodeStartOrResume:
            if rideState == "stopped" {
                distanceMeters = 0
            }
            rideState = "running"
            logCommand("Start or Resume")
        case opcodeStopOrPause:
            let bytes = [UInt8](data)
            let mode = bytes.count > 1 && bytes[1] == 0x01 ? "stop" : "pause"
            rideState = mode == "stop" ? "stopped" : "paused"
            ergTargetWatts = nil
            logCommand(mode == "stop" ? "Stop" : "Pause")
        default:
            let name = opcodeNames[opCode] ?? "Unknown (0x\(String(opCode, radix: 16)))"
            logCommand("Unhandled opcode \(name)")
        }
    }

    // MARK: - Indoor Bike Data notifications

    private func startIndoorBikeDataNotifyTimer() {
        notifyTimer?.invalidate()
        notifyTimer = Timer.scheduledTimer(withTimeInterval: notifyIntervalSeconds, repeats: true) { [weak self] _ in
            self?.sendIndoorBikeDataUpdate()
        }
    }

    private func sendIndoorBikeDataUpdate() {
        let payload = FTMSEncoding.encodeIndoorBikeData(
            speedKmh: speedKmh,
            cadenceRpm: cadenceRpm,
            resistanceLevel: resistanceLevel,
            powerWatts: powerWatts,
            distanceMeters: broadcastDistance ? distanceMeters : nil
        )
        peripheralManager.updateValue(payload, for: indoorBikeDataCharacteristic, onSubscribedCentrals: nil)
    }

    // MARK: - ERG auto-follow ramp

    private func startErgRampLoop() {
        rampTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.stepErgRamp()
        }
    }

    private func stepErgRamp() {
        guard autoFollowErg, let target = ergTargetWatts else { return }
        let targetDouble = Double(target)
        guard powerWatts != targetDouble else { return }
        let delta = targetDouble - powerWatts
        let step = delta > 0 ? min(delta, ergRampStepWattsPerSecond) : max(delta, -ergRampStepWattsPerSecond)
        powerWatts += step
    }

    // MARK: - Distance accumulation

    private func startDistanceAccumulationLoop() {
        distanceTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.stepDistance()
        }
    }

    private func stepDistance() {
        guard rideState == "running" else { return }
        distanceMeters += speedKmh / 3.6
    }

    // MARK: - Log

    private func logCommand(_ text: String) {
        let time = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        commandLog.insert("\(time)  \(text)", at: 0)
        if commandLog.count > maxLogEntries {
            commandLog.removeLast()
        }
    }
}
