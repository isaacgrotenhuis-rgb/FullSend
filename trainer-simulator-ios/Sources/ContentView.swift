import SwiftUI

struct ContentView: View {
    @ObservedObject var manager: BLEPeripheralManager
    @State private var useImperialUnits = false

    private static let kmhToMph = 0.621371
    private static let metersToMiles = 0.000621371

    private var speedBinding: Binding<Double> {
        Binding(
            get: { useImperialUnits ? manager.speedKmh * Self.kmhToMph : manager.speedKmh },
            set: { newValue in
                manager.speedKmh = useImperialUnits ? newValue / Self.kmhToMph : newValue
            }
        )
    }

    private var speedRange: ClosedRange<Double> {
        useImperialUnits ? 0...45 : 0...70
    }

    private var formattedSpeed: String {
        useImperialUnits
            ? String(format: "%.1f mph", manager.speedKmh * Self.kmhToMph)
            : String(format: "%.1f km/h", manager.speedKmh)
    }

    private var formattedDistance: String {
        useImperialUnits
            ? String(format: "%.2f mi", manager.distanceMeters * Self.metersToMiles)
            : String(format: "%.0f m", manager.distanceMeters)
    }

    var body: some View {
        NavigationView {
            Form {
                Section("Status") {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(manager.isAdvertising ? Color.green : Color.red)
                            .frame(width: 10, height: 10)
                        Text(manager.isAdvertising ? "Advertising as \"FullSend Simulator\"" : "Not advertising")
                            .foregroundColor(.secondary)
                    }
                    LabeledContent("Ride state", value: manager.rideState)
                    LabeledContent("ERG target", value: manager.ergTargetWatts.map { "\($0) W" } ?? "none")
                    LabeledContent("Distance", value: formattedDistance)
                }

                Section("Display") {
                    Toggle("Imperial units (mph / mi)", isOn: $useImperialUnits)
                }

                Section("Power — \(Int(manager.powerWatts)) W") {
                    Slider(value: $manager.powerWatts, in: 0...500, step: 1)
                }

                Section("Cadence — \(Int(manager.cadenceRpm)) rpm") {
                    Slider(value: $manager.cadenceRpm, in: 0...140, step: 1)
                }

                Section("Speed — \(formattedSpeed)") {
                    Slider(value: speedBinding, in: speedRange, step: 0.5)
                }

                Section("Resistance — \(Int(manager.resistanceLevel))") {
                    Slider(value: $manager.resistanceLevel, in: 0...100, step: 1)
                }

                Section {
                    Toggle("Auto-follow ERG target", isOn: $manager.autoFollowErg)
                    Toggle("Broadcast distance", isOn: $manager.broadcastDistance)
                }

                Section("Command Log") {
                    if manager.commandLog.isEmpty {
                        Text("Waiting for commands from FullSend…")
                            .foregroundColor(.secondary)
                            .font(.footnote)
                    } else {
                        ForEach(manager.commandLog, id: \.self) { entry in
                            Text(entry)
                                .font(.system(.footnote, design: .monospaced))
                        }
                    }
                }
            }
            .navigationTitle("Trainer Simulator")
        }
        .navigationViewStyle(.stack)
    }
}
