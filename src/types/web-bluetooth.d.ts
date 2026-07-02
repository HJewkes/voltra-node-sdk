/// <reference types="web-bluetooth" />
//
// Web Bluetooth ambient globals (BluetoothDevice, BluetoothRemoteGATTServer,
// BluetoothRemoteGATTCharacteristic, Navigator.bluetooth, ...) used by the web
// and web-bluetooth-base adapters. They come from the @types/web-bluetooth
// devDependency. TypeScript 5.x auto-included it via the default @types scan,
// but TypeScript 6.0 no longer surfaces its ambient globals automatically, so
// reference it explicitly here. This file is picked up via the tsconfig types
// include glob, so every build and typecheck config sees the globals.
export {};
