# Post-v1 Roadmap

Features and improvements planned for future releases after v1.0.0.

## Current SDK Structure (v1)

For reference, the v1 SDK provides:

### High-Level API
- **VoltraManager** - Main entry point for scanning and connection management
  - `scan()`, `connect()`, `connectByName()`, `connectFirst()`
  - Auto-detects platform (web/node), explicit for native
  - Multi-device support via `getAllClients()`
- **VoltraClient** - Per-device control
  - Settings: `setWeight()`, `setChains()`, `setEccentric()`
  - Recording: `startRecording()`, `stopRecording()`
  - Telemetry: `onFrame()` callback

### React Hooks
- `useVoltraScanner(manager)` - Scanning state and controls
- `useVoltraDevice(client)` - Device state (connectionState, currentFrame, settings)

### Telemetry
- **TelemetryFrame** - Raw decoded telemetry (sequence, phase, position, force, velocity)
- `decodeTelemetryFrame()` / `encodeTelemetryFrame()` - For parsing and replay
- `identifyMessageType()` - Message type detection
- Protocol constants: `MessageTypes`, `TelemetryOffsets`, `MovementPhase`

---

## Planned Features

### ReplayBLEAdapter

**Status**: Planned for v1.1+

An adapter that enables replay-based development and testing without physical hardware.

#### Use Cases

- Testing applications without a physical Voltra device
- Demo modes for showcasing functionality
- Unit/integration testing of telemetry pipelines
- Debugging recorded workout sessions

#### Planned API

```typescript
import { ReplayBLEAdapter } from '@voltra/node-sdk/testing';

// Create adapter with recorded telemetry data
const adapter = new ReplayBLEAdapter({
  frames: recordedFrames,  // TelemetryFrame[]
  playbackSpeed: 1.0,      // 1.0 = realtime, 2.0 = 2x speed
});

// Use with VoltraManager
const manager = new VoltraManager({
  adapterFactory: () => adapter,
});

// Or directly with VoltraClient
const client = new VoltraClient({ adapter });
await client.connect({ id: 'replay', name: 'Replay Device' });

// Playback controls
adapter.play();
adapter.pause();
adapter.seek(frameIndex);
adapter.setSpeed(2.0);
```

#### Prerequisites (Now Complete)

- ✅ `encodeTelemetryFrame()` - Converts TelemetryFrame to BLE notification bytes
- ✅ Roundtrip encoding/decoding validated via unit tests (53 tests passing)

#### Remaining Work

1. **ReplayBLEAdapter implementation** - Mock adapter that emits frames on a timer
2. **Frame timing reconstruction** - Preserve original timing from recorded sessions
3. **Connect/disconnect simulation** - Simulate connection lifecycle events

#### Export Path

Will be exported from `@voltra/node-sdk/testing` to indicate it's for development/testing, not production.

---

### Additional Adapters

Future platform-specific adapters as needed:

- **WebSocketBLEAdapter** - For proxying BLE over WebSocket connections (server-to-device relay)
- **MockBLEAdapter** - Simplified mock for unit tests (no timing, just returns predefined responses)

---

### Telemetry Normalization Utilities

Optional helpers for converting raw TelemetryFrame values to normalized formats:

```typescript
import { normalizePosition, normalizeVelocity } from '@voltra/node-sdk/utils';

const normalizedPosition = normalizePosition(frame.position);  // 0-1 range
const velocityMs = normalizeVelocity(frame.velocity);          // m/s
```

These would be convenience utilities only. The SDK intentionally exposes raw values so consumers can normalize for their specific use cases.

---

### Enhanced Multi-Device Features

- **Device grouping** - Group multiple devices for synchronized control
- **Broadcast commands** - Send settings to all connected devices at once
- **Fleet telemetry aggregation** - Combine telemetry streams from multiple devices

---

## Documentation Improvements

Planned for near-term:

- [ ] TypeDoc-generated API reference
- [ ] Platform-specific integration guides (detailed)
- [ ] CONTRIBUTING.md for open-source contributors
- [ ] Migration guide from mobile app's internal domain code

---

## App Migration

The consuming mobile application will:

1. Create a `domain/device/` adapter layer wrapping the SDK
2. Implement `toWorkoutSample()` conversion from TelemetryFrame
3. Provide app-specific React hooks (`useDeviceConnection`, etc.)
4. Remove extracted `domain/bluetooth/` and `domain/voltra/` code

This migration is tracked separately in the mobile app's repository.
