/**
 * Stub type declarations for react-native
 *
 * This is a peer dependency - these types are for SDK development only.
 * Users of the SDK will have react-native installed.
 */

declare module 'react-native' {
  export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

  export const AppState: {
    addEventListener(
      type: 'change',
      listener: (state: AppStateStatus) => void
    ): { remove: () => void };
    currentState: AppStateStatus;
  };

  export const Platform: {
    OS: 'ios' | 'android' | 'web' | 'windows' | 'macos';
    Version: number | string;
    select<T>(config: { ios?: T; android?: T; web?: T; default?: T }): T;
  };

  export const PermissionsAndroid: {
    PERMISSIONS: {
      BLUETOOTH_SCAN: string;
      BLUETOOTH_CONNECT: string;
      ACCESS_FINE_LOCATION: string;
    };
    RESULTS: {
      GRANTED: 'granted';
      DENIED: 'denied';
      NEVER_ASK_AGAIN: 'never_ask_again';
    };
    request(
      permission: string,
      rationale?: { title: string; message: string; buttonPositive: string }
    ): Promise<'granted' | 'denied' | 'never_ask_again'>;
    requestMultiple(
      permissions: string[]
    ): Promise<Record<string, 'granted' | 'denied' | 'never_ask_again'>>;
  };
}
