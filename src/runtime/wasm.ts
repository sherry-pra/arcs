/**
 * @license
 * Copyright (c) 2019 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {assert} from '../platform/assert-web.js';
import {Schema} from './schema.js';
import {Entity, EntityRawData} from './entity.js';
import {Particle} from './particle.js';
import {Handle, Singleton, Collection} from './handle.js';
import {Content} from './slot-consumer.js';
import {Dictionary} from './hot.js';

// Encodes/decodes the wire format for transferring entities over the wasm boundary.
// Note that entities must have an id before serializing for use in a wasm particle.
//
//  <singleton> = <id-length>:<id>|<name>:<value>|<name>:<value>| ... |
//  <value> depends on the field type:
//    Text       <name>:T<length>:<text>
//    URL        <name>:U<length>:<text>
//    Number     <name>:N<number>:
//    Boolean    <name>:B<zero-or-one>
//
//  <collection> = <num-entities>:<length>:<encoded><length>:<encoded> ...
//
// Examples:
//   Singleton:   4:id05|txt:T3:abc|lnk:U10:http://def|num:N37:|flg:B1|
//   Collection:  3:29:4:id12|txt:T4:qwer|num:N9.2:|18:6:id2670|num:N-7:|15:5:id501|flg:B0|
export class EntityPackager {
  readonly schema: Schema;
  private encoder = new StringEncoder();
  private decoder = new StringDecoder();

  constructor(schema: Schema) {
    assert(schema.names.length > 0, 'At least one schema name is required for entity packaging');
    this.schema = schema;
  }

  encodeSingleton(entity: Entity): string {
    return this.encoder.encodeSingleton(this.schema, entity);
  }

  encodeCollection(entities: Entity[]): string {
    return this.encoder.encodeCollection(this.schema, entities);
  }

  decodeSingleton(str: string): Entity {
    const {id, data} = this.decoder.decodeSingleton(str);
    const entity = new (this.schema.entityClass())(data);
    if (id !== '') {
      Entity.identify(entity, id);
    }
    return entity;
  }
}

class StringEncoder {
  encodeSingleton(schema: Schema, entity: Entity): string {
    const id = Entity.id(entity);
    let encoded = id.length + ':' + id + '|';
    for (const [name, value] of Object.entries(entity)) {
      encoded += this.encodeField(schema.fields[name], name, value);
    }
    return encoded;
  }

  encodeCollection(schema: Schema, entities: Entity[]): string {
    let encoded = entities.length + ':';
    for (const entity of entities) {
      const str = this.encodeSingleton(schema, entity);
      encoded += str.length + ':' + str;
    }
    return encoded;
  }

  private encodeField(field, name, value) {
    switch (field.kind) {
      case 'schema-primitive':
        return name + ':' + field.type.substr(0, 1) + this.encodeValue(field.type, value) + '|';

      case 'schema-collection':
      case 'schema-union':
      case 'schema-tuple':
      case 'schema-reference':
        throw new Error(`'${field.kind}' not yet supported for entity packaging`);

      default:
        throw new Error(`Unknown field kind '${field.kind}' in schema`);
    }
  }

  private encodeValue(type, value)  {
    switch (type) {
      case 'Text':
      case 'URL':
        return (value as string).length + ':' + value;

      case 'Number':
        return value + ':';

      case 'Boolean':
        return (value ? '1' : '0');

      case 'Bytes':
      case 'Object':
        throw new Error(`'${type}' not yet supported for entity packaging`);

      default:
        throw new Error(`Unknown primitive value type '${type}' in schema`);
    }
  }
}

class StringDecoder {
  str: string;

  decodeSingleton(str: string): {id: string; data: EntityRawData} {
    this.str = str;
    const len = Number(this.upTo(':'));
    const id = this.chomp(len);
    this.validate('|');

    const data = {};
    while (this.str.length > 0) {
      const name = this.upTo(':');
      const typeChar = this.chomp(1);
      data[name] = this.decodeValue(typeChar);
      this.validate('|');
    }
    return {id, data};
  }

  // Format is <size>:<key-len>:<key><value-len>:<value><key-len>:<key><value-len>:<value>...
  decodeDictionary(str: string): Dictionary<string> {
    this.str = str;
    const dict = {};
    let num = Number(this.upTo(':'));
    while (num--) {
      const klen = Number(this.upTo(':'));
      const key = this.chomp(klen);
      const vlen = Number(this.upTo(':'));
      dict[key] = this.chomp(vlen);
    }
    return dict;
  }

  private upTo(char) {
    const i = this.str.indexOf(char);
    if (i < 0) {
      throw new Error(`Packaged entity decoding fail: expected '${char}' separator in '${this.str}'`);
    }
    const token = this.str.slice(0, i);
    this.str = this.str.slice(i + 1);
    return token;
  }

  private chomp(len) {
    if (len > this.str.length) {
      throw new Error(`Packaged entity decoding fail: expected '${len}' chars to remain in '${this.str}'`);
    }
    const token = this.str.slice(0, len);
    this.str = this.str.slice(len);
    return token;
  }

  private validate(token) {
    if (this.chomp(token.length) !== token) {
      throw new Error(`Packaged entity decoding fail: expected '${token}' at start of '${this.str}'`);
    }
  }

  private decodeValue(typeChar) {
    switch (typeChar) {
      case 'T':
      case 'U': {
        const len = Number(this.upTo(':'));
        return this.chomp(len);
      }

      case 'N':
        return Number(this.upTo(':'));

      case 'B':
        return Boolean(this.chomp(1) === '1');

      default:
        throw new Error(`Packaged entity decoding fail: unknown or unsupported primitive value type '${typeChar}'`);
    }
  }
}

/**
 * Per-language platform environment and startup specializations for Emscripten and Kotlin.
 */
