/**
 * SDK Types
 *
 * Types for the high-level VoltraClient API.
 */

import type { BLEAdapter, Peripheral } from '../bluetooth/adapters/types';
import type { TelemetryFrame } from '../voltra/models/telemetry';
import type { VoltraConnectionState } from '../voltra/models/connection';
import type { VoltraDeviceSettings, VoltraRecordingState } from '../voltra/models/device';
import type { TrainingMode, VendorSchemaVersion } from '../voltra/protocol/constants';
import type { DeviceSettings, StateDumpEvent } from '../voltra/protocol/types';

/**
 * Options for creating a VoltraClient.
 */
export interface VoltraClientOptions {
  /**
   * Pre-configured BLE adapter to use (legacy path).
   * If not provided, you must call setAdapter() before connecting OR
   * pass `peripheral` instead.
   */
  adapter?: BLEAdapter;

  /**
   * Pre-dialed peripheral to drive (Phase 0 path).
   *
   * When supplied, the client treats the peripheral as already
   * connected — `client.connect(device)` becomes auth-only (no fresh
   * BLE dial), `client.scan()` is unsupported (use the host directly),
   * and `client.disconnect()` resolves to `peripheral.disconnect()`.
   *
   * Mutually exclusive with `adapter`. Pass exactly one. New consumers
   * should prefer this; the legacy `adapter` path is retained for
   * backward compatibility through Phase 2.
   */
  peripheral?: Peripheral;

  /**
   * Enable auto-reconnect on connection loss.
   * Default: false
   */
  autoReconnect?: boolean;

  /**
   * Maximum number of reconnect attempts.
   * Default: 3
   */
  maxReconnectAttempts?: number;

  /**
   * Delay between reconnect attempts in milliseconds.
   * Default: 1000
   */
  reconnectDelayMs?: number;
}

/**
 * Options for scanning for devices.
 */
export interface ScanOptions {
  /**
   * Scan timeout in milliseconds.
   * Default: 10000 (10 seconds)
   */
  timeout?: number;

  /**
   * Only return Voltra devices (filter by name prefix).
   * Default: true
   */
  filterVoltra?: boolean;
}

/**
 * Client event types.
 *
 * 0.6.0 dropped the payload-less `'repBoundary'` and `'setBoundary'`
 * variants. Subscribe to `'perRep'` / `'inProgress'` for the typed
 * replacements.
 */
export type VoltraClientEvent =
  // Connection events
  | { type: 'connectionStateChanged'; state: VoltraConnectionState }
  | { type: 'connected'; deviceId: string; deviceName: string | null }
  | { type: 'disconnected'; deviceId: string }
  | { type: 'reconnecting'; attempt: number; maxAttempts: number }
  // Recording events
  | { type: 'recordingStateChanged'; state: VoltraRecordingState }
  // Telemetry events
  | { type: 'frame'; frame: TelemetryFrame }
  // Typed vendor-frame events (0.6.0+)
  | { type: 'perRep'; event: PerRepEvent }
  | { type: 'summary'; event: SummaryEvent }
  | { type: 'setSummary'; event: SetSummaryEvent }
  | { type: 'inProgress'; event: InProgressEvent }
  // Device notification events
  | { type: 'modeConfirmed'; mode: TrainingMode }
  | { type: 'settingsUpdate'; settings: DeviceSettings }
  | { type: 'stateDump'; event: StateDumpEvent }
  | { type: 'batteryUpdate'; battery: number }
  // Guided-load (Phase 1g, 0.6.3+ @experimental)
  | { type: 'guidedLoadState'; state: GuidedLoadState }
  // Error events
  | { type: 'error'; error: Error };

/**
 * Client event listener.
 */
export type VoltraClientEventListener = (event: VoltraClientEvent) => void;

/**
 * Frame listener (shorthand for subscribing to telemetry frames).
 */
export type FrameListener = (frame: TelemetryFrame) => void;

/**
 * Raw frame listener — fires for every inbound BLE notification BEFORE
 * decode, including frames that decode to `'unknown'`. Diagnostic surface
 * for byte-level work; consumers needing typed events should use the typed
 * listeners (`onFrame`, `onPerRep`, etc.) instead. Added in 0.6.2.
 */
