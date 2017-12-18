// @
// Copyright (c) 2017 Google Inc. All rights reserved.
// This code may only be used under the BSD style license found at
// http://polymer.github.io/LICENSE.txt
// Code distributed by Google as part of this project is also
// subject to an additional IP rights grant found at
// http://polymer.github.io/PATENTS.txt

import StorageProviderBase from './storage-provider-base.js';
import firebase from '../platform/firebase-web.js';
import assert from '../platform/assert-web.js';

class FirebaseKey {
  constructor(key) {
    var parts = key.split('://');
    this.protocol = parts[0];
    assert(this.protocol == 'firebase');
    if (parts[1]) {
      parts = parts[1].split('/');
      assert(parts[0].endsWith('.firebaseio.com'));
      this.databaseUrl = parts[0];
      this.projectId = this.databaseUrl.split('.')[0];
      this.apiKey = parts[1];
      this.location = parts.slice(2).join('/');
    } else {
      this.databaseUrl = undefined;
      this.projectId = undefined;
      this.apiKey = undefined;
      this.location = "";
    }
  }

  toString() {
    if (this.databaseUrl && this.apiKey)
      return `${this.protocol}://${this.databaseUrl}/${this.apiKey}`;
    return `${this.protocol}://`;
  }
}

export class FirebaseStorage {
  constructor(arc) {
    this._arc = arc;
    this.apps = {};
    this.nextAppNameSuffix = 0;
  }

  construct(id, type, keyFragment) {
    var key = new FirebaseKey(keyFragment);
    // TODO: is it ever going to be possible to autoconstruct new firebase datastores? 
    if (key.databaseUrl == undefined || key.apiKey == undefined)
      throw new Error("Can't complete partial firebase keys");

    if (this.apps[key.projectId] == undefined)
      this.apps[key.projectId] = firebase.initializeApp({
        apiKey: key.apiKey,
        databaseURL: key.databaseUrl
      }, `app${this.nextAppNameSuffix++}`);

    return FirebaseStorageProvider.newProvider(type, this._arc, id, this.apps[key.projectId], key);
  }
}

class FirebaseStorageProvider extends StorageProviderBase {
  constructor(type, arc, id, firebaseApp, key) {
    super(type, arc, undefined, id, key.toString());
    this.firebaseApp = firebaseApp;
    this.firebaseKey = key;
    this.database = firebase.database(this.firebaseApp);
    this.reference = this.database.ref(this.firebaseKey.location);
  }

  static newProvider(type, arc, id, firebaseApp, key) {
    if (type.isSetView)
      return new FirebaseCollection(type, arc, id, firebaseApp, key);
    return new FirebaseVariable(type, arc, id, firebaseApp, key);
  }
}

class FirebaseVariable extends FirebaseStorageProvider {
  constructor(type, arc, id, firebaseApp, firebaseKey) {
    super(type, arc, id, firebaseApp, firebaseKey);
    this.dataSnapshot = undefined;
    this.version = 0;
    this.reference.on('value', dataSnapshot => {
      this.dataSnapshot = dataSnapshot;
      this._fire('change', {data: this.dataSnapshot.val(), version: this._version});
    });
  }

  async get() {
    return this.dataSnapshot.val();
  }

  async set(value) {
    this.version++;
    return this.reference.set(value);
  }

  async clear() {
    this.set(undefined);
  }
}

class FirebaseCollection extends FirebaseStorageProvider {
  constructor(type, arc, id, firebaseApp, firebaseKey) {
    super(type, arc, id, firebaseApp, firebaseKey);
    this.dataSnapshot = undefined;
    this.reference.on('value', dataSnapshot => {
      this.dataSnapshot = dataSnapshot;
      this._fire('change', {data: this._setToList(this.dataSnapshot.val()), version: this._version});
    });
  }

  async get(id) {
    return this.dataSnapshot.val()[id];
  }

  async store(entity) { 
    return this.reference.child(entity.id).set(entity);
  }

  async toList() {
    return this._setToList(this.dataSnapshot.val());
  }

  _setToList(set) {
    var list = [];
    for (let key in set) {
      list.push(set[key]);
    }
    return list;
  }
}