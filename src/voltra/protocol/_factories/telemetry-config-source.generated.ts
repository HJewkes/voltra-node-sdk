// @generated — do not edit. Regenerate: npm run build (from voltra-private)
/* eslint-disable */
import data from '../data/protocol-data.generated';
// Re-export the runtime telemetry block as a typed handle so the factory file
// can read it the same way the source-of-truth file does. The cast widens
// the JSON shape back to the structured `as const` type the factory expects.
export const TELEMETRY_CONFIG = (data as { telemetry: any }).telemetry;