export type RawFrameListener = (data: Uint8Array) => void;

/**
 * Mode confirmed listener (called when device confirms mode change).
 */
export type ModeConfirmedListener = (mode: TrainingMode) => void;

/**
 * Settings update listener (called when device reports current settings).
 */
export type SettingsUpdateListener = (settings: DeviceSettings) => void;

/**
 * Battery update listener (called when device reports battery level).
 */
export type BatteryUpdateListener = (battery: number) => void;

/**
 * State-dump listener (called when device emits a `cmd=0x07` 52-byte
 * `aa 80 25` envelope carrying chains-active flag, fitness-assist toggle, and
 * chain target weight).
 *
 * Unlike `SettingsUpdateListener`, the payload preserves the raw
 * `assistMode` byte — consumers should be aware of the asymmetric-off
 * semantics for `FITNESS_ASSIST_MODE` (idle reads as `8`, on as `1`; any
 * value other than `1` should be treated as off).
 */
export type StateDumpListener = (event: StateDumpEvent) => void;

/**
 * Connection-state change listener — fires whenever the client transitions
 * between {@link VoltraConnectionState} values. Consistent with the other
 * `XxxListener` aliases in the SDK.
 */
export type ConnectionStateListener = (state: VoltraConnectionState) => void;

// =============================================================================
// Typed vendor-frame events (0.6.0+)
//
// Field offsets validated 2026-05-06 on VTR-212006 (voltra-private phase-5
// captures). 0.6.0 removed the legacy onRepBoundary / onSetBoundary listeners
// — the four vendor frames are now exclusively surfaced via their typed
// perRep / inProgress / summary / setSummary callbacks.
// =============================================================================

/**
 * Payload of a vendor `perRep` frame (74 B). Fires twice per rep —
 * pull start (motionPhase 1) and return start (motionPhase 2).
 */
export interface PerRepEvent {
  /** 'pull' = motionPhase 1 (concentric start); 'return' = motionPhase 2 (eccentric start). */
  phase: 'pull' | 'return';
  /** Cumulative frame counter within the set (frame[14], uint8). */
  frameCounter: number;
  /** Set counter (frame[15], uint8). */
  setCounter: number;
  /** Cumulative rep counter within the set (frame[17], uint8). */
  repCount: number;
  /**
   * Target weight in tenths of pounds (frame[19..20], uint16 LE).
   * baseWeight × 10 in weight mode; 0 in band/damper/isokinetic.
   */
  targetWeightTenths: number;
}

/**
 * Payload of a vendor `summary` frame (140 B, end-of-set).
 *
 * Each `schemaVersion` (1=weight, 2=band, 3=damper, 4=isokinetic) carries a
 * different mode-specific aggregate field map at frame offset 18+. Only the
 * universal `setCounter` / `repCount` fields are decoded — consume `raw` for
 * mode-specific fields.
 */
export interface SummaryEvent {
  /** Schema version: 1=weight, 2=band, 3=damper, 4=isokinetic. */
  schemaVersion: VendorSchemaVersion;
  /** Set counter (frame[14], uint8). */
  setCounter: number;
  /** Rep count (frame[16..17], uint16 LE). */
  repCount: number;
  /** Raw frame bytes for downstream decoding of mode-specific aggregate fields. */
  raw: Uint8Array;
}

/**
 * Payload of a vendor `aa 85 5f` set-summary frame (110 B). The device emits
 * one of these per set in WT/RB/Damper modes after all reps complete, with
 * the final `repCount` and `repDurationMs` baked in. (The legacy `preSummary`
 * label and the "fires ~3s before final rep" comment were misnomers; the
 * frame fires post-final-rep with the device's own debounce. See
 * `voltra-private/research/aa-subtype-catalog-2026-05-07-android-deep.md` §7.5
 * for the cross-decompile analysis and `voltra-private/captures/sessions/validation-phase-6-set-boundaries-2026-05-06T20-12-57.events.json`
 * for the empirical evidence.)
 *
 * In WT/RB/Damper this is the canonical per-set close marker — the
 * `aa 86 7d` "summary" frame is workout-end / post-STOP only and may not
 * fire at all in some modes.
 */
