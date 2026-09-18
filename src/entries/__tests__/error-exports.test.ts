import { describe, it, expect } from 'vitest';
import * as rootEntry from '../../index';
import * as webEntry from '../web';
import * as rnEntry from '../react-native';
import { ConnectionRefusedError, DeviceStateUnknownError } from '../../errors';

const entries = { root: rootEntry, web: webEntry, 'react-native': rnEntry };

describe.each(Object.entries(entries))('%s entry', (_name, entry) => {
  it('lets a caller catch a refused connection by class', () => {
    expect(entry.ConnectionRefusedError).toBe(ConnectionRefusedError);
  });

  it('lets a caller catch an unconfirmed device state by class', () => {
    expect(entry.DeviceStateUnknownError).toBe(DeviceStateUnknownError);
  });
});
