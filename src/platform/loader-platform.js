/**
 * @license
 * Copyright (c) 2017 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {Loader} from '../runtime/loader.js';
import {Particle} from '../runtime/particle.js';
import {DomParticle} from '../runtime/dom-particle.js';
import {MultiplexerDomParticle} from '../runtime/multiplexer-dom-particle.js';
import {TransformationDomParticle} from '../runtime/transformation-dom-particle.js';

const html = (strings, ...values) => (strings[0] + values.map((v, i) => v + strings[i + 1]).join('')).trim();

export class PlatformLoaderBase extends Loader {
  constructor(urlMap) {
    super();
    this._urlMap = urlMap || [];
  }
  loadResource(name) {
    const path = this._resolve(name);
    return super.loadResource(path);
  }
  _resolve(path) {
    let url = this._urlMap[path];
    if (!url && path) {
      // TODO(sjmiles): inefficient!
      const macro = Object.keys(this._urlMap).sort((a, b) => b.length - a.length).find(k => path.slice(0, k.length) == k);
      if (macro) {
        url = this._urlMap[macro] + path.slice(macro.length);
      }
    }
    url = this.normalizeDots(url || path);
    return url;
  }
  mapParticleUrl(path) {
    const parts = path.split('/');
    const suffix = parts.pop();
    const folder = parts.join('/');
    const name = suffix.split('.').shift();
    const resolved = this._resolve(folder);
    this._urlMap[name] = resolved;
    this._urlMap['$here'] = resolved;
  }
  unwrapParticle(particleWrapper, log) {
    // TODO(sjmiles): regarding `resolver`:
    //  _resolve method allows particles to request remapping of assets paths
    //  for use in DOM
    const resolver = this._resolve.bind(this);
    return particleWrapper({
      Particle,
      DomParticle,
      MultiplexerDomParticle,
      SimpleParticle: DomParticle,
      TransformationDomParticle,
      resolver,
      log: log || (() => {}),
      html
    });
  }
}