export interface SetSummaryEvent {
  /** Schema version: 1=weight, 2=band, 3=damper, 4=isokinetic. */
  schemaVersion: VendorSchemaVersion;
  /** Target weight in tenths of pounds (frame[16..17], uint16 LE). */
  targetWeightTenths: number;
  /** Rep count (frame[26..27], uint16 LE). */
  repCount: number;
  /** Duration of the final rep in milliseconds (frame[96..99], uint32 LE). */
  repDurationMs: number;
  /** Raw frame bytes for downstream decoding. */
  raw: Uint8Array;
}

/**
 * Payload of a vendor `inProgress` frame (79 B, ~1 Hz heartbeat during
 * active sets).
 *
 * Field offsets validated empirically (handoff 2026-05-06) but not yet
 * baked into voltra-private's telemetry-config. Hardcoded in the decoder
 * pending a future regen sync.
 */
export interface InProgressEvent {
  /** Peak force during current rep, tenths of pounds (frame[17..18], uint16 LE). */
  peakForceTenths: number;
  /** Average / current force, tenths of pounds (frame[25..26], uint16 LE). */
  currentForceTenths: number;
  /** Velocity in cm/s — magnitude only (frame[28..29], uint16 LE). */
  velocityCmPerSec: number;
  /** Target weight in tenths of pounds (frame[49..52], uint32 LE). */
  targetWeightTenths: number;
  /** Raw frame bytes. */
  raw: Uint8Array;
}

// =============================================================================
// Guided-load (direct-load) — 0.6.3+ (@experimental)
//
// "Direct-load" / "guided-load" is the firmware-driven flow where the device
// ramps from a fixed start floor to the user's target weight after a single
// trigger byte. Phase 1g of the Voltras roadmap exposes the trigger + the
// post-trigger state machine through the SDK so callers can observe READY
// (armed) → countdown → ACTIVE (engaged) transitions without rolling their
// own polling loop.
//
// State machine summary (from voltra-private/research/direct-load-protocol-
// 2026-05-06-android-deep.md §3-§5):
//   - 'idle'      — pre-trigger; no polling active
//   - 'armed'     — trigger sent, BP_SET_FITNESS_MODE = 0x0026, awaiting pull
//   - 'countdown' — user has pulled; safety countdown register `0x53C8` is
//                   ticking down (3s nominal)
//   - 'engaging'  — countdown reached zero, ramp in progress
//   - 'active'    — BP_SET_FITNESS_MODE = 0x0027, engaged at target
//   - 'exited'    — `exitGuidedLoad()` issued (write 0x0004 to 0x3E89)
//   - 'timeout'   — 18s polling window closed without reaching ACTIVE
//
// Polling is mandatory — the device does not asynchronously push state
// transitions for these registers, so without the 500ms read loop the SDK
// sees no transitions.
// =============================================================================

/** Discrete guided-load lifecycle phases (see file-level state machine doc). */
export type GuidedLoadPhase =
  | 'idle'
  | 'armed'
  | 'countdown'
  | 'engaging'
  | 'active'
  | 'exited'
  | 'timeout';

/**
 * Snapshot of guided-load state surfaced by polling the 4 status registers.
 *
 * `countdownRemainingMs` carries the firmware's 3-second pre-engage safety
 * countdown — the value decreases monotonically from ~3000 to 0 during the
 * countdown phase and is `null` outside that phase.
 *
 * `fitnessModeRaw` is the raw value of the `BP_SET_FITNESS_MODE` register
 * (`0x3E89`): `0x0026` while armed, `0x0027` while active, and `0x0004`
 * after `exitGuidedLoad()`.
 */
export interface GuidedLoadState {
  phase: GuidedLoadPhase;
  countdownRemainingMs: number | null;
  fitnessModeRaw: number | null;
}

/**
 * Options for `VoltraClient.startGuidedLoad`.
 *
 * `targetWeightLbs` is the **target** for the guided ramp; the device-side
 * start floor is fixed and cannot be controlled.
 *
 * `pollIntervalMs` / `pollDurationMs` defaults match the Android client
 * (`ISOMETRIC_VENDOR_REFRESH_INTERVAL_MILLIS = 500ms`,
 * `DIRECT_LOAD_VENDOR_REFRESH_BURST_MILLIS = 18000ms`).
 */