interface WasmDriver {
  /**
   * Adds required import functions into env for a given language runtime and initializes
   * any fields needed on the wasm container, such as memory, tables, etc.
   */
  configureEnvironment(module: WebAssembly.Module, container: WasmContainer, env: {});

  /**
   * Initializes the instantiated WebAssembly, runs any startup lifecycle, and if this
   * runtime manages its own memory initialization, initializes the heap pointers.
   */
  initializeInstance(container: WasmContainer, instance: WebAssembly.Instance);
}

class EmscriptenWasmDriver implements WasmDriver {
  private readonly cfg: {memSize: number, tableSize: number, globalBase: number, dynamicBase: number, dynamictopPtr: number};

  constructor(customSection: ArrayBuffer) {
    // Wasm modules built by emscripten require some external memory configuration by the caller,
    // which is usually built into the glue code generated alongside the module. We're not using
    // the glue code, but if we set the EMIT_EMSCRIPTEN_METADATA flag when building, emscripten
    // will provide a custom section in the module itself with the required values.
    const METADATA_SIZE = 10;
    const METADATA_MAJOR = 0;
    const METADATA_MINOR = 1;
    const ABI_MAJOR = 0;
    const ABI_MINOR = 3;

    // The logic for reading metadata values here was copied from the emscripten source.
    const buffer = new Uint8Array(customSection);
    const metadata: number[] = [];
    let offset = 0;
    while (offset < buffer.byteLength) {
      let result = 0;
      let shift = 0;
      while (1) {
        const byte = buffer[offset++];
        result |= (byte & 0x7f) << shift;
        if (!(byte & 0x80)) {
          break;
        }
        shift += 7;
      }
      metadata.push(result);
    }

    // The specifics of the section are not published anywhere official (yet). The values here
    // correspond to emscripten version 1.38.34:
    //   https://github.com/emscripten-core/emscripten/blob/1.38.34/tools/shared.py#L3065
    if (metadata.length !== METADATA_SIZE) {
      throw new Error(`emscripten metadata section should have ${METADATA_SIZE} values; ` +
                      `got ${metadata.length}`);
    }
    if (metadata[0] !== METADATA_MAJOR || metadata[1] !== METADATA_MINOR) {
      throw new Error(`emscripten metadata version should be ${METADATA_MAJOR}.${METADATA_MINOR}; ` +
                      `got ${metadata[0]}.${metadata[1]}`);
    }
    if (metadata[2] !== ABI_MAJOR || metadata[3] !== ABI_MINOR) {
      throw new Error(`emscripten ABI version should be ${ABI_MAJOR}.${ABI_MINOR}; ` +
                      `got ${metadata[2]}.${metadata[3]}`);
    }

    // metadata[9] is 'tempdoublePtr'; appears to be related to pthreads and is not used here.
    this.cfg = {
      memSize: metadata[4],
      tableSize: metadata[5],
      globalBase: metadata[6],
      dynamicBase: metadata[7],
      dynamictopPtr: metadata[8],
    };
  }

