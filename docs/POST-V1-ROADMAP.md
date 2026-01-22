# Post-v1 Roadmap

Features planned for future releases after v1.0.0.

## ReplayBLEAdapter

**Status**: Planned for post-v1

An adapter that enables replay-based development and testing without physical hardware.

### Use Cases

- Testing applications without a physical Voltra device
- Demo modes for showcasing functionality
- Unit/integration testing of telemetry pipelines
- Debugging recorded workout sessions

### Planned API

```typescript
import { ReplayBLEAdapter } from '@voltra/node-sdk/testing';

// Create adapter with recorded telemetry data
const adapter = new ReplayBLEAdapter({
  frames: recordedFrames,  // TelemetryFrame[]
  playbackSpeed: 1.0,      // 1.0 = realtime, 2.0 = 2x speed
});

// Use like any other adapter
const client = new VoltraClient({ adapter });
await client.connect({ id: 'replay', name: 'Replay Device' });

// Playback controls
adapter.play();
adapter.pause();
adapter.seek(frameIndex);
adapter.setSpeed(2.0);
```

### Requirements

1. **encodeTelemetryFrame** - Function to convert TelemetryFrame back to BLE notification bytes
2. **Frame timing reconstruction** - Preserve original timing from recorded sessions
3. **Connect/disconnect simulation** - Simulate connection lifecycle events

### Blockers

- Replay implementation in the mobile app needs fixes before this can be properly tested
- Need to validate roundtrip encoding/decoding preserves all frame data

### Export Path

Will be exported from `@voltra/node-sdk/testing` to clearly indicate it's for development/testing purposes, not production use.

## Additional Adapters

Future platform-specific adapters as needed:

- **WebSocketBLEAdapter** - For proxying BLE over WebSocket connections
- **MockBLEAdapter** - Simplified mock for unit tests

## Telemetry Normalization Utilities

Optional helpers for converting raw TelemetryFrame values to normalized formats:

```typescript
import { normalizePosition, normalizeVelocity } from '@voltra/node-sdk/utils';

const normalizedPosition = normalizePosition(frame.position);  // 0-1
const velocityMs = normalizeVelocity(frame.velocity);          // m/s
```

These would be convenience utilities only - the SDK's design intentionally exposes raw values to let consumers decide how to normalize for their specific use cases.
