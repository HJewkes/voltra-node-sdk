# ReplayBLEAdapter

**Status**: Planned for v1.1+

An adapter that enables replay-based development and testing without physical hardware.

## Use Cases

- **Testing without hardware** - Run unit/integration tests against recorded telemetry
- **Demo mode** - Showcase app functionality without a physical Voltra device
- **Debugging** - Replay recorded workout sessions to reproduce issues
- **Development** - Build UI/UX without needing the physical device nearby

## Planned API

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

// Connect to the virtual device
const client = await manager.connect({ id: 'replay', name: 'Replay Device' });

// Playback controls
adapter.play();
adapter.pause();
adapter.seek(frameIndex);
adapter.setSpeed(2.0);
```

## Prerequisites (Complete)

The SDK already provides the building blocks for replay:

- `encodeTelemetryFrame()` - Converts TelemetryFrame back to BLE notification bytes
- `decodeTelemetryFrame()` - Parses BLE bytes into TelemetryFrame
- Roundtrip encoding/decoding validated via 53 unit tests

## Remaining Work

1. **ReplayBLEAdapter class** - Mock adapter that:
   - Accepts an array of TelemetryFrame
   - Emits frames via onNotification at configurable speed
   - Simulates connection/disconnection lifecycle

2. **Timing reconstruction** - Preserve original timing from recorded sessions using frame timestamps

3. **Connect/disconnect simulation** - Fire appropriate connection state callbacks

4. **Recording helper** - Optional utility to record TelemetryFrame arrays from live sessions

## Export Path

Will be exported from `@voltra/node-sdk/testing` to indicate it's for development/testing, not production use.

```typescript
// Testing utilities (post-v1)
import { ReplayBLEAdapter, MockBLEAdapter } from '@voltra/node-sdk/testing';
```

## Related Future Features

- **MockBLEAdapter** - Simplified mock for unit tests (no timing, just predefined responses)
- **WebSocketBLEAdapter** - Proxy BLE over WebSocket for server-to-device relay scenarios