  configureEnvironment(module: WebAssembly.Module, container: WasmContainer, env: {}) {
    container.memory = new WebAssembly.Memory({initial: this.cfg.memSize, maximum: this.cfg.memSize});
    container.heapU8 = new Uint8Array(container.memory.buffer);
    container.heap32 = new Int32Array(container.memory.buffer);

    // We need to poke the address of the heap base into the memory buffer prior to instantiating.
    container.heap32[this.cfg.dynamictopPtr >> 2] = this.cfg.dynamicBase;

    Object.assign(env, {
      // Memory setup
      memory: container.memory,
      __memory_base: this.cfg.globalBase,
      table: new WebAssembly.Table({initial: this.cfg.tableSize, maximum: this.cfg.tableSize, element: 'anyfunc'}),
      __table_base: 0,
      DYNAMICTOP_PTR: this.cfg.dynamictopPtr,

      // Heap management
      _emscripten_get_heap_size: () => container.heapU8.length,  // Matches emscripten glue js
      _emscripten_resize_heap: (size) => false,  // TODO
      _emscripten_memcpy_big: (dst, src, num) => container.heapU8.set(container.heapU8.subarray(src, src + num), dst),

      // Error handling
      _systemError: (msg) => { throw new Error(container.read(msg)); },
      abortOnCannotGrowMemory: (size)  => { throw new Error(`abortOnCannotGrowMemory(${size})`); },

      // Logging
      _setLogInfo: (file, line) => container.logInfo = [container.read(file), line],
      ___syscall146: (which, varargs) => container.sysWritev(which, varargs),
    });
  }

  initializeInstance(container: WasmContainer, instance: WebAssembly.Instance) {
    // Emscripten doesn't need main() invoked
  }
}

class KotlinWasmDriver implements WasmDriver {
  configureEnvironment(module: WebAssembly.Module, container: WasmContainer, env: {}) {
    Object.assign(env, {
      // These two are used by launcher.cpp
      Konan_js_arg_size: (index) => 1,
      Konan_js_fetch_arg: (index, ptr) => 'dummyArg',

      // These two are imported, but never used
      Konan_js_allocateArena: (array) => {},
      Konan_js_freeArena: (arenaIndex) => {},

      // These two are used by logging functions
      write: (ptr) => console.log(container.read(ptr)),
      flush: () => {},

      // Apparently used by Kotlin Memory management
      Konan_notify_memory_grow: () => this.updateMemoryViews(container),

      // Kotlin's own glue for abort and exit
      Konan_abort: (pointer) => { throw new Error('Konan_abort(' + container.read(pointer) + ')'); },
      Konan_exit: (status) => {},

      // Needed by some code that tries to get the current time in it's runtime
      Konan_date_now: (pointer) => {
        const now = Date.now();
        const high = Math.floor(now / 0xffffffff);
        const low = Math.floor(now % 0xffffffff);
        container.heap32[pointer] = low;
        container.heap32[pointer + 1] = high;
      },
    });
  }

