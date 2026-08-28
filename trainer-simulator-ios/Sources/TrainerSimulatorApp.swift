import SwiftUI

@main
struct TrainerSimulatorApp: App {
    @StateObject private var manager = BLEPeripheralManager()

    var body: some Scene {
        WindowGroup {
            ContentView(manager: manager)
        }
    }
}
