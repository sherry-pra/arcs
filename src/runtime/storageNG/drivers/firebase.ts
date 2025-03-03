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

import {firebase} from '../../../platform/firebase-web.js';
import {Runtime} from '../../runtime.js';
import {assert} from '../../../platform/assert-web.js';

export class FirebaseStorageKey extends StorageKey {
  public readonly databaseURL: string;
  public readonly projectId: string;
  public readonly apiKey: string;
  public readonly location: string;
  public readonly domain: string;

  constructor(projectId: string, domain: string, apiKey: string, location: string) {
    super('firebase');
    this.databaseURL = `${projectId}.${domain}`;
    this.domain = domain;
    this.projectId = projectId;
    this.apiKey = apiKey;
    this.location = location;
  }

  toString() {
    return `${this.protocol}://${this.databaseURL}:${this.apiKey}/${this.location}`;
  }
}

export class FirebaseAppCache {
  protected appCache: Map<string, firebase.app.App>;

  constructor(runtime: Runtime) {
    this.appCache = runtime.getCacheService().getOrCreateCache<string, firebase.app.App>('firebase-driver');
  }

  getApp(key: FirebaseStorageKey) {
    const keyAsString = key.toString();
    if (!this.appCache.has(keyAsString)) {
      this.appCache.set(keyAsString, firebase.initializeApp(key));
    }
    return this.appCache.get(keyAsString);
  }

  async stopAllApps() {
    await Promise.all([...this.appCache.values()].map(app => app.delete()));
    this.appCache.clear();
  }

  static async stop() {
    await new FirebaseAppCache(Runtime.getRuntime()).stopAllApps();
  }
}

// A driver for Firebase.
//
// In addition to the version described on the abstract Driver class,
// this driver maintains a 'tag' on each model it processes. This is
// necessary to deal with the fact that incoming state updates
// (which call remoteStateChanged) are not distinguishable in terms
// of being local or remote; furthermore, when local, they are actually 
// delivered just *before* the transaction reports success. This means
// that a given version *might* be the just-about-to-succeed local 
// update, or it *might* be some completely new state from firebase.
// A randomly generated tag is used to provide this distinguishing
// mark.
//
// Isn't firebase *wonderful*?
export class FirebaseDriver<Data> extends Driver<Data> {
  private receiver: ReceiveMethod<Data>;
  appCache: FirebaseAppCache = new FirebaseAppCache(Runtime.getRuntime());

  storageKey: FirebaseStorageKey;
  private reference: firebase.database.Reference;
  private seenVersion = 0;
  private seenTag = 0;
  private nextTag: number = null;
  private pendingModel: Data = null;
  private pendingVersion: number;

  async init() {
    const app = this.appCache.getApp(this.storageKey);
    const reference = app.database().ref(this.storageKey.location);
    const currentSnapshot = await reference.once('value');

    if (this.exists === Exists.ShouldCreate && currentSnapshot.exists()) {
      throw new Error(`requested creation of memory location ${this.storageKey} can't proceed as location already exists`);
    }
    if (this.exists === Exists.ShouldExist && !currentSnapshot.exists()) {
      throw new Error(`requested connection to memory location ${this.storageKey} can't proceed as location doesn't exist`);
    }

    if (!currentSnapshot.exists()) {
      await reference.transaction(data => {
        if (data !== null) {
          return undefined;
        }
        return {version: 0, tag: 0};
      });
    } else {
      this.pendingModel = currentSnapshot.val().model || null;
      this.pendingVersion = currentSnapshot.val().version;
    }
      
    this.reference = reference;
  }

  registerReceiver(receiver: ReceiveMethod<Data>) {
    this.receiver = receiver;
    if (this.pendingModel !== null) {
      assert(this.pendingModel);
      receiver(this.pendingModel, this.pendingVersion);
      this.pendingModel = null;
      this.seenVersion = this.pendingVersion;
    }
    this.reference.on('value', dataSnapshot => this.remoteStateChanged(dataSnapshot));
  }
  
  async send(model: Data, version: number) {
    this.nextTag = Math.random();
    // Locally cache nextTag and seenTag as this function can be
    // re-entrant.
    const nextTag = this.nextTag;
    const seenTag = this.seenTag;

    const result = await this.reference.transaction(data => {
      if (data) {
        if (data.version !== version - 1) {
          return undefined;
        }
        if (data.tag !== seenTag) {
          return undefined;
        }
      }
      return {version, model, tag: nextTag};
    }, (err: Error, complete: boolean) => {
      if (complete) {
        this.seenTag = nextTag;
      }
    }, false);
    return result.committed;
  }

  remoteStateChanged(dataSnapshot: firebase.database.DataSnapshot) {
    const {model, version, tag} = dataSnapshot.val();
    if (version > this.seenVersion) {
      this.seenVersion = version;
      this.seenTag = tag;
      if (tag !== this.nextTag) {
        this.receiver(model, version);
      }
    }
  }

  async write(key: StorageKey, value: Data) {
    throw new Error('Method not implemented.');
  }

  async read(key: StorageKey) {
    throw new Error('Method not implemented.');
  }
}


export class FirebaseStorageDriverProvider implements StorageDriverProvider {
  
  willSupport(storageKey: StorageKey): boolean {
    return storageKey.protocol === 'firebase';
  }
  
  async driver<Data>(storageKey: StorageKey, exists: Exists) {
    if (!this.willSupport(storageKey)) {
      throw new Error(`This provider does not support storageKey ${storageKey.toString()}`);
    }
    
    const driver = new FirebaseDriver<Data>(storageKey, exists);
    await driver.init();
    return driver;
  }

  static register() {
    DriverFactory.register(new FirebaseStorageDriverProvider());
  }
}

// Note that this will automatically register for any production code
// that uses firebase drivers; but it won't automatically register in 
// testing.
//
// If you want to test using the firebase driver you have three options.
// (1) for (_slow_) manual testing, call FirebaseStorageDriverProvider.register()
// somewhere at the beginning of your test; if you want to be hermetic,
// call DriverFactory.clearRegistrationsForTesting() at the end.
// (2) to use a mock firebase implementation and directly test the driver, 
// construct your driver using 
// FakeFirebaseStorageDriverProvider.newDriverForTesting(key, exists);
// Note that key.databaseURL _must be_ test-url if you do this.
// (3) you can also register the FakeFirebaseStorageDriverProvider with
// the DriverFactory by calling FakeFirebaseStorageDriverProvider.register();
// again your storageKey databaseURLs must be test-url and don't forget
// to clean up with DriverFactory.clearRegistrationsForTesting().
FirebaseStorageDriverProvider.register();
