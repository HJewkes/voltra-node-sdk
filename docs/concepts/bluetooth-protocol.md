# Voltra Bluetooth Protocol

This document describes the BLE protocol used by Beyond Power Voltra resistance training devices, as reverse-engineered from the Beyond+ app.

## Overview

Voltra devices communicate via Bluetooth Low Energy (BLE) using a proprietary protocol. The device exposes a single GATT service with two characteristics:

- **Write characteristic** - For sending commands (authentication, settings, workout control)
- **Notify characteristic** - For receiving telemetry data (~11 Hz during workouts)

## BLE Service

| Component | UUID |
|-----------|------|
| Service | `E4DADA34-0867-8783-9F70-2CA29216C7E4` |
| Notify Characteristic | `55CA1E52-7354-25DE-6AFC-B7DF1E8816AC` |
| Write Characteristic | `A010891D-F50F-44F0-901F-9A2421A9E050` |

Devices advertise with the name prefix `VTR-` followed by their serial number (e.g., `VTR-123456`).

## Connection Flow

### 1. Discovery
Scan for devices with the `VTR-` name prefix or the service UUID.

### 2. Authentication
Immediately after establishing GATT connection, write a 41-byte device identifier. This must happen within a tight time window (~1-2 seconds) or the device will reject the connection.

The device ID contains:
- Header bytes
- Device type identifier ("iPhone" or "iPad")  
- Proprietary checksum

### 3. Initialization
Send a minimal initialization sequence (2 commands). The original Beyond+ app sends 22+ commands, but only 2 are actually required.

### 4. Ready
Device is now ready to accept settings and workout commands.

## Command Protocol

Commands are variable-length byte arrays with a common structure:

```
[0x55] [length] [command_id] ... [checksum]
```

### Settings Commands

**Weight** (5-200 lbs in increments of 5):
- Uses a lookup table mapping weight values to byte sequences
- Changes take effect immediately

**Chains** (0-100 lbs):
- Dual-command sequence (two writes with 500ms delay)
- Provides variable resistance curve

**Eccentric** (-195% to +195%):
- Dual-command sequence
- Adjusts the lowering (eccentric) phase difficulty

### Workout Commands

| Command | Description |
|---------|-------------|
| PREPARE | Prepare device for workout |
| SETUP | Configure workout mode |
| GO | Start resistance/recording |
| STOP | Stop resistance/recording |

Sequence: `setWeight` → `PREPARE` → `SETUP` → `GO`

## Telemetry Protocol

During workouts, the device sends 30-byte notification packets at approximately 11 Hz.

### Message Types

The first 4 bytes identify the message type:

| Type | Header (hex) | Description |
|------|--------------|-------------|
| Telemetry Stream | `55 3a 04 70` | Real-time position/force/velocity |
| Rep Summary | `55 4a 04 c6` | Signals rep completion |
| Set Summary | `55 4f 04 39` | Signals set completion |
| Status Update | `55 34 04 ac` | Device status changes |

### Telemetry Frame Structure

For telemetry stream messages (30 bytes):

| Offset | Size | Type | Field |
|--------|------|------|-------|
| 0-3 | 4 | bytes | Message type header |
| 6-7 | 2 | uint16 LE | Sequence number |
| 13 | 1 | uint8 | Movement phase |
| 24-25 | 2 | uint16 LE | Position (raw) |
| 26-27 | 2 | int16 LE | Force (signed) |
| 28-29 | 2 | uint16 LE | Velocity (raw) |

### Movement Phases

| Value | Phase | Description |
|-------|-------|-------------|
| 0 | IDLE | No movement, resting |
| 1 | CONCENTRIC | Pulling (muscle shortening) |
| 2 | HOLD | Top of rep / transition |
| 3 | ECCENTRIC | Lowering (muscle lengthening) |

### Raw Values

The SDK exposes raw sensor values without normalization:

- **Position**: 0-600 range (full stroke)
- **Force**: Signed value, negative during eccentric phase
- **Velocity**: Raw encoder value

Consumers can normalize these values for their specific needs (e.g., position to 0-1 range, velocity to m/s).

## Error Handling

- **Authentication timeout**: If auth doesn't complete within ~3 seconds, the device disconnects
- **Connection drops**: Device may disconnect if it detects prolonged inactivity
- **Command failures**: No explicit error responses; commands either work or are silently ignored

## Protocol Data

The SDK loads protocol constants from `protocol.json`, keeping byte sequences and offsets in one authoritative location. This makes it easy to update if the protocol changes.