  // Kotlin manages its own heap construction, as well as tables.
  initializeInstance(container: WasmContainer, instance: WebAssembly.Instance) {
    this.updateMemoryViews(container);
    // Kotlin main() must be invoked before everything else.
    instance.exports.Konan_js_main(1, 0);
  }

  updateMemoryViews(container: WasmContainer) {
    container.memory = container.exports.memory;
    container.heapU8 = new Uint8Array(container.memory.buffer);
    container.heap32 = new Int32Array(container.memory.buffer);
  }
}

type WasmAddress = number;

// Holds an instance of a running wasm module, which may contain multiple particles.
export class WasmContainer {
  memory: WebAssembly.Memory;
  heapU8: Uint8Array;
  heap32: Int32Array;
  private wasm: WebAssembly.Instance;
  // tslint:disable-next-line: no-any
  exports: any;
  private particleMap = new Map<WasmAddress, WasmParticle>();

  // Records file and line for console logging in C++. This is set by the console/error macros in
  // arcs.h and used immediately in the following printf call (implemented by sysWritev() below).
  logInfo: [string, number]|null = null;

  async initialize(buffer: ArrayBuffer) {
    // TODO: vet the imports/exports on 'module'
    // TODO: use compileStreaming? requires passing the fetch() Response, not its ArrayBuffer
    const module = await WebAssembly.compile(buffer);
    const driver = this.driverForModule(module);

    // Shared ENV between Emscripten and Kotlin
    const env = {
      abort: () => { throw new Error('Abort!'); },

      // Inner particle API
      _singletonSet: (p, h, encoded) => this.getParticle(p).singletonSet(h, encoded),
      _singletonClear: (p, h) => this.getParticle(p).singletonClear(h),
      _collectionStore: (p, h, encoded) => this.getParticle(p).collectionStore(h, encoded),
      _collectionRemove: (p, h, encoded) => this.getParticle(p).collectionRemove(h, encoded),
      _collectionClear: (p, h) => this.getParticle(p).collectionClear(h),
      _render: (p, slotName, template, model) => this.getParticle(p).renderImpl(slotName, template, model),
    };

    driver.configureEnvironment(module, this, env);

    const global = {'NaN': NaN, 'Infinity': Infinity};

    this.wasm = await WebAssembly.instantiate(module, {env, global});
    this.exports = this.wasm.exports;
    driver.initializeInstance(this, this.wasm);
  }

  private driverForModule(module: WebAssembly.Module): WasmDriver {
    const customSections = WebAssembly.Module.customSections(module, 'emscripten_metadata');
    if (customSections.length === 1) {
      return new EmscriptenWasmDriver(customSections[0]);
    }
    return new KotlinWasmDriver();
  }

  private getParticle(innerParticle: WasmAddress): WasmParticle {
    return this.particleMap.get(innerParticle);
  }

  register(particle: WasmParticle, innerParticle: WasmAddress) {
    this.particleMap.set(innerParticle, particle);
  }

  // Allocates memory in the wasm container.
  store(str: string): WasmAddress {
    const p = this.exports._malloc(str.length + 1);
    for (let i = 0; i < str.length; i++) {
      this.heapU8[p + i] = str.charCodeAt(i);
    }
    this.heapU8[p + str.length] = 0;
    return p;
  }

  // Currently only supports ASCII. TODO: unicode
  read(idx: WasmAddress): string {
    let str = '';
    while (idx < this.heapU8.length && this.heapU8[idx] !== 0) {
      str += String.fromCharCode(this.heapU8[idx++]);
    }
    return str;
  }

  // C++ printf support cribbed from emscripten glue js - currently only supports ASCII
  sysWritev(which, varargs) {
    const get = () => {
      varargs += 4;
      return this.heap32[(((varargs)-(4))>>2)];
    };

    const output = (get() === 1) ? console.log : console.error;
    const iov = get();
    const iovcnt = get();

    // TODO: does this need to be persistent across calls? (i.e. due to write buffering)
    let str = this.logInfo ? `[${this.logInfo[0]}:${this.logInfo[1]}] ` : '';
    let ret = 0;
    for (let i = 0; i < iovcnt; i++) {
      const ptr = this.heap32[(((iov)+(i*8))>>2)];
      const len = this.heap32[(((iov)+(i*8 + 4))>>2)];
      for (let j = 0; j < len; j++) {
        const curr = this.heapU8[ptr+j];
        if (curr === 0 || curr === 10) {  // NUL or \n
          output(str);
          str = '';
        } else {
          str += String.fromCharCode(curr);
        }
      }
      ret += len;
    }
    this.logInfo = null;
    return ret;
  }
}

