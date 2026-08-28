# Trainer Simulator (iOS)

A SwiftUI iPhone app that pretends to be a smart trainer over Bluetooth LE, so [FullSend](../README.md) can be developed and tested without owning real hardware.

It runs on your iPhone rather than on the Mac running FullSend on purpose: macOS can't reliably discover a BLE peripheral that the same Mac is advertising to itself, so a separate Bluetooth radio (your phone) is needed.

This only fakes the trainer (FTMS). **Heart rate is not simulated** — connect your real HR strap to FullSend separately, exactly as you would during a normal ride.

## Setup

Requires Xcode (already installed) with the full toolchain selected:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

The project is generated with [XcodeGen](https://github.com/yonaskolb/XcodeGen) from `project.yml` — the `.xcodeproj` itself isn't hand-edited. If you ever change `project.yml` or add/remove Swift files, regenerate it:

```sh
brew install xcodegen   # one-time
cd trainer-simulator-ios
xcodegen generate
```

## Run on your iPhone

1. Open `TrainerSimulator.xcodeproj` in Xcode.
2. Select the `TrainerSimulator` target → **Signing & Capabilities** → set your **Team** to your personal Apple ID (free — no paid developer account needed).
3. Plug in your iPhone (or use wireless debugging) and select it as the run destination.
4. Hit **Run** (⌘R).
5. On the iPhone, if this is the first app from you it's run: **Settings → General → VPN & Device Management** → trust your developer certificate.

Without a paid Apple Developer account, the app's signature expires after about 7 days — just re-run from Xcode to refresh it.

## Using it with FullSend

1. Run the app on your iPhone (previous section). It starts advertising immediately as **"FullSend Simulator"** and shows a green "Advertising" indicator.
2. Start FullSend (`npm run dev` in the repo root) on your Mac and scan/connect to a trainer — "FullSend Simulator" should appear, since it's a separate Bluetooth radio from your Mac's.
3. Move the sliders on the phone (power, cadence, speed, resistance) and watch FullSend's live telemetry update.
4. If you have a real heart rate strap, connect it in FullSend separately — it works alongside the simulated trainer just like a real ride with two BLE devices.
5. Start a structured/ERG workout in FullSend. The app's command log shows each command as it arrives (Set Target Power, Start/Stop, etc), and with "Auto-follow ERG target" on, simulated power ramps toward each target automatically, like a real trainer holding ERG. Turn it off to drive power manually instead.

## Notes

- Uses `CBPeripheralManager` (Apple's CoreBluetooth peripheral/GATT-server API) directly — no third-party BLE library needed on iOS.
- Encodes/decodes the exact same FTMS Indoor Bike Data and Control Point byte layouts FullSend already parses in `src/main/ble/ftms.ts`.
