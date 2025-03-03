/**
 * @license
 * Copyright (c) 2019 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {Driver, ReceiveMethod, StorageDriverProvider, Exists, DriverFactory} from './driver-factory.js';
import {StorageKey} from '../storage-key.js';
import {Runtime} from '../../runtime.js';

type VolatileEntry<Data> = {data: Data, version: number, drivers: VolatileDriver<Data>[]};

export class VolatileStorageKey extends StorageKey {
  readonly unique: string;

  constructor(unique: string) {
    super('volatile');
    this.unique = unique;
  }

  toString() {
    return `${this.protocol}://${this.unique}`;
  }
}

export class VolatileMemory {
  entries = new Map<string, VolatileEntry<unknown>>();
}

export class VolatileDriver<Data> extends Driver<Data> {
  private memory: VolatileMemory;
  private pendingVersion = 0;
  private pendingModel: Data | null = null;
  private receiver: ReceiveMethod<Data>;
  private data: VolatileEntry<Data>;

  constructor(storageKey: StorageKey, exists: Exists) {
    super(storageKey, exists);
    const keyAsString = storageKey.toString();
    this.memory = Runtime.getRuntime().getVolatileMemory();
    switch (exists) {
      case Exists.ShouldCreate:
        if (this.memory.entries.has(keyAsString)) {
          throw new Error(`requested creation of memory location ${storageKey} can't proceed as location already exists`);
        }
        this.data = {data: null, version: 0, drivers: []};
        this.memory.entries.set(keyAsString, this.data as VolatileEntry<unknown>);
        break;
      case Exists.ShouldExist:
        if (!this.memory.entries.has(keyAsString)) {
          throw new Error(`requested connection to memory location ${storageKey} can't proceed as location doesn't exist`);
        }
      /* falls through */
      case Exists.MayExist:
        {
          const data = this.memory.entries.get(keyAsString);
          if (data) {
            this.data = data as VolatileEntry<Data>;
            this.pendingModel = data.data as Data;
            this.pendingVersion = data.version;
          } else {
            this.data = {data: null, version: 0, drivers: []};
            this.memory.entries.set(keyAsString, this.data as VolatileEntry<unknown>);
          }
          break;
        }
      default:
        throw new Error(`unknown Exists code ${exists}`); 
    }
    this.data.drivers.push(this);
  }

  registerReceiver(receiver: ReceiveMethod<Data>) {
    this.receiver = receiver;
    if (this.pendingModel) {
      receiver(this.pendingModel, this.pendingVersion);
      this.pendingModel = null;
    }
  }
  
  async send(model: Data, version: number): Promise<boolean> {
    // This needs to contain an "empty" await, otherwise there's
    // a synchronous send / onReceive loop that can be established
    // between multiple Stores/Drivers writing to the same location.
    await 0;
    if (this.data.version !== version - 1) {
      return false;
    }
    this.data.data = model;
    this.data.version += 1;
    this.data.drivers.forEach(driver => {
      if (driver === this) {
        return;
      }
      driver.receiver(model, this.data.version);
    });
    return true;
  }
  
  async write(key: StorageKey, value: Data): Promise<void> {
    throw new Error('Method not implemented.');
  }
  
  async read(key: StorageKey): Promise<Data> {
    throw new Error('Method not implemented.');
  }
}

export class VolatileStorageDriverProvider implements StorageDriverProvider {
  
  willSupport(storageKey: StorageKey): boolean {
    return storageKey.protocol === 'volatile';
  }
  
  async driver<Data>(storageKey: StorageKey, exists: Exists) {
    if (!this.willSupport(storageKey)) {
      throw new Error(`This provider does not support storageKey ${storageKey.toString()}`);
    }
    
    return new VolatileDriver<Data>(storageKey, exists);
  }

  static register() {
    DriverFactory.register(new VolatileStorageDriverProvider());
  }
}

// Note that this will automatically register for any production code
// that uses volatile drivers; but it won't automatically register in 
// testing; for safety, call VolatileStorageDriverProvider.register()
// from your test code somewhere.
VolatileStorageDriverProvider.register();