// Creates and interfaces to a particle inside a WasmContainer's module.
export class WasmParticle extends Particle {
  private container: WasmContainer;
  // tslint:disable-next-line: no-any
  private exports: any;
  private innerParticle: WasmAddress;
  private handleMap = new Map<Handle, WasmAddress>();
  private revHandleMap = new Map<WasmAddress, Handle>();
  private converters = new Map<Handle, EntityPackager>();

  constructor(container: WasmContainer) {
    super();
    this.container = container;
    this.exports = container.exports;
    this.innerParticle = this.exports[`_new${this.spec.name}`]();
    container.register(this, this.innerParticle);
 }

  // TODO: for now we set up Handle objects with onDefineHandle and map them into the
  // wasm container through this call, which creates corresponding Handle objects in there.
  // That means entity transfer goes from the StorageProxy, deserializes at the outer Handle
  // which then notifies this class (calling onHandle*), and we then serialize into the wasm
  // transfer format. Obviously this can be improved.
  async setHandles(handles: ReadonlyMap<string, Handle>) {
    for (const [name, handle] of handles) {
      const p = this.container.store(name);
      const wasmHandle = this.exports._connectHandle(this.innerParticle, p, handle.canRead, handle.canWrite);
      this.exports._free(p);
      if (wasmHandle === 0) {
        throw new Error(`Wasm particle failed to connect handle '${name}'`);
      }
      this.handleMap.set(handle, wasmHandle);
      this.revHandleMap.set(wasmHandle, handle);
      this.converters.set(handle, new EntityPackager(handle.entityClass.schema));
    }
  }

  async onHandleSync(handle: Handle, model) {
    const wasmHandle = this.handleMap.get(handle);
    if (!model) {
      this.exports._syncHandle(this.innerParticle, wasmHandle, 0);
      return;
    }
    const converter = this.converters.get(handle);
    if (!converter) {
      throw new Error('cannot find handle ' + handle.name);
    }
    let encoded;
    if (handle instanceof Singleton) {
      encoded = converter.encodeSingleton(model);
    } else {
      encoded = converter.encodeCollection(model);
    }
    const p = this.container.store(encoded);
    this.exports._syncHandle(this.innerParticle, wasmHandle, p);
    this.exports._free(p);
  }

  // tslint:disable-next-line: no-any
  async onHandleUpdate(handle: Handle, update: {data?: any, oldData?: any, added?: any, removed?: any, originator?: any}) {
    if (update.originator) {
      return;
    }
    const wasmHandle = this.handleMap.get(handle);
    const converter = this.converters.get(handle);
    if (!converter) {
      throw new Error('cannot find handle ' + handle.name);
    }

    let p1 = 0;
    let p2 = 0;
    if (handle instanceof Singleton) {
      if (update.data) {
        p1 = this.container.store(converter.encodeSingleton(update.data));
      }
    } else {
      p1 = this.container.store(converter.encodeCollection(update.added || []));
      p2 = this.container.store(converter.encodeCollection(update.removed || []));
    }
    this.exports._updateHandle(this.innerParticle, wasmHandle, p1, p2);
    if (p1) this.exports._free(p1);
    if (p2) this.exports._free(p2);
  }

  // Ignored for wasm particles.
  async onHandleDesync(handle: Handle) {}

