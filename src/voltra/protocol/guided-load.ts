/**
 * Guided-load (direct-load) protocol helpers (0.6.3+).
 *
 * Builds the BLE frames required to trigger and observe the firmware's
 * direct-load flow, plus a decoder for the status registers polled while it
 * runs.
 *
 * The frame emitted by `buildGuidedLoadTriggerFrame()` is validated on-device.
 */

import { buildEnvelopedFrame, buildParametricFrame } from './_factories';
import protocolData from './data/protocol-data.generated';
import { NotificationConfigs } from './constants';
import type { GuidedLoadStatusFieldName, ParameterCatalogEntry, ProtocolData } from './types';
import { bytesToHex, hexToBytes } from '../../shared/utils';

const protocol = protocolData as ProtocolData;
const guidedLoad = protocol.commands.guidedLoad;

function catalogEntry(key: string): ParameterCatalogEntry {
  const entry = protocol.telemetry.parameterCatalog?.[key];
  if (!entry) {
    throw new Error(`guided-load: protocol data has no parameter catalog entry for '${key}'`);
  }
  return entry;
}

const STATUS_FIELDS = Object.entries(guidedLoad.statusFields) as Array<
  [GuidedLoadStatusFieldName, string]
>;

/** Registers the status frame queries, in the order it lists them. */
const STATUS_PARAM_IDS = STATUS_FIELDS.map(([, key]) => catalogEntry(key).paramId);

const MODE_PARAM = catalogEntry(guidedLoad.modeField);

export const PARAM_DIRECT_LOAD_SAFETY_CHECK = catalogEntry(
  guidedLoad.statusFields.primaryStatus
).paramId;
export const PARAM_DIRECT_LOAD_ST = catalogEntry(guidedLoad.statusFields.forceStatus).paramId;
export const PARAM_DIRECT_LOAD_COUNTDOWN = catalogEntry(
  guidedLoad.statusFields.countdownMs
).paramId;
export const PARAM_DIRECT_LOAD_CTRL = catalogEntry(guidedLoad.statusFields.runtimeStatus).paramId;

/**
 * Build the frame that enters the direct-load flow.
 *
 * Omitting `sequence` uses the frame factories' default; callers that need a
 * fresh sequence per write can supply one.
 */
export function buildGuidedLoadTriggerFrame(sequence?: number): Uint8Array {
  return buildEnvelopedFrame(
    hexToBytes(guidedLoad.triggerCmd)[0],
    hexToBytes(guidedLoad.triggerPayload),
    { sequence }
  );
}

/** Build the read frame that queries the direct-load status registers. */
export function buildGuidedLoadStatusReadFrame(sequence?: number): Uint8Array {
  const payload = new Uint8Array(2 + STATUS_PARAM_IDS.length * 2);
  payload[0] = STATUS_PARAM_IDS.length & 0xff;
  payload[1] = (STATUS_PARAM_IDS.length >> 8) & 0xff;
  for (let i = 0; i < STATUS_PARAM_IDS.length; i++) {
    payload[2 + i * 2] = STATUS_PARAM_IDS[i] & 0xff;
    payload[2 + i * 2 + 1] = (STATUS_PARAM_IDS[i] >> 8) & 0xff;
  }
  return buildEnvelopedFrame(hexToBytes(guidedLoad.statusReadCmd)[0], payload, { sequence });
}

/**
 * Build the parametric write frame that exits guided-load cleanly, by
 * returning the device to a strength-ready state.
 */
export function buildGuidedLoadExitFrame(sequence?: number): Uint8Array {
  return buildParametricFrame(
    { id: MODE_PARAM.paramId, name: MODE_PARAM.name, valueType: MODE_PARAM.valueType },
    guidedLoad.modes.exit,
    { sequence }
  );
}

// =============================================================================
// Status decoder
// =============================================================================

/**
 * Subset of the guided-load registers carried by a single multi-param read
 * response. All fields are optional — the device may pack any subset of them
 * into a given response notification.
 */
export interface GuidedLoadStatusFields {
  /** Bool-like state-machine arm bit. */
  primaryStatus?: number;
  /** Direct-load phase. */
  forceStatus?: number;
  /** Safety countdown remaining, in ms. */
  countdownMs?: number;
  /** Runtime control state. */
  runtimeStatus?: number;
  /** Raw mode-register value — only present when
   *  the device echoes it in a settings/multi-param response. */
  fitnessModeRaw?: number;
}

/** Inbound-match key -> the field it populates. Keys are catalog entries. */
const FIELD_BY_CATALOG_KEY = new Map<string, keyof GuidedLoadStatusFields>([
  ...STATUS_FIELDS.map(([field, key]) => [key, field] as const),
  [guidedLoad.modeField, 'fitnessModeRaw' as const],
]);

/** Catalog keys whose value field is wider than one byte. */
const WIDE_VALUE_KEYS: ReadonlySet<string> = new Set(
  [...FIELD_BY_CATALOG_KEY.keys()].filter((key) => catalogEntry(key).valueWidth > 1)
);

/**
 * Decode a multi-param response or settings-update notification into the
 * subset of guided-load fields it carries. Returns `null` when the buffer is
 * not one of those shapes, or carries none of the guided-load registers.
 *
 * Mirrors the structure of `decodeSettingsUpdate` in `telemetry-decoder.ts`,
 * resolving each register through the generated parameter catalog.
 */
export function decodeGuidedLoadStatus(data: Uint8Array): GuidedLoadStatusFields | null {
  // Accept either the multi-param shape or settings-update.
  const header2 = bytesToHex(data.slice(0, 2));
  const multi = NotificationConfigs.multiParam;
  const settings = NotificationConfigs.settingsUpdate;
  let cfg: typeof multi;
  if (header2 === multi.header) {
    cfg = multi;
  } else if (header2 === settings.header) {
    cfg = settings;
  } else {
    return null;
  }
  if (cfg.paramCountOffset === undefined || cfg.firstParamOffset === undefined) {
    return null;
  }

  const paramCount = data[cfg.paramCountOffset];
  let offset = cfg.firstParamOffset;
  const out: GuidedLoadStatusFields = {};
  let matched = false;

  for (let i = 0; i < paramCount && i < 9; i++) {
    if (offset + 2 > data.length) break;
    const paramIdHex = bytesToHex(data.slice(offset, offset + 2));
    offset += 2;

    const isWide = WIDE_VALUE_KEYS.has(paramIdHex);
    let value: number;
    if (isWide) {
      if (offset + 2 > data.length) break;
      value = data[offset] | (data[offset + 1] << 8);
      offset += 2;
    } else {
      if (offset + 1 > data.length) break;
      value = data[offset];
      offset += 1;
    }

    const field = FIELD_BY_CATALOG_KEY.get(paramIdHex);
    if (field) {
      out[field] = value;
      matched = true;
    }
  }

  return matched ? out : null;
}

/** Mode-register raw value indicating "armed, awaiting pull". */
export const GUIDED_LOAD_MODE_ARMED = guidedLoad.modes.armed;
/** Mode-register raw value indicating "active, ramping/at-target". */
export const GUIDED_LOAD_MODE_ACTIVE = guidedLoad.modes.active;
/** Mode-register raw value used to exit guided-load cleanly. */
export const GUIDED_LOAD_MODE_EXIT = guidedLoad.modes.exit;
