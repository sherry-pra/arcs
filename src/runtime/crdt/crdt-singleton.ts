/**
 * @license
 * Copyright (c) 2019 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {ChangeType, CRDTChange, CRDTError, CRDTModel, CRDTTypeRecord, VersionMap} from './crdt.js';
import {CollectionOperation, CollectionOpTypes, CRDTCollection, Referenceable} from './crdt-collection.js';
import {Dictionary} from '../hot.js';

type RawSingleton<T> = T;

type SingletonData<T extends Referenceable> = {
  values: Dictionary<{value: T, version: VersionMap}>,
  version: VersionMap
};

export enum SingletonOpTypes {
  Set,
  Clear
}

export type SingletonOperation<T> = {
  type: SingletonOpTypes.Clear,
  actor: string,
  clock: VersionMap,
}|{
  type: SingletonOpTypes.Set,
  value: T,
  actor: string,
  clock: VersionMap,
};

export interface CRDTSingletonTypeRecord<T extends Referenceable> extends CRDTTypeRecord {
  data: SingletonData<T>;
  operation: SingletonOperation<T>;
  consumerType: RawSingleton<T>;
}

type SingletonChange<T extends Referenceable> = CRDTChange<CRDTSingletonTypeRecord<T>>;

type SingletonModel<T extends Referenceable> = CRDTModel<CRDTSingletonTypeRecord<T>>;

export class CRDTSingleton<T extends Referenceable> implements SingletonModel<T> {
  private collection = new CRDTCollection<T>();

  merge(other: SingletonData<T>):
      {modelChange: SingletonChange<T>, otherChange: SingletonChange<T>} {
    this.collection.merge(other);
    // We cannot pass through the collection ops, so always return the updated model.
    const change: SingletonChange<T> = {
      changeType: ChangeType.Model,
      modelPostChange: this.collection.getData()
    };
    return {modelChange: change, otherChange: change};
  }

  applyOperation(op: SingletonOperation<T>): boolean {
    if (op.type === SingletonOpTypes.Clear) {
      return this.clear(op.actor, op.clock);
    }
    if (op.type === SingletonOpTypes.Set) {
      // Remove does not require an increment, but the caller of this method will have incremented
      // its version, so we hack a version with t-1 for this actor.
      const removeClock = {};
      for (const [k, v] of Object.entries(op.clock)) {
        removeClock[k] = v;
      }
      removeClock[op.actor] = op.clock[op.actor] - 1;
      if (!this.clear(op.actor, removeClock)) {
        return false;
      }
      const addOp: CollectionOperation<T> = {
        type: CollectionOpTypes.Add,
        added: op.value,
        actor: op.actor,
        clock: op.clock,
      };
      if (!this.collection.applyOperation(addOp)) {
        return false;
      }
    }
    return true;
  }

  getData(): SingletonData<T> {
    return this.collection.getData();
  }

  getParticleView(): RawSingleton<T>|null {
    // Return any value.
    return [...this.collection.getParticleView()].sort()[0] || null;
  }

  private clear(actor: string, clock: VersionMap): boolean {
    // Clear all existing values if our clock allows it.
    for (const value of Object.values(this.collection.getData().values)) {
      const removeOp: CollectionOperation<T> = {
        type: CollectionOpTypes.Remove,
        removed: value.value,
        actor,
        clock,
      };
      // If any value fails to remove, we haven't cleared the value and we fail the whole op.
      //if (!this.collection.applyOperation(removeOp)) {
      //   return false;
      // }
      this.collection.applyOperation(removeOp);
    }
    return true;
  }
}