  // Store API.
  //
  // Each of these calls an async storage method, but we don't want to await them because returning
  // a Promise to wasm doesn't work, and control (surprisingly) returns to the calling wasm function
  // at the first await point anyway. However, our CRDTs make it safe to fire-and-forget the storage
  // updates, and the wasm handles already have the updated version of the stored data, so it's safe
  // to leave the promises floating.

  // If the given entity doesn't have an id, this will create one for it and return the new id
  // in allocated memory that the wasm particle must free. If the entity already has an id this
  // returns 0 (nulltpr).
  singletonSet(wasmHandle: WasmAddress, encoded: WasmAddress): WasmAddress {
    const singleton = this.getHandle(wasmHandle) as Singleton;
    const entity = this.decodeEntity(singleton, encoded);
    const p = this.ensureIdentified(entity, singleton);
    void singleton.set(entity);
    return p;
  }

  singletonClear(wasmHandle: WasmAddress) {
    const singleton = this.getHandle(wasmHandle) as Singleton;
    void singleton.clear();
  }

  // If the given entity doesn't have an id, this will create one for it and return the new id
  // in allocated memory that the wasm particle must free. If the entity already has an id this
  // returns 0 (nulltpr).
  collectionStore(wasmHandle: WasmAddress, encoded: WasmAddress): WasmAddress {
    const collection = this.getHandle(wasmHandle) as Collection;
    const entity = this.decodeEntity(collection, encoded);
    const p = this.ensureIdentified(entity, collection);
    void collection.store(entity);
    return p;
  }

  collectionRemove(wasmHandle: WasmAddress, encoded: WasmAddress) {
    const collection = this.getHandle(wasmHandle) as Collection;
    void collection.remove(this.decodeEntity(collection, encoded));
  }

  collectionClear(wasmHandle: WasmAddress) {
    const collection = this.getHandle(wasmHandle) as Collection;
    void collection.clear();
  }

  private getHandle(wasmHandle: WasmAddress) {
    const handle = this.revHandleMap.get(wasmHandle);
    if (!handle) {
      throw new Error(`wasm particle '${this.spec.name}' attempted to write to unconnected handle`);
    }
    return handle;
  }

  private decodeEntity(handle: Handle, encoded: WasmAddress): Entity {
    const converter = this.converters.get(handle);
    return converter.decodeSingleton(this.container.read(encoded));
  }

  private ensureIdentified(entity: Entity, handle: Handle): WasmAddress {
    let p = 0;
    if (!Entity.isIdentified(entity)) {
      handle.createIdentityFor(entity);
      p = this.container.store(Entity.id(entity));
    }
    return p;
  }

  // Called by the shell to initiate rendering; the particle will call env._render in response.
  renderSlot(slotName: string, contentTypes: string[]) {
    const p = this.container.store(slotName);
    const sendTemplate = contentTypes.includes('template');
    const sendModel = contentTypes.includes('model');
    this.exports._renderSlot(this.innerParticle, p, sendTemplate, sendModel);
    this.exports._free(p);
  }

  // TODO
  renderHostedSlot(slotName: string, hostedSlotId: string, content: string) {}

  // Actually renders the slot. May be invoked due to an external request via renderSlot(),
  // or directly from the wasm particle itself (e.g. in response to a data update).
  // template is a string provided by the particle. model is an encoded key:value dictionary.
  renderImpl(slotName: WasmAddress, template: WasmAddress, model: WasmAddress) {
    const slot = this.slotProxiesByName.get(this.container.read(slotName));
    if (slot) {
      const content: Content = {templateName: 'default'};
      if (template) {
        content.template = this.container.read(template);
        slot.requestedContentTypes.add('template');
      }
      if (model) {
        content.model = new StringDecoder().decodeDictionary(this.container.read(model));
        slot.requestedContentTypes.add('model');
      }
      slot.render(content);
    }
  }

  fireEvent(slotName: string, event) {
    const sp = this.container.store(slotName);
    const hp = this.container.store(event.handler);
    this.exports._fireEvent(this.innerParticle, sp, hp);
    this.exports._free(sp);
    this.exports._free(hp);
  }
}