export interface GuidedLoadOptions {
  /** Target weight in pounds (range follows `setWeight`'s validation). */
  targetWeightLbs: number;
  /** Poll interval (ms) for the 4 status registers. Default 500. */
  pollIntervalMs?: number;
  /** Total poll window (ms) starting at trigger time. Default 18000. */
  pollDurationMs?: number;
}

/** Listener for guided-load state changes. */
export type GuidedLoadStateListener = (state: GuidedLoadState) => void;

/** PerRep listener (called twice per rep — pull start + return start). */
export type PerRepListener = (event: PerRepEvent) => void;

/** Summary listener (called once at end-of-set). */
export type SummaryListener = (event: SummaryEvent) => void;

/** Set-summary listener (called per-set after all reps complete in WT/RB/Damper). */
export type SetSummaryListener = (event: SetSummaryEvent) => void;

/** InProgress listener (called ~1 Hz during active sets). */
export type InProgressListener = (event: InProgressEvent) => void;

// =============================================================================
// Phase 6 event wrappers (0.10.0+)
//
// Each wrapper carries a per-connection monotonic `seq` (resets to 0 on every
// successful `connect()`) and an ISO-8601 `ts` captured at SDK observation
// time. The bare-value listeners (`onBatteryUpdate`, `onRawFrame`, etc.) keep
// firing for backwards compatibility; consumers wanting the wrapper shape
// should subscribe to the parallel `on*Event` listeners.
//
// `ConnectionLossEvent.lastKnownSettings` exists so the MCP bridge can drop
// its `staleSinceDisconnect` machinery — the SDK now captures the `_settings`
// snapshot at the moment the link dies and stamps a single `ts` timestamp
// instead of forcing each consumer to do it.
//
// `ModeRevertEvent` lifts the Bug 22 mode-revert latch out of the MCP bridge
// into the SDK: when the device emits a mode change that disagrees with the
// last `setMode()` call (within a 2s confirmation window), the SDK fires
// `onModeRevertEvent`.
// =============================================================================

/**
 * Wrapper for battery-level updates (parallel to {@link BatteryUpdateListener}).
 */
export interface BatteryUpdateEvent {
  /** Battery level 0-100 (mirrors the bare-value listener payload). */
  level: number;
  /** Per-connection monotonic counter (resets on each successful `connect()`). */
  seq: number;
  /** ISO-8601 timestamp captured when the SDK observed this update. */
  ts: string;
}

/**
 * Wrapper for raw inbound BLE frames (parallel to {@link RawFrameListener}).
 */
export interface RawFrameEvent {
  bytes: Uint8Array;
  seq: number;
  ts: string;
}

/**
 * Wrapper for confirmed training-mode changes (parallel to
 * {@link ModeConfirmedListener}).
 *
 * `from` is `null` on the first observation post-connect — the SDK has no
 * pre-connect mode to compare against.
 */
export interface ModeChangeEvent {
  from: TrainingMode | null;
  to: TrainingMode;
  seq: number;
  ts: string;
}

/**
 * Wrapper for connection-state transitions.
 *
 * `lastKnownSettings` is populated for transitions that leave the connected
 * state (e.g. `connected → disconnected`); for entry transitions
 * (e.g. `disconnected → connecting`) it is the cached pre-disconnect
 * settings if one is available, otherwise `null`.
 */
export interface ConnectionStateChangeEvent {
  from: VoltraConnectionState;
  to: VoltraConnectionState;
  deviceId: string;
  deviceName: string;
  lastKnownSettings: DeviceSettings | null;
  seq: number;
  ts: string;
}

/**
 * Wrapper for involuntary disconnects (gatt disconnect, write failure during
 * a connected session, idle timeout). Voluntary `client.disconnect()` calls do
 * NOT fire this event — only unexpected losses.
 *
 * `lastKnownSettings` carries the SDK's `_settings` cache at the moment of
 * loss so consumers can replay the device's pre-disconnect state without
 * waiting for the next bootstrap cascade.
 *
 * `reason` is a free-form string for forward compatibility — known values
 * today are `'gatt_disconnect'` and `'write_failure'`.
 */
