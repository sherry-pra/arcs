/**
 * @license
 * Copyright (c) 2017 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {parse} from '../../gen/runtime/manifest-parser.js';
import {assert} from '../../platform/chai-web.js';
import {fs} from '../../platform/fs-web.js';
import {path} from '../../platform/path-web.js';
import {Manifest} from '../manifest.js';
import {Schema} from '../schema.js';
import {CollectionStorageProvider} from '../storage/storage-provider-base.js';
import {checkDefined, checkNotNull} from '../testing/preconditions.js';
import {StubLoader} from '../testing/stub-loader.js';
import {Dictionary} from '../hot.js';
import {assertThrowsAsync} from '../testing/test-util.js';
import {ClaimType, ClaimIsTag, ClaimDerivesFrom} from '../particle-claim.js';
import {CheckHasTag, CheckBooleanExpression} from '../particle-check.js';
import {ProvideSlotConnectionSpec} from '../particle-spec.js';

async function assertRecipeParses(input: string, result: string) : Promise<void> {
  // Strip common leading whitespace.
  //result = result.replace(new Regex(`()^|\n)${result.match(/^ */)[0]}`), '$1'),
  const target = (await Manifest.parse(result)).recipes[0].toString();
  assert.deepEqual((await Manifest.parse(input)).recipes[0].toString(), target);
}

function verifyPrimitiveType(field, type) {
  const copy = {...field};
  delete copy.location;
  assert.deepEqual(copy, {kind: 'schema-primitive', type});
}

describe('manifest', () => {
  it('can parse a manifest containing a recipe', async () => {
    const manifest = await Manifest.parse(`
      schema S
        Text t
        description \`one-s\`
          plural \`many-ses\`
          value \`s:\${t}\`
      particle SomeParticle &work in 'some-particle.js'
        out S someParam

      recipe SomeRecipe &someVerb1 &someVerb2
        map #someHandle
        create #newHandle as handle0
        SomeParticle
          someParam -> #tag
        description \`hello world\`
          handle0 \`best handle\``);
    const verify = (manifest: Manifest) => {
      const particle = manifest.particles[0];
      assert.equal('SomeParticle', particle.name);
      assert.deepEqual(['work'], particle.verbs);
      const recipe = manifest.recipes[0];
      assert(recipe);
      assert.equal('SomeRecipe', recipe.name);
      assert.deepEqual(['someVerb1', 'someVerb2'], recipe.verbs);
      assert.sameMembers(manifest.findRecipesByVerb('someVerb1'), [recipe]);
      assert.sameMembers(manifest.findRecipesByVerb('someVerb2'), [recipe]);
      assert.lengthOf(recipe.particles, 1);
      assert.lengthOf(recipe.handles, 2);
      assert.equal(recipe.handles[0].fate, 'map');
      assert.equal(recipe.handles[1].fate, 'create');
      assert.lengthOf(recipe.handleConnections, 1);
      assert.sameMembers(recipe.handleConnections[0].tags, ['tag']);
      assert.lengthOf(recipe.patterns, 1);
      assert.equal(recipe.patterns[0], 'hello world');
      assert.equal(recipe.handles[1].pattern, 'best handle');
      const type = recipe.handleConnections[0]['_resolvedType'];
      assert.lengthOf(Object.keys(manifest.schemas), 1);
      const schema = Object.values(manifest.schemas)[0] as Schema;
      assert.lengthOf(Object.keys(schema.description), 3);
      assert.deepEqual(Object.keys(schema.description), ['pattern', 'plural', 'value']);
    };
    verify(manifest);
    // TODO(dstockwell): The connection between particles and schemas does
    //                   not roundtrip the same way.
    const type = manifest.recipes[0].handleConnections[0].type;
    assert.equal('one-s', type.toPrettyString());
    assert.equal('many-ses', type.collectionOf().toPrettyString());
    verify(await Manifest.parse(manifest.toString(), {}));
  });
  it('can parse a manifest containing a particle specification', async () => {
    const schemaStr = `
schema Product
schema Person
    `;
    const particleStr0 =
`particle TestParticle in 'testParticle.js'
  in [Product {}] list
  out Person {} person
  modality dom
  modality dom-touch
  must consume root #master #main
    formFactor big
    must provide action #large
      formFactor big
      handle list
    provide preamble
      formFactor medium
    provide annotation
  consume other
    provide set of myProvidedSetCell
  consume set of mySetCell
  description \`hello world \${list}\`
    list \`my special list\``;

    const particleStr1 =
`particle NoArgsParticle in 'noArgsParticle.js'
  modality dom`;
    const manifest = await Manifest.parse(`
${schemaStr}
${particleStr0}
${particleStr1}
    `);
    const verify = (manifest: Manifest) => {
      assert.lengthOf(manifest.particles, 2);
      assert.equal(particleStr0, manifest.particles[0].toString());
      assert.equal(particleStr1, manifest.particles[1].toString());
    };
    verify(manifest);
    verify(await Manifest.parse(manifest.toString(), {}));
  });
  it('SLANDLES can parse a manifest containing a particle specification', async () => {
    const schemaStr = `
schema Product
schema Person
    `;
    const particleStr0 =
`particle TestParticle in 'testParticle.js'
  in [Product {}] list
  out Person {} person
  \`consume Slot {formFactor:big} root #master #main
    \`provide Slot {formFactor:big, handle:list} action #large
    \`provide Slot {formFactor:medium} preamble
    \`provide Slot annotation
  \`consume Slot other
    \`provide [Slot] myProvidedSetCell
  \`consume [Slot] mySetCell
  modality dom
  modality dom-touch
  description \`hello world \${list}\`
    list \`my special list\``;

    const particleStr1 =
`particle NoArgsParticle in 'noArgsParticle.js'
  modality dom`;
    const manifest = await Manifest.parse(`
${schemaStr}
${particleStr0}
${particleStr1}
    `);
    const verify = (manifest: Manifest) => {
      assert.lengthOf(manifest.particles, 2);
      assert.equal(particleStr0, manifest.particles[0].toString());
      assert.equal(particleStr1, manifest.particles[1].toString());
    };
    verify(manifest);
    verify(await Manifest.parse(manifest.toString(), {}));
  });
  it('can parse a manifest containing a particle with an argument list', async () => {
    const manifest = await Manifest.parse(`
    particle TestParticle in 'a.js'
      in [Product {}] list
      out Person {} person
      consume thing
        provide otherThing
    `);
    assert.lengthOf(manifest.particles, 1);
    assert.lengthOf(manifest.particles[0].handleConnections, 2);
  });
  it('SLANDLES can parse a manifest containing a particle with an argument list', async () => {
    const manifest = await Manifest.parse(`
    particle TestParticle in 'a.js'
      in [Product {}] list
      out Person {} person
      \`consume Slot thing
        \`provide Slot otherThing
    `);
    assert.lengthOf(manifest.particles, 1);
    assert.lengthOf(manifest.particles[0].handleConnections, 4);
  });
  it('can parse a manifest with dependent handles', async () => {
    const manifest = await Manifest.parse(`
    particle TestParticle in 'a.js'
      in [Product {}] input
        out [Product {}] output
      consume thing
        provide otherThing
    `);
    assert.lengthOf(manifest.particles, 1);
    assert.lengthOf(manifest.particles[0].handleConnections, 2);
  });
  it('SLANDLES can parse a manifest with dependent handles', async () => {
    const manifest = await Manifest.parse(`
    particle TestParticle in 'a.js'
      in [Product {}] input
        out [Product {}] output
      \`consume Slot thing
        \`provide Slot otherThing
    `);
    assert.lengthOf(manifest.particles, 1);
    assert.lengthOf(manifest.particles[0].handleConnections, 4);
  });
  it('can round-trip particles with dependent handles', async () => {
    const manifestString = `particle TestParticle in 'a.js'
  in [Product {}] input
    out [Product {}] output
  modality dom
  consume thing
    provide otherThing`;

    const manifest = await Manifest.parse(manifestString);
    assert.lengthOf(manifest.particles, 1);
    assert.equal(manifestString, manifest.particles[0].toString());
  });
  it('SLANDLES can round-trip particles with dependent handles', async () => {
    const manifestString = `particle TestParticle in 'a.js'
  in [Product {}] input
    out [Product {}] output
  \`consume? Slot thing
    \`provide? Slot otherThing
  modality dom`;

    const manifest = await Manifest.parse(manifestString);
    assert.lengthOf(manifest.particles, 1);
    assert.equal(manifestString, manifest.particles[0].toString());
  });
  it('can parse a manifest containing a schema', async () => {
    const manifest = await Manifest.parse(`
      schema Bar
        Text value`);
    const verify = (manifest: Manifest) => verifyPrimitiveType(manifest.schemas.Bar.fields.value, 'Text');
    verify(manifest);
    verify(await Manifest.parse(manifest.toString(), {}));
  });
  it('can parse a manifest containing an extended schema', async () => {
    const manifest = await Manifest.parse(`
      schema Foo
        Text value
      schema Bar extends Foo`);
    const verify = (manifest: Manifest) => verifyPrimitiveType(manifest.schemas.Bar.fields.value, 'Text');
    verify(manifest);
    verify(await Manifest.parse(manifest.toString(), {}));
  });
  it('two manifests with stores with the same filename, store name and data have the same ids', async () => {
    const manifestA = await Manifest.parse(`
        store NobId of NobIdStore {Text nobId} in NobIdJson
        resource NobIdJson
          start
          [{"nobId": "12345"}]
        `, {fileName: 'the.manifest'});

    const manifestB = await Manifest.parse(`
        store NobId of NobIdStore {Text nobId} in NobIdJson
        resource NobIdJson
          start
          [{"nobId": "12345"}]
        `, {fileName: 'the.manifest'});

    assert.equal(manifestA.stores[0].id.toString(), manifestB.stores[0].id.toString());
  });
  it('two manifests with stores with the same filename and store name but different data have different ids', async () => {
    const manifestA = await Manifest.parse(`
        store NobId of NobIdStore {Text nobId} in NobIdJson
        resource NobIdJson
          start
          [{"nobId": "12345"}]
        `, {fileName: 'the.manifest'});

    const manifestB = await Manifest.parse(`
        store NobId of NobIdStore {Text nobId} in NobIdJson
         resource NobIdJson
           start
           [{"nobId": "67890"}]
          `, {fileName: 'the.manifest'});

    assert.notEqual(manifestA.stores[0].id.toString(), manifestB.stores[0].id.toString());
  });
  it('supports recipes with constraints', async () => {
    const manifest = await Manifest.parse(`
      schema S
      particle A
        in S a
      particle B
        in S b

      recipe Constrained
        A.a -> B.b`);
    const verify = (manifest) => {
      const recipe = manifest.recipes[0];
      assert(recipe);
      assert.lengthOf(recipe._connectionConstraints, 1);
      const constraint = recipe._connectionConstraints[0];
      assert.equal(constraint.from.particle.name, 'A');
      assert.equal(constraint.from.connection, 'a');
      assert.equal(constraint.to.particle.name, 'B');
      assert.equal(constraint.to.connection, 'b');
    };
    verify(manifest);
    verify(await Manifest.parse(manifest.toString(), {}));
  });
  it('supports recipes with constraints that reference handles', async () => {
    const manifest = await Manifest.parse(`
      particle A
        out S {} a

      recipe Constrained
        ? as localThing
        A.a -> localThing`);
    const verify = (manifest) => {
      const recipe = manifest.recipes[0];
      assert(recipe);
      assert.lengthOf(recipe.connectionConstraints, 1);
      const constraint = recipe.connectionConstraints[0];
      assert.equal(constraint.from.particle.name, 'A');
      assert.equal(constraint.from.connection, 'a');
      assert.equal(constraint.to.handle.localName, 'localThing');
    };
    verify(manifest);
    verify(await Manifest.parse(manifest.toString(), {}));
  });
  it('supports recipes with local names', async () => {
    const manifest = await Manifest.parse(`
      schema S
      particle P1
        out S x
        out S y
      particle P2
        out S x
        out S y

      recipe
        ? #things as thingHandle
        P1 as p1
          x -> thingHandle
        P2
          x -> thingHandle`);
    const deserializedManifest = (await Manifest.parse(manifest.toString(), {}));
  });
  // TODO: move these tests to new-recipe tests.
  it('can normalize simple recipes', async () => {
    const manifest = await Manifest.parse(`
      schema S
      particle P1
        out S x
      particle P2

      recipe
        ? as handle1
        P1
          x -> handle1
        P2
      recipe
        ? as someHandle
        P2
        P1
          x -> someHandle
        `, {});
    const [recipe1, recipe2] = manifest.recipes;
    assert.notEqual(recipe1.toString(), recipe2.toString());
    assert.notEqual(await recipe1.digest(), await recipe2.digest());
    recipe1.normalize();
    recipe2.normalize();
    assert.deepEqual(recipe1.toString(), recipe2.toString());
    assert.equal(await recipe1.digest(), await recipe2.digest());

    const deserializedManifest = await Manifest.parse(manifest.toString(), {});
  });
  it('can normalize recipes with interdependent ordering of handles and particles', async () => {
    const manifest = await Manifest.parse(`
      schema S
      particle P1
        out S x

      recipe
        use as handle1
        use as handle2
        P1
          x -> handle1
        P1
          x -> handle2
      recipe
        use as handle1
        use as handle2
        P1
          x -> handle2
        P1
          x -> handle1`);
    const [recipe1, recipe2] = manifest.recipes;
    assert.notEqual(recipe1.toString(), recipe2.toString());
    recipe1.normalize();
    recipe2.normalize();
    assert.deepEqual(recipe1.toString(), recipe2.toString());
  });
  it('can resolve recipe particles defined in the same manifest', async () => {
    const manifest = await Manifest.parse(`
      schema Something
      schema Someother
      particle Thing in 'thing.js'
        in [Something] someThings
        out [Someother] someOthers
      recipe
        Thing`);
    const verify = (manifest: Manifest) => assert(manifest.recipes[0].particles[0].spec);
    verify(manifest);
    verify(await Manifest.parse(manifest.toString(), {}));
  });
  it('treats a failed import as non-fatal', async () => { // TODO(cypher1): Review this.
    const loader = new StubLoader({
      'a': `import 'b'`,
      'b': `lol what is this`,
    });
    await Manifest.load('a', loader);
  });
  it('throws an error when a particle has invalid description', async () => {
    try {
      const manifest = await Manifest.parse(`
        schema Foo
        particle Thing in 'thing.js'
          in Foo foo
          description \`Does thing\`
            bar \`my-bar\``);
      assert(false);
    } catch (e) {
      assert.equal(e.message, 'Unexpected description for bar');
    }
  });
  it('can load a manifest via a loader', async () => {
    const registry: Dictionary<Promise<Manifest>> = {};

    const loader = new StubLoader({'*': 'recipe'});
    const manifest = await Manifest.load('some-path', loader, {registry});
    assert(manifest.recipes[0]);
    assert.equal(manifest, await registry['some-path']);
  });
  it('can load a manifest with imports', async () => {
    const registry: Dictionary<Promise<Manifest>> = {};
    const loader = new StubLoader({
      a: `import 'b'`,
      b: `recipe`,
    });
    const manifest = await Manifest.load('a', loader, {registry});
    assert.equal(await registry.a, manifest);
    assert.equal(manifest.imports[0], await registry.b);
  });
  it('can resolve recipe particles imported from another manifest', async () => {
    const registry: Dictionary<Promise<Manifest>> = {};
    const loader = new StubLoader({
      a: `
        import 'b'
        recipe
          ParticleB`,
      b: `
        schema Thing
        particle ParticleB in 'b.js'
          in Thing thing`
    });
    const manifest = await Manifest.load('a', loader, {registry});
    assert.isTrue(manifest.recipes[0].particles[0].spec.equals((await registry.b).findParticleByName('ParticleB')));
  });
  it('can parse a schema extending a schema in another manifest', async () => {
    const registry = {};
    const loader = new StubLoader({
      a: `
          import 'b'
          schema Bar extends Foo`,
      b: `
          schema Foo
            Text value`
    });
    const manifest = await Manifest.load('a', loader, {registry});
    verifyPrimitiveType(manifest.schemas.Bar.fields.value, 'Text');
  });
  it('can find all imported recipes', async () => {
    const loader = new StubLoader({
      a: `
          import 'b'
          import 'c'
          recipe`,
      b: `
          import 'c'
          recipe`,
      c: `recipe`,
    });
    const manifest = await Manifest.load('a', loader);
    assert.lengthOf(manifest.allRecipes, 3);
  });
  it('can parse a schema with union typing', async () => {
    const manifest = await Manifest.parse(`
      schema Foo
        (Text or URL) u
        Text test
        (Number, Number, Boolean) t`);
    const verify = (manifest: Manifest) => {
      const opt = manifest.schemas.Foo.fields;
      assert.equal(opt.u.kind, 'schema-union');
      verifyPrimitiveType(opt.u.types[0], 'Text');
      verifyPrimitiveType(opt.u.types[1], 'URL');
      assert.equal(opt.t.kind, 'schema-tuple');
      verifyPrimitiveType(opt.t.types[0], 'Number');
      verifyPrimitiveType(opt.t.types[1], 'Number');
      verifyPrimitiveType(opt.t.types[2], 'Boolean');
    };
    verify(manifest);
    verify(await Manifest.parse(manifest.toString()));
  });
  it('can parse a manifest containing a recipe with slots', async () => {
    const manifest = await Manifest.parse(`
      schema Thing
      particle SomeParticle in 'some-particle.js'
        in Thing someParam
        consume mySlot
          formFactor big
          provide otherSlot
            handle someParam
          provide oneMoreSlot
            formFactor small

      particle OtherParticle
        out Thing aParam
        consume mySlot
        consume oneMoreSlot

      recipe SomeRecipe
        ? #someHandle1 as myHandle
        slot 'slotIDs:A' #someSlot as slot0
        SomeParticle
          someParam <- myHandle
          consume mySlot as slot0
            provide otherSlot as slot2
            provide oneMoreSlot as slot1
        OtherParticle
          aParam -> myHandle
          consume mySlot as slot0
          consume oneMoreSlot as slot1
    `);
    const verify = (manifest: Manifest) => {
      const recipe = manifest.recipes[0];
      assert(recipe);
      recipe.normalize();

      assert.lengthOf(recipe.particles, 2);
      assert.lengthOf(recipe.handles, 1);
      assert.lengthOf(recipe.handleConnections, 2);
      assert.lengthOf(recipe.slots, 3);
      assert.lengthOf(recipe.slotConnections, 3);
      assert.lengthOf(Object.keys(recipe.particles[0].consumedSlotConnections), 2);
      assert.lengthOf(Object.keys(recipe.particles[1].consumedSlotConnections), 1);
      const mySlot = recipe.particles[1].consumedSlotConnections['mySlot'];
      assert.isDefined(mySlot.targetSlot);
      assert.lengthOf(Object.keys(mySlot.providedSlots), 2);
      assert.equal(mySlot.providedSlots['oneMoreSlot'], recipe.particles[0].consumedSlotConnections['oneMoreSlot'].targetSlot);
    };
    verify(manifest);
    verify(await Manifest.parse(manifest.toString()));
  });
  it('SLANDLES can parse a manifest containing a recipe with slots', async () => {
    const manifest = await Manifest.parse(`
      schema Thing
      particle SomeParticle in 'some-particle.js'
        in Thing someParam
        \`consume Slot {formFactor: big} mySlot
          \`provide Slot {handle: someParam} otherSlot
          \`provide Slot {formFactor: small} oneMoreSlot

      particle OtherParticle
        out Thing aParam
        \`consume Slot mySlot
        \`consume Slot oneMoreSlot

      recipe SomeRecipe
        ? #someHandle1 as myHandle
        \`slot 'slotIDs:A' #someSlot as slot0
        SomeParticle
          someParam <- myHandle
          mySlot consume slot0
          otherSlot provide slot2
          oneMoreSlot provide slot1
        OtherParticle
          aParam -> myHandle
          mySlot consume slot0
          oneMoreSlot consume slot1
    `);
    const verify = (manifest: Manifest) => {
      const recipe = manifest.recipes[0];
      assert(recipe);
      recipe.normalize();

      assert.lengthOf(recipe.particles, 2);
      assert.lengthOf(recipe.handles, 4);
      assert.lengthOf(recipe.handleConnections, 7);
      const mySlot = checkDefined(recipe.particles[1].connections['mySlot'].handle);
      assert.lengthOf(mySlot.connections, 2);
      assert.equal(mySlot.connections[0], recipe.particles[0].connections['mySlot']);
    };
    verify(manifest);
    verify(await Manifest.parse(manifest.toString()));
  });
  it('unnamed consume slots', async () => {
    const manifest = await Manifest.parse(`
      particle SomeParticle &work in 'some-particle.js'
        consume slotA
      particle SomeParticle1 &rest in 'some-particle.js'
        consume slotC

      recipe
        SomeParticle
          consume slotA
        SomeParticle1
          consume slotC
    `);
    const recipe = manifest.recipes[0];
    assert.lengthOf(recipe.slotConnections, 2);
    assert.isEmpty(recipe.slots);
  });
  it('SLANDLES unnamed consume slots', async () => {
    const manifest = await Manifest.parse(`
      particle SomeParticle &work in 'some-particle.js'
        \`consume Slot slotA
      particle SomeParticle1 &rest in 'some-particle.js'
        \`consume Slot slotC

      recipe
        SomeParticle
          slotA consume
        SomeParticle1
          slotC consume
    `);
    const recipe = manifest.recipes[0];
    assert.lengthOf(recipe.handleConnections, 2);
    assert.isEmpty(recipe.handles);
  });
  it('multiple consumed slots', async () => {
    const parseRecipe = async (arg: {label: string, isRequiredSlotA: boolean, isRequiredSlotB: boolean, expectedIsResolved: boolean}) => {
      const recipe = (await Manifest.parse(`
        particle SomeParticle in 'some-particle.js'
          ${arg.isRequiredSlotA ? 'must ' : ''}consume slotA
          ${arg.isRequiredSlotB ? 'must ' : ''}consume slotB

        recipe
          slot 'slota-0' as s0
          SomeParticle
            consume slotA as s0
      `)).recipes[0];
      recipe.normalize();
      const options = {errors: new Map(), details: '', showUnresolved: true};
      assert.equal(recipe.isResolved(options), arg.expectedIsResolved, `${arg.label}: Expected recipe to be ${arg.expectedIsResolved ? '' : 'un'}resolved.\nErrors: ${JSON.stringify([...options.errors, options.details])}`);
    };
    await parseRecipe({label: '1', isRequiredSlotA: false, isRequiredSlotB: false, expectedIsResolved: true});
    await parseRecipe({label: '2', isRequiredSlotA: true, isRequiredSlotB: false, expectedIsResolved: true});
    await parseRecipe({label: '3', isRequiredSlotA: false, isRequiredSlotB: true, expectedIsResolved: false});
    await parseRecipe({label: '4', isRequiredSlotA: true, isRequiredSlotB: true, expectedIsResolved: false});
  });
  it('SLANDLES multiple consumed slots', async () => {
    const parseRecipe = async (arg: {label: string, isRequiredSlotA: boolean, isRequiredSlotB: boolean, expectedIsResolved: boolean}) => {
      const recipe = (await Manifest.parse(`
        particle SomeParticle in 'some-particle.js'
          \`consume${arg.isRequiredSlotA ? '' : '?'} Slot slotA
          \`consume${arg.isRequiredSlotB ? '' : '?'} Slot slotB

        recipe
          \`slot 'slota-0' as s0
          SomeParticle
            slotA consume s0
      `)).recipes[0];
      const options = {errors: new Map(), details: '', showUnresolved: true};
      recipe.normalize(options);
      console.log(recipe.obligations);
      assert.equal(recipe.isResolved(options), arg.expectedIsResolved, `${arg.label}: Expected recipe to be ${arg.expectedIsResolved ? '' : 'un'}resolved.\nErrors: ${JSON.stringify([...options.errors, options.details])}`);
    };
    await parseRecipe({label: '1', isRequiredSlotA: false, isRequiredSlotB: false, expectedIsResolved: true});
    await parseRecipe({label: '2', isRequiredSlotA: true, isRequiredSlotB: false, expectedIsResolved: true});
    await parseRecipe({label: '3', isRequiredSlotA: false, isRequiredSlotB: true, expectedIsResolved: false});
    await parseRecipe({label: '4', isRequiredSlotA: true, isRequiredSlotB: true, expectedIsResolved: false});
  });
  it('recipe slots with tags', async () => {
    const manifest = await Manifest.parse(`
      particle SomeParticle in 'some-particle.js'
        consume slotA #aaa
          provide slotB #bbb
      recipe
        slot 'slot-id0' #aa #aaa as s0
        SomeParticle
          consume slotA #aa #hello as s0
            provide slotB
    `);
    // verify particle spec
    assert.lengthOf(manifest.particles, 1);
    const spec = manifest.particles[0];
    assert.equal(spec.slotConnections.size, 1);
    const slotSpec = [...spec.slotConnections.values()][0];
    assert.deepEqual(slotSpec.tags, ['aaa']);
    assert.lengthOf(slotSpec.provideSlotConnections, 1);
    const providedSlotSpec = slotSpec.provideSlotConnections[0];
    assert.deepEqual(providedSlotSpec.tags, ['bbb']);

    // verify recipe slots
    assert.lengthOf(manifest.recipes, 1);
    const recipe = manifest.recipes[0];
    assert.lengthOf(recipe.slots, 2);
    const recipeSlot = checkDefined(recipe.slots.find(s => s.id === 'slot-id0'));
    assert.deepEqual(recipeSlot.tags, ['aa', 'aaa']);

    const slotConn = recipe.particles[0].consumedSlotConnections['slotA'];
    assert(slotConn);
    assert.deepEqual(['aa', 'hello'], slotConn.tags);
    assert.lengthOf(Object.keys(slotConn.providedSlots), 1);
  });
  it('SLANDLES recipe slots with tags', async () => {
    const manifest = await Manifest.parse(`
      particle SomeParticle in 'some-particle.js'
        \`consume Slot slotA #aaa
          \`provide Slot slotB #bbb
      recipe
        \`slot 'slot-id0' #aa #aaa as s0
        SomeParticle
          slotA consume s0 #aa #hello
          slotB provide
    `);
    // verify particle spec
    assert.lengthOf(manifest.particles, 1);
    const spec = manifest.particles[0];
    assert.lengthOf(spec.handleConnections, 2);
    const slotSpec = spec.handleConnections[0];
    assert.deepEqual(slotSpec.tags, ['aaa']);
    assert.lengthOf(slotSpec.dependentConnections, 1);
    const providedSlotSpec = slotSpec.dependentConnections[0];
    assert.deepEqual(providedSlotSpec.tags, ['bbb']);

    // verify recipe slots
    assert.lengthOf(manifest.recipes, 1);
    const recipe = manifest.recipes[0];
    assert.lengthOf(recipe.handles, 1);
    const recipeSlot = checkDefined(recipe.handles.find(s => s.id === 'slot-id0'));
    assert.deepEqual(recipeSlot.tags, ['aa', 'aaa']);

    const slotConn = checkDefined(recipe.particles[0].connections['slotA']);
    assert.deepEqual(['aa', 'hello'], slotConn.tags);
  });
  it('recipe slots with different names', async () => {
    const manifest = await Manifest.parse(`
      particle ParticleA in 'some-particle.js'
        consume slotA
      particle ParticleB in 'some-particle.js'
        consume slotB1
          provide slotB2
      recipe
        slot 'slot-id0' as s0
        ParticleA
          consume slotA as mySlot
        ParticleB
          consume slotB1 as s0
            provide slotB2 as mySlot
    `);
    assert.lengthOf(manifest.particles, 2);
    assert.lengthOf(manifest.recipes, 1);
    const recipe = manifest.recipes[0];
    assert.lengthOf(recipe.slots, 2);
    assert.equal(checkDefined(recipe.particles.find(p => p.name === 'ParticleB')).consumedSlotConnections['slotB1'].providedSlots['slotB2'],
                 checkDefined(recipe.particles.find(p => p.name === 'ParticleA')).consumedSlotConnections['slotA'].targetSlot);
    recipe.normalize();
    assert.isTrue(recipe.isResolved());
  });
  it('SLANDLES recipe slots with different names', async () => {
    const manifest = await Manifest.parse(`
      particle ParticleA in 'some-particle.js'
        \`consume Slot slotA
      particle ParticleB in 'some-particle.js'
        \`consume Slot slotB1
          \`provide Slot slotB2
      recipe
        \`slot 'slot-id0' as s0
        ParticleA
          slotA consume mySlot
        ParticleB
          slotB1 consume s0
          slotB2 provide mySlot
    `);
    assert.lengthOf(manifest.particles, 2);
    assert.lengthOf(manifest.recipes, 1);
    const recipe = manifest.recipes[0];
    assert.lengthOf(recipe.handles, 2);
    assert.equal(
      checkDefined(recipe.particles.find(p => p.name === 'ParticleA')).connections['slotA'].handle,
      checkDefined(recipe.particles.find(p => p.name === 'ParticleB')).connections['slotB2'].handle);

    const options = {errors: new Map(), details: '', showUnresolved: true};
    recipe.normalize(options);
    assert.isTrue(recipe.isResolved(options), `Expected recipe to be resolved.\n\t ${JSON.stringify([...options.errors])}`);
  });
  it('recipe provided slot with no local name', async () => {
    const manifest = await Manifest.parse(`
      particle ParticleA in 'some-particle.js'
        consume slotA1
          provide slotA2
      recipe
        ParticleA
          consume slotA1
            provide slotA2
    `);
    assert.lengthOf(manifest.particles, 1);
    assert.lengthOf(manifest.recipes, 1);
    const recipe = manifest.recipes[0];
    assert.lengthOf(recipe.slots, 1);
    assert.equal('slotA2', recipe.slots[0].name);
    assert.isUndefined(recipe.particles[0].consumedSlotConnections['slotA1'].targetSlot);
    recipe.normalize();
    assert.isFalse(recipe.isResolved());
  });
  it('SLANDLES recipe provided slot with no local name', async () => {
    const manifest = await Manifest.parse(`
      particle ParticleA in 'some-particle.js'
        \`consume Slot slotA1
          \`provide Slot slotA2
      recipe
        ParticleA
          slotA1 consume
          slotA2 provide
    `);
    // Check that the manifest was parsed in the way we expect.
    assert.lengthOf(manifest.particles, 1);
    assert.lengthOf(manifest.recipes, 1);

    const recipe = manifest.recipes[0];
    // Check that the parser found the handleConnections
    assert.lengthOf(recipe.handleConnections, 2);
    assert.equal('slotA1', recipe.handleConnections[0].name);
    assert.equal('slotA2', recipe.handleConnections[1].name);

    // Check that the handle connection
    // wasn't resolved to a handle (even though it was parsed).
    assert.isUndefined(recipe.handleConnections[0].handle);
    assert.isUndefined(recipe.handleConnections[1].handle);

    // The recipe shouldn't resolve (as there is nothing providing slotA1 or
    // consuming slotA2).
    recipe.normalize();
    assert.isFalse(recipe.isResolved());
  });
  it('incomplete aliasing', async () => {
    const recipe = (await Manifest.parse(`
      particle P1 in 'some-particle.js'
        consume slotA
          provide slotB
      particle P2 in 'some-particle.js'
        consume slotB
      recipe
        P1
          consume slotA
            provide slotB as s1
        P2
          consume slotB as s1
    `)).recipes[0];
    recipe.normalize();

    assert.lengthOf(recipe.slotConnections, 2);
    const slotConnA = checkDefined(recipe.slotConnections.find(s => s.name === 'slotA'));

    // possible bogus assert?
    assert.isUndefined(slotConnA['sourceConnection']);

    assert.lengthOf(recipe.slots, 1);
    const slotB = recipe.slots[0];
    assert.equal('slotB', slotB.name);
    assert.lengthOf(slotB.consumeConnections, 1);
    assert.equal(slotB.sourceConnection, slotConnA);
  });
  it('SLANDLES incomplete aliasing', async () => {
    const recipe = (await Manifest.parse(`
      particle P1 in 'some-particle.js'
        \`consume Slot slotA
          \`provide Slot slotB
      particle P2 in 'some-particle.js'
        \`consume Slot slotB
      recipe
        P1
          slotA consume
          slotB provide s1
        P2
          slotB consume s1
    `)).recipes[0];
    recipe.normalize();

    assert.lengthOf(recipe.handleConnections, 3);
    const slotConnA = checkDefined(recipe.handleConnections.find(s => s.name === 'slotA'));
    assert.isUndefined(slotConnA.handle);

    assert.lengthOf(recipe.handles, 1);
    const slotB = recipe.handles[0];
    assert.lengthOf(slotB.connections, 2);

    assert.equal(slotB.connections[0].name, 'slotB');
    assert.equal(slotB.connections[1].name, 'slotB');

    const directions = slotB.connections.map(c => c.direction);
    assert.lengthOf(directions, 2);
    assert.include(directions, '`provide');
    assert.include(directions, '`consume');
  });
  it('parses local slots with IDs', async () => {
    const recipe = (await Manifest.parse(`
      particle P1 in 'some-particle.js'
        consume slotA
          provide slotB
      particle P2 in 'some-particle.js'
        consume slotB
      recipe
        slot 'rootslot-0' as slot0
        slot 'local-slot-0' as slot1
        P1
          consume slotA as slot0
            provide slotB as slot1
        P2
          consume slotB as slot1
    `)).recipes[0];
    recipe.normalize();
    assert.lengthOf(recipe.slots, 2);
  });
  it('SLANDLES parses local slots with IDs', async () => {
    const recipe = (await Manifest.parse(`
      particle P1 in 'some-particle.js'
        \`consume Slot slotA
          \`provide Slot slotB
      particle P2 in 'some-particle.js'
        \`consume Slot slotB
      recipe
        \`slot 'rootslot-0' as slot0
        \`slot 'local-slot-0' as slot1
        P1
          slotA consume slot0
          slotB provide slot1
        P2
          slotB consume slot1
    `)).recipes[0];
    recipe.normalize();
    assert.lengthOf(recipe.handles, 2);
  });
  it('relies on the loader to combine paths', async () => {
    const registry = {};
    const loader = new class extends StubLoader {
      constructor() {
        super({
      'somewhere/a': `import 'path/b'`,
      'somewhere/a path/b': `recipe`
        });
      }
      path(fileName: string): string {
        return fileName;
      }
      join(path: string, file: string): string {
        return `${path} ${file}`;
      }
    }();
        
    const manifest = await Manifest.load('somewhere/a', loader, {registry});
    assert(registry['somewhere/a path/b']);
  });
  it('parses all particles manifests', async () => {
    const verifyParticleManifests = (particlePaths) => {
      let count = 0;
      particlePaths.forEach(particleManifestFile => {
        if (fs.existsSync(particleManifestFile)) {
          try {
            const data = fs.readFileSync(particleManifestFile, 'utf-8');
            const model = parse(data);
            assert.isDefined(model);
          } catch (e) {
            console.log(`Failed parsing ${particleManifestFile}`);
            throw e;
          }
          ++count;
        }
      });
      return count;
    };

    const shellParticlesPath = 'src/runtime/test/artifacts/';
    let shellParticleNames = [];
    fs.readdirSync(shellParticlesPath).forEach(name => {
      const manifestFolderName = path.join(shellParticlesPath, name);
      if (fs.statSync(manifestFolderName).isDirectory()) {
        shellParticleNames = shellParticleNames.concat(
            fs.readdirSync(manifestFolderName)
                .filter(fileName => fileName.endsWith('.schema') || fileName.endsWith('.manifest') || fileName.endsWith('.recipes'))
                .map(fileName => path.join(manifestFolderName, fileName)));
      }
    });
    assert.isAbove(verifyParticleManifests(shellParticleNames), 0);
  });
  it('loads entities from json files', async () => {
    const manifestSource = `
        schema Thing
        store Store0 of [Thing] in 'entities.json'`;
    const entitySource = JSON.stringify([
      {someProp: 'someValue'},
      {
        $id: 'entity-id',
        someProp: 'someValue2'
      },
    ]);
    const loader = new StubLoader({
      'the.manifest': manifestSource,
      'entities.json': entitySource,
    });
    const manifest = await Manifest.load('the.manifest', loader);
    const store = manifest.findStoreByName('Store0') as CollectionStorageProvider;
    assert(store);

    const sessionId = manifest.idGeneratorForTesting.currentSessionIdForTesting;

    assert.deepEqual(await store.toList(), [
      {
        id: `!${sessionId}:the.manifest::0`,
        rawData: {someProp: 'someValue'},
      }, {
        id: 'entity-id',
        rawData: {someProp: 'someValue2'},
      }
    ]);
  });
  it('throws an error when a store has invalid json', async () => {
    try {
      const manifest = await Manifest.parse(`
      schema Thing
      resource EntityList
        start
        this is not json?

      store Store0 of [Thing] in EntityList`);
      assert(false);
    } catch (e) {
      assert.deepEqual(e.message, `Post-parse processing error caused by 'undefined' line 7.
Error parsing JSON from 'EntityList' (Unexpected token h in JSON at position 1)'
        store Store0 of [Thing] in EntityList
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^`);
    }
  });
  it('loads entities from a resource section', async () => {
    const manifest = await Manifest.parse(`
      schema Thing

      resource EntityList
        start
        [
          {"someProp": "someValue"},
          {"$id": "entity-id", "someProp": "someValue2"}
        ]

      store Store0 of [Thing] in EntityList
    `, {fileName: 'the.manifest'});
    const store = manifest.findStoreByName('Store0') as CollectionStorageProvider;
    assert(store);

    const sessionId = manifest.idGeneratorForTesting.currentSessionIdForTesting;

    // TODO(shans): address as part of storage refactor
    assert.deepEqual(await store.toList(), [
      {
        id: `!${sessionId}:the.manifest::0`,
        rawData: {someProp: 'someValue'},
      }, {
        id: 'entity-id',
        rawData: {someProp: 'someValue2'},
      }
    ]);
  });
  it('resolves store names to ids', async () => {
    const manifestSource = `
        schema Thing
        store Store0 of [Thing] in 'entities.json'
        recipe
          map Store0 as myStore`;
    const entitySource = JSON.stringify([]);
    const loader = new StubLoader({
      'the.manifest': manifestSource,
      'entities.json': entitySource,
    });
    const manifest = await Manifest.load('the.manifest', loader);
    const recipe = manifest.recipes[0];
    assert.deepEqual(recipe.toString(), 'recipe\n  map \'!manifest:the.manifest:store0:97d170e1550eee4afc0af065b78cda302a97674c\' as myStore');
  });
  it('has prettyish syntax errors', async () => {
    try {
      await Manifest.parse('recipe ?', {fileName: 'bad-file'});
      assert(false);
    } catch (e) {
      assert.deepEqual(e.message, `Parse error in 'bad-file' line 1.
Expected a verb (e.g. &Verb) or an uppercase identifier (e.g. Foo) but "?" found.
  recipe ?
         ^`);
    }
  });

  it('errors when the manifest connects a particle incorrectly', async () => {
    const manifest = `
        schema Thing
        particle TestParticle in 'tp.js'
          in Thing iny
          out Thing outy
          inout Thing inouty
        recipe
          create as x
          TestParticle
            iny -> x
            outy -> x
            inouty -> x`;
    try {
      await Manifest.parse(manifest);
      assert.fail();
    } catch (e) {
      assert.match(e.message, /'->' not compatible with 'in' param of 'TestParticle'/);
    }
  });

  it('errors when the manifest references a missing particle param', async () => {
    const manifest = `
        schema Thing
        particle TestParticle in 'tp.js'
          in Thing a
        recipe
          create as x
          TestParticle
            a = x
            b = x`;
    try {
      await Manifest.parse(manifest);
      assert.fail();
    } catch (e) {
      assert.match(e.message, /param 'b' is not defined by 'TestParticle'/);
    }
  });

  it('errors when the manifest references a missing consumed slot', async () => {
    const manifest = `
        particle TestParticle in 'tp.js'
          consume root
        recipe
          TestParticle
            consume other`;
    try {
      await Manifest.parse(manifest);
      assert.fail();
    } catch (e) {
      assert.match(e.message, /Consumed slot 'other' is not defined by 'TestParticle'/);
    }
  });
  it('SLANDLES errors when the manifest references a missing consumed slot', async () => {
    const manifest = `
        particle TestParticle in 'tp.js'
          \`consume Slot root
        recipe
          TestParticle
            other consume`;
    try {
      await Manifest.parse(manifest);
      assert.fail();
    } catch (e) {
      assert.match(e.message, /param 'other' is not defined by 'TestParticle'/);
    }
  });

  it('errors when the manifest references a missing provided slot', async () => {
    const manifest = `
        particle TestParticle in 'tp.js'
          consume root
            provide action
        recipe
          TestParticle
            consume root
              provide noAction`;
    try {
      await Manifest.parse(manifest);
      assert.fail();
    } catch (e) {
      assert.match(e.message, /Provided slot 'noAction' is not defined by 'TestParticle'/);
    }
  });
  it('SLANDLES errors when the manifest references a missing provided slot', async () => {
    const manifest = `
        particle TestParticle in 'tp.js'
          \`consume Slot root
            \`provide Slot action
        recipe
          TestParticle
            root consume
            noAction provide`;
    try {
      await Manifest.parse(manifest);
      assert.fail();
    } catch (e) {
      assert.match(e.message, /param 'noAction' is not defined by 'TestParticle'/);
    }
  });

  it('errors when the manifest uses invalid connection constraints', async () => {
    // nonexistent fromParticle
    const manifestFrom = `
        recipe
          NoParticle.paramA -> OtherParticle.paramB`;
    try {
      await Manifest.parse(manifestFrom);
      assert.fail();
    } catch (e) {
      assert.match(e.message, /could not find particle 'NoParticle'/);
    }
    // nonexistent toParticle
    const manifestTo = `
        particle ParticleA
          in S {} paramA
        recipe
          ParticleA.paramA -> OtherParticle.paramB`;
    try {
      await Manifest.parse(manifestTo);
      assert.fail();
    } catch (e) {
      assert.match(e.message, /could not find particle 'OtherParticle'/);
    }
    // nonexistent connection name in fromParticle
    const manifestFromParam = `
        particle ParticleA
        particle ParticleB
        recipe
          ParticleA.paramA -> ParticleB.paramB`;
    try {
      await Manifest.parse(manifestFromParam);
      assert.fail();
    } catch (e) {
      assert.match(e.message, /'paramA' is not defined by 'ParticleA'/);
    }
    // nonexistent connection name in toParticle
    const manifestToParam = `
        schema Thing
        particle ParticleA
          in Thing paramA
        particle ParticleB
        recipe
          ParticleA.paramA -> ParticleB.paramB`;
    try {
      await Manifest.parse(manifestToParam);
      assert.fail();
    } catch (e) {
      assert.match(e.message, /'paramB' is not defined by 'ParticleB'/);
    }
  });

  it('resolves manifest with recipe with search', async () => {
    // TODO: support search tokens in manifest-parser.peg
    const manifestSource = `
      recipe
        search \`Hello dear world\``;
    let recipe = (await Manifest.parse(manifestSource)).recipes[0];
    assert.isNotNull(recipe.search);
    let search = checkNotNull(recipe.search);
    assert.equal('Hello dear world', search.phrase);
    assert.deepEqual(['hello', 'dear', 'world'], search.unresolvedTokens);
    assert.deepEqual([], search.resolvedTokens);
    assert.isTrue(search.isValid());
    recipe.normalize();
    search = checkNotNull(recipe.search);
    assert.isFalse(search.isResolved());
    assert.isFalse(recipe.isResolved());
    assert.equal(recipe.toString(), `recipe`);
    assert.equal(recipe.toString({showUnresolved: true}), `recipe
  search \`Hello dear world\`
    tokens \`dear\` \`hello\` \`world\` // unresolved search tokens`);

    recipe = (await Manifest.parse(manifestSource)).recipes[0];
    // resolve some tokens.
    search = checkNotNull(recipe.search);
    search.resolveToken('hello');
    search.resolveToken('world');
    assert.equal('Hello dear world', search.phrase);
    assert.deepEqual(['dear'], search.unresolvedTokens);
    assert.deepEqual(['hello', 'world'], search.resolvedTokens);
    assert.equal(recipe.toString(), `recipe`);
    assert.equal(recipe.toString({showUnresolved: true}), `recipe
  search \`Hello dear world\`
    tokens \`dear\` // \`hello\` \`world\` // unresolved search tokens`);

    // resolve all tokens.
    search.resolveToken('dear');
    recipe.normalize();
    assert.equal('Hello dear world', search.phrase);
    assert.deepEqual([], search.unresolvedTokens);
    assert.deepEqual(['dear', 'hello', 'world'], search.resolvedTokens);
    assert.isTrue(search.isResolved());
    assert.isTrue(recipe.isResolved());
    assert.equal(recipe.toString(), `recipe`);
    assert.equal(recipe.toString({showUnresolved: true}), `recipe
  search \`Hello dear world\`
    tokens // \`dear\` \`hello\` \`world\``);
  });

  it('merge recipes with search strings', async () => {
    const recipe1 = (await Manifest.parse(`recipe
  search \`Hello world\``)).recipes[0];
    const recipe2 = (await Manifest.parse(`recipe
  search \`good morning\`
    tokens \`morning\` // \`good\``)).recipes[0];

    recipe2.mergeInto(recipe1);
    const search = checkNotNull(recipe1.search);
    assert.equal('Hello world good morning', search.phrase);
    assert.deepEqual(['hello', 'world', 'morning'], search.unresolvedTokens);
    assert.deepEqual(['good'], search.resolvedTokens);
  });
  it('can parse a manifest containing stores', async () => {
    const loader = new StubLoader({'*': '[]'});
    const manifest = await Manifest.parse(`
  schema Product
  store ClairesWishlist of [Product] #wishlist in 'wishlist.json'
    description \`Claire's wishlist\``, {loader});
    const verify = (manifest: Manifest) => {
      assert.lengthOf(manifest.stores, 1);
      assert.deepEqual(['wishlist'], manifest.storeTags.get(manifest.stores[0]));
    };
    verify(manifest);
    verify(await Manifest.parse(manifest.toString(), {loader}));
  });
  it('can parse a manifest containing resources', async () => {
    const manifest = await Manifest.parse(`
resource SomeName
  start
  {'foo': 'bar'}
  hello
`, {});
    assert.deepEqual(manifest.resources['SomeName'], `{'foo': 'bar'}\nhello\n`);
  });
  it('can parse a manifest containing incomplete interfaces', async () => {
    const manifest = await Manifest.parse(`
      schema Foo
      interface FullInterface
        in Foo foo
        consume root
        provide action
      interface NoHandleName
        in Foo *
      interface NoHandleType
        inout foo
      interface NoHandleDirection
        Foo foo
      interface OnlyHandleDirection
        out *
      interface ManyHandles
        in Foo *
        out [~a] *
      interface ConsumeNoName
        consume
      interface ConsumeRequiredSetSlot
        must consume set of
        must provide
      interface OnlyProvideSlots
        provide action
    `);
    assert.lengthOf(manifest.interfaces, 9);
    assert(manifest.findInterfaceByName('FullInterface'));
  });
  it('can parse a manifest containing interfaces', async () => {
    const manifest = await Manifest.parse(`
      schema Foo
      interface Bar
        in Foo foo
      particle HostingParticle
        host Bar iface0
      recipe
        create as handle0
        HostingParticle
          iface0 = handle0`);
    assert(manifest.findInterfaceByName('Bar'));
    assert(manifest.recipes[0].normalize());
  });
  it('can parse interfaces using new-style body syntax', async () => {
    const manifest = await Manifest.parse(`
      schema Foo
      interface Bar
        in Foo foo
      particle HostingParticle
        host Bar iface0
      recipe
        create as handle0
        HostingParticle
          iface0 = handle0
    `);
    assert(manifest.findInterfaceByName('Bar'));
    assert(manifest.recipes[0].normalize());
  });
  it('can resolve optional handles', async () => {
    const manifest = await Manifest.parse(`
      schema Something
      particle Thing in 'thing.js'
        in [Something] inThing
        out? [Something] maybeOutThings
      recipe
        create as handle0 // [Something]
        Thing
          inThing <- handle0`);
    const verify = (manifest: Manifest) => {
      assert.isFalse(manifest.particles[0].handleConnections[0].isOptional);
      assert.isTrue(manifest.particles[0].handleConnections[1].isOptional);

      const recipe = manifest.recipes[0];
      recipe.normalize();
      assert.isTrue(recipe.isResolved());
    };
    verify(manifest);
    verify(await Manifest.parse(manifest.toString(), {}));
  });
  it('can resolve an immediate handle specified by a particle target', async () => {
    const manifest = await Manifest.parse(`
      schema S
      interface HostedInterface
        in S foo

      particle Hosted
        in S foo
        in S bar

      particle Transformation &work in '...js'
        host HostedInterface hosted

      recipe
        Transformation
          hosted = Hosted`);
    const [recipe] = manifest.recipes;
    assert(recipe.normalize());
    assert(recipe.isResolved());
  });
  it('can resolve a particle with an inline schema', async () => {
    const manifest = await Manifest.parse(`
      particle P
        in * {Text value} foo
      recipe
        create as h0
        P
          foo = h0
    `);
    const [recipe] = manifest.recipes;
    assert(recipe.normalize());
    assert(recipe.isResolved());
  });
  it('can resolve a particle with a schema reference', async () => {
    const manifest = await Manifest.parse(`
      schema Foo
        Text far
      particle P
        in Bar {Reference<Foo> foo} bar
      recipe
        create as h0
        P
          bar = h0
    `);

    const [recipe] = manifest.recipes;
    assert(recipe.normalize());
    assert(recipe.isResolved());
    const schema = checkDefined(recipe.particles[0].connections.bar.type.getEntitySchema());
    const innerSchema = schema.fields.foo.schema.model.getEntitySchema();
    verifyPrimitiveType(innerSchema.fields.far, 'Text');

    assert.equal(manifest.particles[0].toString(),
`particle P in 'null'
  in Bar {Reference<Foo {Text far}> foo} bar
  modality dom`);
  });
  it('can resolve a particle with an inline schema reference', async () => {
    const manifest = await Manifest.parse(`
      schema Foo
      particle P
        in Bar {Reference<Foo {Text far}> foo} bar
      recipe
        create as h0
        P
          bar = h0
    `);

    const [recipe] = manifest.recipes;
    assert(recipe.normalize());
    assert(recipe.isResolved());
    const schema = recipe.particles[0].connections.bar.type.getEntitySchema();
    const innerSchema = schema.fields.foo.schema.model.getEntitySchema();
    verifyPrimitiveType(innerSchema.fields.far, 'Text');

    assert.equal(manifest.particles[0].toString(),
`particle P in 'null'
  in Bar {Reference<Foo {Text far}> foo} bar
  modality dom`);
  });
  it('can resolve a particle with a collection of schema references', async () => {
    const manifest = await Manifest.parse(`
      schema Foo
        Text far
      particle P
        in Bar {[Reference<Foo>] foo} bar
      recipe
        create as h0
        P
          bar = h0
    `);

    const [recipe] = manifest.recipes;
    assert(recipe.normalize());
    assert(recipe.isResolved());
    const schema = recipe.particles[0].connections.bar.type.getEntitySchema();
    const innerSchema = schema.fields.foo.schema.schema.model.getEntitySchema();
    verifyPrimitiveType(innerSchema.fields.far, 'Text');

    assert.equal(manifest.particles[0].toString(),
`particle P in 'null'
  in Bar {[Reference<Foo {Text far}>] foo} bar
  modality dom`);
  });
  it('can resolve a particle with a collection of inline schema references', async () => {
    const manifest = await Manifest.parse(`
      particle P
        in Bar {[Reference<Foo {Text far}>] foo} bar
      recipe
        create as h0
        P
          bar = h0
    `);

    const [recipe] = manifest.recipes;
    assert(recipe.normalize());
    assert(recipe.isResolved());
    const schema = recipe.particles[0].connections.bar.type.getEntitySchema();
    const innerSchema = schema.fields.foo.schema.schema.model.getEntitySchema();
    verifyPrimitiveType(innerSchema.fields.far, 'Text');

    assert.equal(manifest.particles[0].toString(),
`particle P in 'null'
  in Bar {[Reference<Foo {Text far}>] foo} bar
  modality dom`);
  });
  it('can resolve inline schemas against out of line schemas', async () => {
    const manifest = await Manifest.parse(`
      schema T
        Text value
      particle P
        in * {Text value} foo
      particle P2
        out T foo

      recipe
        create as h0
        P
          foo = h0
        P2
          foo = h0
    `);
    const [validRecipe, invalidRecipe] = manifest.recipes;
    assert(validRecipe.normalize());
    assert(validRecipe.isResolved());
  });
  it('can resolve handle types from inline schemas', async () => {
    const manifest = await Manifest.parse(`
      particle P
        in * {Text value} foo
      particle P2
        in * {Text value, Text value2} foo
      particle P3
        in * {Text value, Text value3} foo
      particle P4
        in * {Text value, Number value2} foo

      recipe
        create as h0
        P
          foo = h0
        P2
          foo = h0

      recipe
        create as h0
        P2
          foo = h0
        P3
          foo = h0

      recipe
        create as h0
        P2
          foo = h0
        P4
          foo = h0
    `);
    const [validRecipe, suspiciouslyValidRecipe, invalidRecipe] = manifest.recipes;
    assert(validRecipe.normalize());
    assert(validRecipe.isResolved());
    // Although suspicious, this is valid because entities in the
    // created handle just need to be able to be read as {Text value, Text value2}
    // and {Text value, Text value3}. Hence, the recipe is valid and the type
    // of the handle is * {Text value, Text value2, Text value3};
    assert(suspiciouslyValidRecipe.normalize());
    const suspiciouslyValidFields =
        suspiciouslyValidRecipe.handles[0].type.canWriteSuperset.getEntitySchema().fields;
    verifyPrimitiveType(suspiciouslyValidFields.value, 'Text');
    verifyPrimitiveType(suspiciouslyValidFields.value2, 'Text');
    verifyPrimitiveType(suspiciouslyValidFields.value3, 'Text');
    assert(!invalidRecipe.normalize());
  });

  it('can infer field types of inline schemas from external schemas', async () => {
    const manifest = await Manifest.parse(`
      schema Thing
        Text value
      particle P
        in Thing {value} foo
      particle P2
        in * {Text value} foo

      recipe
        create as h0
        P
          foo = h0
        P2
          foo = h0
    `);
    const [validRecipe] = manifest.recipes;
    assert(validRecipe.normalize());
    assert(validRecipe.isResolved());
  });

  it('supports inline schemas with multiple names', async () => {
    const manifest = await Manifest.parse(`
      schema Thing1
        Text value1
      schema Thing2
        Number value2
      particle P
        in Thing1 Thing2 {value1, value2} foo
      particle P2
        in * {Text value1, Number value2} foo

      recipe
        create as h0
        P
          foo = h0
        P2
          foo = h0
    `);
    const [validRecipe] = manifest.recipes;
    assert(validRecipe.normalize());
    assert(validRecipe.isResolved());

  });


  it('can parse a manifest with storage key handle definitions', async () => {
    const manifest = await Manifest.parse(`
      schema Bar
        Text value

      particle P
        in Bar foo

      store Foo of Bar 'test' @0 at 'firebase://testing'

      recipe
        map Foo as myHandle
        P
          foo = myHandle
    `);
    const [validRecipe] = manifest.recipes;
    assert(validRecipe.normalize());
    assert(validRecipe.isResolved());
  });

  it('can process a schema alias', async () => {
    const manifest = await Manifest.parse(`
      alias schema This That as SchemaAlias
      alias schema * extends SchemaAlias as Extended
    `);
    assert.isNotNull(manifest.findSchemaByName('SchemaAlias'));
    assert.sameMembers(manifest.findSchemaByName('Extended').names, ['This', 'That']);
  });

  it('expands schema aliases', async () => {
    const manifest = await Manifest.parse(`
      alias schema Name1 as Thing1
        Text field1
      alias schema Name2 as Thing2
        Text field2
      particle P in 'p.js'
        in Thing1 Thing2 Name3 {Text field1, Text field3} param
    `);
    const paramSchema = checkNotNull(manifest.findParticleByName('P').inputs[0].type.getEntitySchema());
    assert.sameMembers(paramSchema.names, ['Name1', 'Name2', 'Name3']);
    assert.sameMembers(Object.keys(paramSchema.fields), ['field1', 'field2', 'field3']);
  });

  it('fails when expanding conflicting schema aliases', async () => {
    try {
      const manifest = await Manifest.parse(`
        alias schema Name1 as Thing1
          Text field1
        alias schema Name2 as Thing2
          Number field1
        particle P in 'p.js'
          in Thing1 Thing2 {} param
      `);
      assert.fail();
    } catch (e) {
      assert.include(e.message, 'Could not merge schema aliases');
    }
  });

  it('fails when inline schema specifies a field type that does not match alias expansion', async () => {
    try {
      const manifest = await Manifest.parse(`
        alias schema Name1 as Thing1
          Text field1
        particle P in 'p.js'
          in Thing1 {Number field1} param
      `);
      assert.fail();
    } catch (e) {
      assert.include(e.message, 'does not match schema');
    }
  });

  it('can relate inline schemas to generic connections', async () => {
    const manifest = await Manifest.parse(`
      schema Thing
        Text value
        Number num

      particle P
        in ~a with Thing {value} inThing
        out ~a outThing

      resource Things
        start
        []

      store ThingStore of Thing in Things

      recipe
        map ThingStore as input
        create as output
        P
          inThing = input
          outThing = output
    `);
    const [validRecipe] = manifest.recipes;
    assert(validRecipe.normalize());
    assert(validRecipe.isResolved());
  });

  it('can parse a recipe with slot constraints on verbs', async () => {
    const manifest = await Manifest.parse(`
      recipe
        &verb
          consume consumeSlot
            provide provideSlot
    `);

    const recipe = manifest.recipes[0];
    assert(recipe.normalize());

    assert.equal(recipe.particles[0].primaryVerb, 'verb');
    assert.isUndefined(recipe.particles[0].spec);
    const slotConnection = recipe.particles[0]._consumedSlotConnections.consumeSlot;
    assert(slotConnection.providedSlots.provideSlot);
    assert.equal(slotConnection.providedSlots.provideSlot.sourceConnection, slotConnection);
  });

  it('SLANDLES can parse a recipe with slot constraints on verbs', async () => {
    const manifest = await Manifest.parse(`
      recipe
        \`slot as provideSlot
        &verb
          foo consume provideSlot
    `);

    const recipe = manifest.recipes[0];

    assert.equal(recipe.particles[0].primaryVerb, 'verb');
    assert.isUndefined(recipe.particles[0].spec);
    const slotConnection = recipe.particles[0].connections.foo;
    assert.equal(slotConnection.direction, '`consume');

    assert.lengthOf(recipe.handles, 1);
    assert.lengthOf(recipe.handles[0].connections, 1);
    assert.equal(recipe.handles[0].connections[0], slotConnection);
  });

  it('can parse particle arguments with tags', async () => {
    const manifest = await Manifest.parse(`
      schema Dog
      schema Sled
      schema DogSled
      particle DogSledMaker in 'thing.js'
        in Dog leader #leader
        in [Dog] team
        in Sled sled #dogsled
        out DogSled dogsled #multidog #winter #sled
    `);

    assert.equal(manifest.particles.length, 1);
    assert.equal(manifest.particles[0].handleConnections.length, 4);

    const connections = manifest.particles[0].handleConnections;
    assert.equal(connections[0].name, 'leader');
    assert.deepEqual(connections[0].tags, ['leader']);

    assert.equal(connections[1].name, 'team');
    assert.equal(connections[1].tags.length, 0);

    assert.equal(connections[2].name, 'sled');
    assert.deepEqual(connections[2].tags, ['dogsled']);

    assert.equal(connections[3].name, 'dogsled');
    assert.deepEqual(connections[3].tags, ['multidog', 'winter', 'sled']);
  });

  it('can round-trip particles with tags', async () => {
    const manifestString = `particle TestParticle in 'a.js'
  in [Product {}] input
    out [Product {}] output
  modality dom
  consume thing #main #tagname
    provide otherThing #testtag`;

    const manifest = await Manifest.parse(manifestString);
    assert.lengthOf(manifest.particles, 1);
    assert.equal(manifestString, manifest.particles[0].toString());
  });

  it('can round-trip particles with fields', async () => {
    const manifestString = `particle TestParticle in 'a.js'
  in [Product {}] input
    out [Product {}] output
  in ~a thingy
  modality dom
  must consume thing #main #tagname
    formFactor big
    must provide otherThing #testtag
      handle thingy`;

    const manifest = await Manifest.parse(manifestString);
    assert.lengthOf(manifest.particles, 1);
    assert.equal(manifestString, manifest.particles[0].toString());
  });

  it('SLANDLES can round-trip particles with tags', async () => {
    const manifestString = `particle TestParticle in 'a.js'
  in [Product {}] input
    out [Product {}] output
  \`consume Slot {formFactor:big} thing #main #tagname
    \`provide Slot {handle:thingy} otherThing #testtag
  modality dom`;

    const manifest = await Manifest.parse(manifestString);
    assert.lengthOf(manifest.particles, 1);
    assert.equal(manifestString, manifest.particles[0].toString());
  });
  it('SLANDLES can round-trip particles with fields', async () => {
    const manifestString = `particle TestParticle in 'a.js'
  in [Product {}] input
    out [Product {}] output
  in ~a thingy
  \`consume Slot {formFactor:big} thing #main #tagname
    \`provide Slot {handle:thingy} otherThing #testtag
  modality dom`;

    const manifest = await Manifest.parse(manifestString);
    assert.lengthOf(manifest.particles, 1);
    assert.equal(manifestString, manifest.particles[0].toString());
  });

  it('SLANDLES can round-trip particles with tags', async () => {
    const manifestString = `particle TestParticle in 'a.js'
  in [Product {}] input
    out [Product {}] output
  \`consume Slot thing #main #tagname
    \`provide Slot otherThing #testtag
  modality dom`;

    const manifest = await Manifest.parse(manifestString);
    assert.lengthOf(manifest.particles, 1);
    assert.equal(manifestString, manifest.particles[0].toString());
  });
  it('SLANDLES can round-trip particles with fields', async () => {
    const manifestString = `particle TestParticle in 'a.js'
  in [Product {}] input
    out [Product {}] output
  \`consume Slot {formFactor:big} thing
    \`provide Slot {handle:thingy} otherThing
  modality dom`;

    const manifest = await Manifest.parse(manifestString);
    assert.lengthOf(manifest.particles, 1);
    assert.equal(manifestString, manifest.particles[0].toString());
  });

  it('can parse recipes with an implicit create handle', async () => {
    const manifest = await Manifest.parse(`
      particle A
        out S {} a
      particle B
        in S {} b

      recipe
        A
          a -> h0
        B
          b <- h0
    `);

    const recipe = manifest.recipes[0];
    assert.equal(recipe.particles[0].connections.a.handle, recipe.particles[1].connections.b.handle);
  });
  
  it('can parse recipes with a require section', async () => {
    const manifest = await Manifest.parse(`
      particle P1
        out S {} a
        consume root 
          provide details
      particle P2
        in S {} b
          consume details
      
      recipe 
        require
          handle as h0
          slot as s0
          P1
            * -> h0
            consume root
              provide details as s0
          P2
            * <- h0
            consume details
        P1
    `);
    const recipe = manifest.recipes[0];
    assert(recipe.requires.length === 1, 'could not parse require section');
  });
 
  it('recipe resolution checks the require sections', async () => {
    const manifest = await Manifest.parse(`

      particle A
        in S {} input
      particle B
        out S {} output

      recipe
        require
          A
          B
    `);
    const recipe = manifest.recipes[0];
    recipe.normalize();
    assert.isFalse(recipe.isResolved(), 'recipe with a require section is resolved');
  });

  describe('trust claims and checks', () => {
    it('supports multiple claim statements', async () => {
      const manifest = await Manifest.parse(`
        particle A
          out T {} output1
          out T {} output2
          claim output1 is property1
          claim output2 is property2
      `);
      assert.lengthOf(manifest.particles, 1);
      const particle = manifest.particles[0];
      assert.isEmpty(particle.trustChecks);
      assert.equal(particle.trustClaims.size, 2);
      
      const claim1 = particle.trustClaims.get('output1') as ClaimIsTag;
      assert.equal(claim1.handle.name, 'output1');
      assert.equal(claim1.tag, 'property1');

      const claim2 = particle.trustClaims.get('output2') as ClaimIsTag;
      assert.equal(claim2.handle.name, 'output2');
      assert.equal(claim2.tag, 'property2');
    });

    it('supports "is not" tag claims', async () => {
      const manifest = await Manifest.parse(`
        particle A
          out T {} output1
          out T {} output2
          claim output1 is not property1
      `);
      assert.lengthOf(manifest.particles, 1);
      const particle = manifest.particles[0];
      assert.isEmpty(particle.trustChecks);
      assert.equal(particle.trustClaims.size, 1);

      const claim1 = particle.trustClaims.get('output1') as ClaimIsTag;
      assert.equal(claim1.handle.name, 'output1');
      assert.equal(claim1.isNot, true);
      assert.equal(claim1.tag, 'property1');
     });

    it('supports "derives from" claims with multiple parents', async () => {
      const manifest = await Manifest.parse(`
        particle A
          in T {} input1
          in T {} input2
          out T {} output
          claim output derives from input1 and derives from input2
      `);
      assert.lengthOf(manifest.particles, 1);
      const particle = manifest.particles[0];
      assert.isEmpty(particle.trustChecks);
      assert.equal(particle.trustClaims.size, 1);
      
      const claim = particle.trustClaims.get('output') as ClaimDerivesFrom;
      assert.equal(claim.handle.name, 'output');
      assert.sameMembers(claim.parentHandles.map(h => h.name), ['input1', 'input2']);
    });

    it('supports multiple check statements', async () => {
      const manifest = await Manifest.parse(`
        particle A
          in T {} input1
          in T {} input2
          check input1 is property1
          check input2 is property2
      `);
      assert.lengthOf(manifest.particles, 1);
      const particle = manifest.particles[0];
      assert.isEmpty(particle.trustClaims);
      assert.lengthOf(particle.trustChecks, 2);
      
      const check1 = checkDefined(particle.trustChecks[0]);
      assert.equal(check1.toManifestString(), 'check input1 is property1');
      assert.equal(check1.target.name, 'input1');
      assert.deepEqual(check1.expression, new CheckHasTag('property1'));

      const check2 = checkDefined(particle.trustChecks[1]);
      assert.equal(check2.toManifestString(), 'check input2 is property2');
      assert.equal(check2.target.name, 'input2');
      assert.deepEqual(check2.expression, new CheckHasTag('property2'));
    });

    it('supports checks on provided slots', async () => {
      const manifest = await Manifest.parse(`
        particle A
          consume root
            provide mySlot
          check mySlot data is trusted
      `);
      assert.lengthOf(manifest.particles, 1);
      const particle = manifest.particles[0];
      assert.isEmpty(particle.trustClaims);
      assert.lengthOf(particle.trustChecks, 1);
      
      const check = particle.trustChecks[0];
      assert.equal(check.toManifestString(), 'check mySlot data is trusted');
      assert.isTrue(check.target instanceof ProvideSlotConnectionSpec);
      assert.equal(check.target.name, 'mySlot');
      assert.deepEqual(check.expression, new CheckHasTag('trusted'));
    });

    it(`supports checks with the 'or' operation`, async () => {
      const manifest = await Manifest.parse(`
        particle A
          in T {} input
          check input is property1 or is property2 or is property3
      `);
      assert.lengthOf(manifest.particles, 1);
      const particle = manifest.particles[0];
      assert.isEmpty(particle.trustClaims);
      assert.lengthOf(particle.trustChecks, 1);

      const check = checkDefined(particle.trustChecks[0]);
      assert.equal(check.toManifestString(), 'check input is property1 or is property2 or is property3');
      assert.equal(check.target.name, 'input');
      assert.deepEqual(check.expression, new CheckBooleanExpression('or', [
        new CheckHasTag('property1'),
        new CheckHasTag('property2'),
        new CheckHasTag('property3'),
      ]));
    });

    it(`supports checks with the 'and' operation`, async () => {
      const manifest = await Manifest.parse(`
        particle A
          in T {} input
          check input is property1 and is property2 and is property3
      `);
      assert.lengthOf(manifest.particles, 1);
      const particle = manifest.particles[0];
      assert.isEmpty(particle.trustClaims);
      assert.lengthOf(particle.trustChecks, 1);

      const check = particle.trustChecks[0];
      assert.equal(check.toManifestString(), 'check input is property1 and is property2 and is property3');
      assert.equal(check.target.name, 'input');
      assert.deepEqual(check.expression, new CheckBooleanExpression('and', [
        new CheckHasTag('property1'),
        new CheckHasTag('property2'),
        new CheckHasTag('property3'),
      ]));
    });

    it(`supports arbitrary nesting of 'and' and 'or' operations and conditions`, async () => {
      const manifest = await Manifest.parse(`
        particle A
          in T {} input
          check input (is property1 and ((is property2))) or ((is property2) or is property3)
      `);
      assert.lengthOf(manifest.particles, 1);
      const particle = manifest.particles[0];
      assert.isEmpty(particle.trustClaims);
      assert.lengthOf(particle.trustChecks, 1);

      const check = particle.trustChecks[0];
      assert.equal(check.toManifestString(), 'check input (is property1 and is property2) or (is property2 or is property3)');
      assert.equal(check.target.name, 'input');
      assert.deepEqual(
        check.expression,
        new CheckBooleanExpression('or', [
          new CheckBooleanExpression('and', [
            new CheckHasTag('property1'),
            new CheckHasTag('property2'),
          ]),
          new CheckBooleanExpression('or', [
            new CheckHasTag('property2'),
            new CheckHasTag('property3'),
          ]),
        ]));
    });

    it(`doesn't allow mixing 'and' and 'or' operations without nesting`, async () => {
      assertThrowsAsync(async () => await Manifest.parse(`
        particle A
          in T {} input
          check input is property1 or is property2 and is property3
      `), `You cannot combine 'and' and 'or' operations in a single check expression.`);
    });

    it('can round-trip checks and claims', async () => {
      const manifestString = `particle TestParticle in 'a.js'
  in T {} input1
  in T {} input2
  out T {} output1
  out T {} output2
  out T {} output3
  claim output1 is trusted
  claim output2 derives from input2
  claim output3 is not dangerous
  check input1 is trusted or is from handle input2
  check input2 is extraTrusted
  check childSlot data is somewhatTrusted
  modality dom
  consume parentSlot
    provide childSlot`;
    
      const manifest = await Manifest.parse(manifestString);
      assert.equal(manifestString, manifest.toString());
    });

    it('fails for unknown handle names', async () => {
      assertThrowsAsync(async () => await Manifest.parse(`
        particle A
          out T {} output
          claim oops is trusted
      `), `Can't make a claim on unknown handle oops`);

      assertThrowsAsync(async () => await Manifest.parse(`
        particle A
          in T {} input
          check oops is trusted
      `), `Can't make a check on unknown handle oops`);
    });

    it(`doesn't allow claims on inputs`, async () => {
      assertThrowsAsync(async () => await Manifest.parse(`
        particle A
          in T {} foo
          claim foo is trusted
      `), `Can't make a claim on handle foo (not an output handle)`);
    });

    it(`doesn't allow checks on outputs`, async () => {
      assertThrowsAsync(async () => await Manifest.parse(`
        particle A
          out T {} foo
          check foo is trusted
      `), `Can't make a check on handle foo (not an input handle)`);
    });

    it(`doesn't allow multiple different claims for the same output`, async () => {
      assertThrowsAsync(async () => await Manifest.parse(`
        particle A
          out T {} foo
          claim foo is trusted
          claim foo is trusted
      `), `Can't make multiple claims on the same output (foo)`);
    });

    it(`doesn't allow multiple different checks for the same input`, async () => {
      assertThrowsAsync(async () => await Manifest.parse(`
        particle A
          in T {} foo
          check foo is trusted
          check foo is trusted
      `), `Can't make multiple checks on the same input (foo)`);
    });

    it(`doesn't allow checks on consumed slots`, async () => {
      assertThrowsAsync(async () => await Manifest.parse(`
        particle A
          consume someOtherSlot
            provide mySlot
          check someOtherSlot data is trusted
      `), `Slot someOtherSlot is a consumed slot. Can only make checks on provided slots`);
    });

    it(`doesn't allow checks on unknown slots`, async () => {
      assertThrowsAsync(async () => await Manifest.parse(`
        particle A
          consume someOtherSlot
            provide mySlot
          check missingSlot data is trusted
      `), `Can't make a check on unknown slot missingSlot`);
    });

    it(`doesn't allow multiple provided slots with the same name`, async () => {
      assertThrowsAsync(async () => await Manifest.parse(`
        particle A
          consume firstSlot
            provide mySlot
          consume secondSlot
            provide mySlot
      `), `Another slot with name 'mySlot' has already been provided by this particle`);
    });
  });
});
