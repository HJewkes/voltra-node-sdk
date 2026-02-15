# Bluetooth Protocol Overview

How the SDK communicates with Voltra devices over Bluetooth Low Energy (BLE).

## Communication Flow

```
App                     SDK                      Device
 │                       │                         │
 │  scan()               │                         │
 │──────────────────────>│  BLE scan               │
 │                       │────────────────────────>│
 │  connect(device)      │                         │
 │──────────────────────>│  BLE connect            │
 │                       │────────────────────────>│
 │                       │  Auth (write device ID) │
 │                       │────────────────────────>│
 │                       │  Init sequence (7 cmds) │
 │                       │────────────────────────>│
 │                       │  ◄── Connected ──►      │
 │                       │                         │
 │  setWeight(50)        │  Write 19-byte command  │
 │──────────────────────>│────────────────────────>│
 │                       │  ◄── Settings update ── │
 │                       │                         │
 │  startRecording()     │  PREPARE → SETUP → GO   │
 │──────────────────────>│────────────────────────>│
 │                       │  ◄── Telemetry ~11 Hz ──│
 │  onFrame(frame)       │                         │
 │◄──────────────────────│                         │
 │                       │  ◄── Rep/Set summaries ─│
 │  onRepBoundary()      │                         │
 │◄──────────────────────│                         │
```

## BLE Service Structure

All communication happens through a single BLE service with two characteristics:

- **Notify characteristic** — device sends telemetry, settings updates, status
- **Write characteristic** — app sends commands (auth, init, settings, workout control)

UUIDs and device name prefix are defined in `src/voltra/protocol/constants/ble-config.ts`.

## Message Types

### From Device (Notifications)

| Type | Description | Rate |
|------|-------------|------|
| **Telemetry stream** | Position, velocity, force, phase | ~11 Hz during recording |
| **Rep summary** | Signals end of a rep | Per rep |
| **Set summary** | Signals end of a set | Per set |
| **Mode confirmation** | Confirms training mode change | On mode change |
| **Settings update** | Reports all current device settings | On setting change / init |
| **Device status** | Battery level | Periodic |

Each notification starts with a header that identifies its type. The decoder in
`src/voltra/protocol/telemetry-decoder.ts` handles all parsing.

### To Device (Commands)

| Type | Description |
|------|-------------|
| **Auth** | 41-byte device identity sent immediately after BLE connect |
| **Init** | Sequence of initialization commands |
| **Settings** | 19-byte commands for weight, chains, eccentric, inverse chains, mode |
| **Workout** | PREPARE, SETUP, GO, STOP commands for motor control |

Command bytes are pre-computed from `protocol-data.generated.ts` and accessed through
lookup functions in `src/voltra/protocol/commands.ts`.

## Type Definitions

Full typed definitions for the protocol data structure live in
`src/voltra/protocol/types.ts`. This includes:

- `ProtocolData` — root structure
- `BleConfig` — service/characteristic UUIDs
- `CommandConfig` — all command definitions
- `TelemetryConfig` — message types, byte offsets, notification configs
- `DeviceSettings` — parsed settings from notifications

## Key Constants

Protocol constants are organized in `src/voltra/protocol/constants/`:

| File | Contents |
|------|----------|
| `ble-config.ts` | Service UUID, characteristic UUIDs, device prefix |
| `timing.ts` | Command delays, auth timeout |
| `connection-commands.ts` | Auth, init, and workout command bytes |
| `message-types.ts` | Notification headers, telemetry offsets, param IDs |
| `enums.ts` | `MovementPhase`, `TrainingMode`, `ParameterId` enums |
