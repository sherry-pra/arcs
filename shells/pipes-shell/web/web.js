/**
 * @license
 * Copyright 2019 Google LLC.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

// configure
import '../../lib/platform/loglevel-web.js';
import {paths} from './paths.js';
import {manifest} from './config.js';

// optional
import '../../lib/database/pouchdb-support.js';
import '../../lib/database/firebase-support.js';
//import '../../../node_modules/sourcemapped-stacktrace/dist/sourcemapped-stacktrace.js';

import {Utils} from '../../lib/runtime/utils.js';
import {ShellApiFactory} from '../device.js';
import {DevtoolsSupport} from '../../lib/runtime/devtools-support.js';

// usage:
//
// ShellApi.observeEntity(`{"type": "address", "name": "East Mumbleton"}`)
// [arcid =] ShellApi.receiveEntity(`{"type": "com.google.android.apps.maps"}`)
//
// [arcid =] ShellApi.receiveEntity(`{"type": "com.music.spotify"}`)
//
// results returned via `DeviceClient.foundSuggestions(arcid, json)` (if it exists)

// can be used for testing:
//
// window.DeviceClient = {
//   shellReady() {
//     console.warn('context is ready!');
//   },
//   foundSuggestions(arcid, json) {
//   }
// };
  window.onclick = () => {
    if (window.ShellApi) {
      window.ShellApi.receiveEntity();
    }
  };
//

const storage = `pouchdb://local/arcs/user`;
const version = `version: jun-3`;

console.log(`${version} -- ${storage}`);

(async () => {
  // if remote DevTools are requested, wait for connect
  await DevtoolsSupport();
  // configure arcs environment
  Utils.init(paths.root, paths.map);
  // configure ShellApi (window.DeviceClient is bound in by outer process, otherwise undefined)
  window.ShellApi = await ShellApiFactory(storage, manifest, window.DeviceClient);
})();
