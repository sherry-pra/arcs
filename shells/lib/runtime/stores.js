/**
 * @license
 * Copyright 2019 Google LLC.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {Type} from '../../../build/runtime/type.js';

export class Stores {
  static async create(context, options) {
    const schemaType = Type.fromLiteral(options.schema);
    const typeOf = options.isCollection ? schemaType.collectionOf() : schemaType;
    const store = await this._requireStore(context, typeOf, options);
    return store;
  }
  static async _requireStore(context, type, {name, id, tags, storageKey}) {
    const store = context.findStoreById(id);
    return store || await context.createStore(type, name, id, tags, storageKey);
  }
}
