/**
 * Bluetooth Environment Model
 *
 * Detects the current environment and BLE capabilities.
 * This is a simplified version for the SDK that doesn't depend on Expo.
 */

/**
 * BLE environment types.
 */
export type BLEEnvironment =
  | 'native' // Real device with dev build - BLE works
  | 'simulator' // iOS Simulator or Android Emulator - no BLE
  | 'expo-go' // Expo Go app - no native BLE module
  | 'web' // Web browser - uses Web Bluetooth API
  | 'node'; // Node.js - uses webbluetooth npm package

/**
 * BLE environment information.
 */
export interface BLEEnvironmentInfo {
  /** Current environment type */
  environment: BLEEnvironment;
  /** Whether BLE is supported in this environment */
  bleSupported: boolean;
  /** Warning message if BLE is not supported */
  warningMessage: string | null;
  /** Whether this is running on web */
  isWeb: boolean;
  /** Whether scanning requires a user gesture (click/tap) - true for Web Bluetooth */
  requiresUserGesture: boolean;
}

/**
 * Warning messages for unsupported environments.
 */
const WARNING_MESSAGES: Partial<Record<BLEEnvironment, string>> = {
  'expo-go':
    'Bluetooth is not available in Expo Go. Run "npx expo run:ios --device" to build with native BLE support.',
  simulator: 'Bluetooth is not available in the simulator. Connect a physical device to test BLE.',
};

/**
 * Check if running in a browser environment.
 */
function isBrowserEnvironment(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof navigator !== 'undefined'
  );
}

/**
 * Check if running in Node.js environment.
 */
function isNodeEnvironment(): boolean {
  return (
    typeof process !== 'undefined' && process.versions != null && process.versions.node != null
  );
}

/**
 * Detect the current BLE environment.
 *
 * This is a simplified version that works without React Native/Expo dependencies.
 * For full environment detection in React Native apps, use the app's environment detection.
 */
export function detectBLEEnvironment(): BLEEnvironmentInfo {
  // Check for browser environment first
  if (isBrowserEnvironment()) {
    const hasWebBluetooth =
      typeof navigator !== 'undefined' && 'bluetooth' in navigator && !!navigator.bluetooth;
    return {
      environment: 'web',
      bleSupported: hasWebBluetooth,
      warningMessage: hasWebBluetooth
        ? null
        : 'Web Bluetooth is not available. Use Chrome over HTTPS or localhost.',
      isWeb: true,
      requiresUserGesture: true, // Web Bluetooth requires user gesture for requestDevice()
    };
  }

  // Check for Node.js environment
  if (isNodeEnvironment()) {
    return {
      environment: 'node',
      bleSupported: true, // Via webbluetooth npm package
      warningMessage: null,
      isWeb: false,
      requiresUserGesture: false,
    };
  }

  // Default to native (React Native apps should use their own environment detection)
  return {
    environment: 'native',
    bleSupported: true,
    warningMessage: null,
    isWeb: false,
    requiresUserGesture: false,
  };
}

/**
 * Check if BLE is available in the current environment.
 */
export function isBLEAvailable(env: BLEEnvironmentInfo): boolean {
  return env.bleSupported;
}

/**
 * Create environment info for native React Native apps.
 * Call this from your app with the detected environment.
 */
export function createNativeEnvironmentInfo(options: {
  isExpoGo?: boolean;
  isSimulator?: boolean;
}): BLEEnvironmentInfo {
  if (options.isExpoGo) {
    return {
      environment: 'expo-go',
      bleSupported: false,
      warningMessage: WARNING_MESSAGES['expo-go']!,
      isWeb: false,
      requiresUserGesture: false,
    };
  }

  if (options.isSimulator) {
    return {
      environment: 'simulator',
      bleSupported: false,
      warningMessage: WARNING_MESSAGES['simulator']!,
      isWeb: false,
      requiresUserGesture: false,
    };
  }

  return {
    environment: 'native',
    bleSupported: true,
    warningMessage: null,
    isWeb: false,
    requiresUserGesture: false,
  };
}