export interface ConnectionLossEvent {
  deviceId: string;
  deviceName: string;
  reason: string;
  lastKnownSettings: DeviceSettings | null;
  /** ISO-8601 timestamp the SDK observed the loss. */
  ts: string;
  seq: number;
}

/**
 * Wrapper for guided-load state transitions (parallel to
 * {@link GuidedLoadStateListener}).
 *
 * `weightLbs` carries the target weight passed to the most recent
 * {@link VoltraClient.startGuidedLoad} call when known, otherwise `null`.
 */
export interface GuidedLoadStateEvent {
  state: GuidedLoadPhase;
  weightLbs: number | null;
  seq: number;
  ts: string;
}

/**
 * Mode-revert event — fired when the device confirms a different training
 * mode than the SDK last requested via {@link VoltraClient.setMode}, within
 * a 2-second confirmation window. Lifts the Bug 22 mode-revert latch from
 * the MCP bridge into the SDK.
 *
 * No bare-value equivalent — this is a SDK-synthesized event.
 */
export interface ModeRevertEvent {
  /** What the SDK had been told to set via setMode(). */
  expectedMode: TrainingMode;
  /** Mode the device confirmed *before* the revert. */
  from: TrainingMode;
  /** Mode the device reverted *to*. */
  to: TrainingMode;
  /** ISO-8601 timestamp of the revert detection. */
  ts: string;
  seq: number;
}

export type BatteryUpdateEventListener = (event: BatteryUpdateEvent) => void;
export type RawFrameEventListener = (event: RawFrameEvent) => void;
export type ModeChangeEventListener = (event: ModeChangeEvent) => void;
export type ConnectionStateChangeEventListener = (event: ConnectionStateChangeEvent) => void;
export type ConnectionLossEventListener = (event: ConnectionLossEvent) => void;
export type GuidedLoadStateEventListener = (event: GuidedLoadStateEvent) => void;
export type ModeRevertEventListener = (event: ModeRevertEvent) => void;

// <Bug-22>
/**
 * Distance preset for {@link VoltraClient.startRow}. Pass `'JustRow'` for
 * a free-row session with no preset distance.
 *
 * Wire-level mapping is documented in
 * voltra-private/research/rowing-protocol-2026-05-06-android-deep.md §2.
 * Only `JustRow` and `M50` are independently verified against iPad
 * captures; the 100/500/1000/2000/5000 m codes are inferred by sequential
 * numbering and pending on-device validation.
 *
 * Note: row distance presets are an iPad-side construct (`50m=10×5`,
 * `5000m=1000×5`) — the device does not receive a native target-distance
 * register. `EP_SCR_SWITCH` only selects the preset *screen*; the SDK
 * does not currently emit a separate target-distance write.
 */
export type RowingDistancePreset =
  | 'JustRow'
  | 'M50'
  | 'M100'
  | 'M500'
  | 'M1000'
  | 'M2000'
  | 'M5000';
// </Bug-22>

/**
 * State snapshot of the client.
 */
export interface VoltraClientState {
  connectionState: VoltraConnectionState;
  isConnected: boolean;
  isReconnecting: boolean;
  connectedDeviceId: string | null;
  connectedDeviceName: string | null;
  settings: VoltraDeviceSettings;
  recordingState: VoltraRecordingState;
  isRecording: boolean;
  error: Error | null;
}

/**
 * Generic helper for per-field settings change events.
 *
 * Parameterised over a key of {@link DeviceSettings} so the `previous` /
 * `current` values are narrowly typed to the field in question.
 *
 * Not yet emitted by the SDK — provided here as a typed building block for
 * consumers that want to track individual field diffs derived from
 * `onSettingsUpdate` callbacks.
 *
 * @example
 * ```ts
 * function handleFieldChange<F extends keyof DeviceSettings>(
 *   event: SettingsFieldChangedEvent<F>
 * ) { ... }
 * ```
 */
export type SettingsFieldChangedEvent<F extends keyof DeviceSettings> = {
  field: F;
  previous: DeviceSettings[F];
  current: DeviceSettings[F];
  changedAt: string;
};
