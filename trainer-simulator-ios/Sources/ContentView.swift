import SwiftUI

struct ContentView: View {
    @ObservedObject var manager: BLEPeripheralManager

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
                }

                Section("Power — \(Int(manager.powerWatts)) W") {
                    Slider(value: $manager.powerWatts, in: 0...500, step: 1)
                }

                Section("Cadence — \(Int(manager.cadenceRpm)) rpm") {
                    Slider(value: $manager.cadenceRpm, in: 0...140, step: 1)
                }

                Section("Speed — \(String(format: "%.1f", manager.speedKmh)) km/h") {
                    Slider(value: $manager.speedKmh, in: 0...70, step: 0.5)
                }

                Section("Resistance — \(Int(manager.resistanceLevel))") {
                    Slider(value: $manager.resistanceLevel, in: 0...100, step: 1)
                }

                Section {
                    Toggle("Auto-follow ERG target", isOn: $manager.autoFollowErg)
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
