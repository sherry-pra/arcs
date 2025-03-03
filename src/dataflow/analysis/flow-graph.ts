/**
 * @license
 * Copyright 2019 Google LLC.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
import {Recipe} from '../../runtime/recipe/recipe';
import {Particle} from '../../runtime/recipe/particle';
import {Handle} from '../../runtime/recipe/handle';
import {HandleConnection} from '../../runtime/recipe/handle-connection';
import {assert} from '../../platform/assert-web';
import {ClaimType, Claim} from '../../runtime/particle-claim';
import {Check, CheckType, CheckCondition, CheckIsFromHandle} from '../../runtime/particle-check';
import {HandleConnectionSpec, ConsumeSlotConnectionSpec, ProvideSlotConnectionSpec} from '../../runtime/particle-spec';
import {Slot} from '../../runtime/recipe/slot';
import {SlotConnection} from '../../runtime/recipe/slot-connection';

/**
 * Data structure for representing the connectivity graph of a recipe. Used to perform static analysis on a resolved recipe.
 */
export class FlowGraph {
  readonly particles: ParticleNode[];
  readonly handles: HandleNode[];
  readonly slots: SlotNode[];
  readonly nodes: Node[];
  readonly edges: Edge[] = [];

  /** Maps from particle name to node. */
  readonly particleMap: Map<string, ParticleNode>;

  constructor(recipe: Recipe) {
    if (!recipe.isResolved()) {
      throw new Error('Recipe must be resolved.');
    }

    // Create the nodes of the graph.
    const particleNodes = createParticleNodes(recipe.particles);
    const handleNodes = createHandleNodes(recipe.handles);
    const slotNodes = createSlotNodes(recipe.slots);

    // Add edges to the nodes.
    recipe.handleConnections.forEach(connection => {
      const particleNode = particleNodes.get(connection.particle);
      const handleNode = handleNodes.get(connection.handle);
      const edge = addHandleConnection(particleNode, handleNode, connection);
      this.edges.push(edge);
    });

    // Add edges from particles to the slots that they consume (one-way only, for now).
    recipe.slotConnections.forEach(connection => {
      const particleNode = particleNodes.get(connection.particle);
      const slotNode = slotNodes.get(connection.targetSlot);
      const edge = addSlotConnection(particleNode, slotNode, connection);
      this.edges.push(edge);

      // Copy the Check object from the "provide" connection onto the SlotNode.
      // (Checks are defined by the particle that provides the slot, but are
      // applied to the particle that consumes the slot.)
      for (const providedSlotSpec of connection.getSlotSpec().provideSlotConnections) {
        const providedSlot = connection.providedSlots[providedSlotSpec.name];
        const providedSlotNode = slotNodes.get(providedSlot);
        providedSlotNode.check = providedSlotSpec.check;
      }
    });

    this.particles = [...particleNodes.values()];
    this.handles = [...handleNodes.values()];
    this.slots = [...slotNodes.values()];
    this.nodes = [...this.particles, ...this.handles, ...this.slots];
    this.particleMap = new Map(this.particles.map(n => [n.name, n]));
  }

  /** Returns a list of all pairwise particle connections, in string form: 'P1.foo -> P2.bar'. */
  get connectionsAsStrings(): string[] {
    const connections: string[] = [];
    for (const handleNode of this.handles) {
      handleNode.connectionsAsStrings.forEach(c => connections.push(c));
    }
    return connections;
  }

  /** Returns true if all checks in the graph pass. */
  validateGraph(): ValidationResult {
    const finalResult = new ValidationResult();
    for (const edge of this.edges) {
      if (edge.check) {
        const result = this.validateSingleEdge(edge);
        result.failures.forEach(f => finalResult.failures.push(f));
      }
    }
    return finalResult;
  }

  /** 
   * Validates a single check (on the given edge). We define validation as
   * every path ending at the edge must pass the check on that edge. 
   * Returns true if the check passes.
   */
  private validateSingleEdge(edgeToCheck: Edge): ValidationResult {
    assert(!!edgeToCheck.check, 'Edge does not have any check conditions.');

    const check = edgeToCheck.check;
    const conditions = checkToConditionList(check);

    const finalResult = new ValidationResult();

    // Check every input path into the given edge.
    // NOTE: This is very inefficient. We check every single check condition against every single edge in every single input path.
    for (const path of allInputPaths(edgeToCheck)) {
      const tagsForPath = computeTagClaimsInPath(path);
      const handlesInPath = path.nodes.filter(n => n instanceof HandleNode) as HandleNode[];
      if (!evaluateCheck(conditions, tagsForPath, handlesInPath)) {
        finalResult.failures.push(`'${check.toManifestString()}' failed for path: ${path.toString()}`);
      }
    }

    return finalResult;
  }
}

/**
 * Preprocess a check into a list of conditions. This will need to change when
 * we implement complex boolean expressions.
 */
function checkToConditionList(check: Check): CheckCondition[] {
 // TODO: Support boolean expression trees properly! Currently we only deal with a single string of OR'd conditions.
  const conditions: CheckCondition[] = [];
  switch (check.expression.type) {
    case 'and':
      throw new Error(`Boolean expressions with 'and' are not supported yet.`);
    case 'or':
      for (const child of check.expression.children) {
        assert(child.type !== 'or' && child.type !== 'and', 'Nested boolean expressions are not supported yet.');
        conditions.push(child as CheckCondition);
      }
      break;
    default:
      // Expression is just a single condition.
      conditions.push(check.expression);
      break;
  }
  return conditions;
}

/**
 * Iterates through every path in the graph that lead into the given edge. Each
 * path returned is a BackwardsPath, beginning at the given edge, and ending at
 * the end of a path in the graph (i.e. a node with no input edges). "derives 
 * from" claims are used to prune paths, but the claims themselves are not
 * removed from the path edges.
 */
function* allInputPaths(startEdge: Edge): Iterable<BackwardsPath> {
  const startPath = BackwardsPath.fromEdge(startEdge);
  // Stack of partial paths that need to be expanded (via DFS). Other paths will be added here to be expanded as we explore the graph.
  const pathStack: BackwardsPath[] = [startPath];

  while (pathStack.length) {
    const path = pathStack.pop();
    const inEdges = path.endNode.inEdgesFromOutEdge(path.endEdge);
    if (inEdges.length === 0) {
      // Path is finished, yield it.
      yield path;
    } else {
      // Path is not finished, continue extending it via all in-edges.
      for (const nextEdge of inEdges) {
        pathStack.push(path.withNewEdge(nextEdge));
      }
    }
  }
}

/**
 * Collects all the tags claimed along the given path, canceling tag claims that are
 * negated by "not" claims for the same tag downstream in the path, and ignoring
 * "not" claims without corresponding positive claims upstream, as these dangling
 * "not" claims are irrelevant for the given path. Note that "derives from" claims
 * only prune paths, and are dealt with during path generation, so they are ignored.
 */
function computeTagClaimsInPath(path: BackwardsPath): Set<string> {
  const tags: Set<string> = new Set<string>();
  // We traverse the path in the forward direction, so we can cancel correctly.
  const edgesInPath = path.edgesInForwardDirection();
  edgesInPath.forEach(e => {
    if (!e.claim || e.claim.type !== ClaimType.IsTag) {
      return;
    } 
    if (!e.claim.isNot) {
      tags.add(e.claim.tag);
      return;          
    }
    // Our current claim is a "not" tag claim. 
    // Ignore it if there are no preceding tag claims
    if (tags.size === 0) {
      return;
    }
    tags.delete(e.claim.tag);
  });
  return tags;
}

/** 
 * Returns true if the given check passes against one of the tag claims or one
 * one of the handles in the path. Only one condition needs to pass.
 */
function evaluateCheck(conditions: CheckCondition[], claimTags: Set<string>, handles: HandleNode[]): boolean {
  // Check every condition against the set of tag claims. If it fails, check
  // against the handles
  for (const condition of conditions) {
    switch (condition.type) {
      case CheckType.HasTag:
        if (claimTags.has(condition.tag)) {
          return true;
        }
        break;
      case CheckType.IsFromHandle:
        // Do any of the handles in the path contain the condition handle as
        // an output handle?
        for (const handle of handles) {
          if (handle.validateIsFromHandleCheck(condition)) {
            return true;
          }
        }
        break;
      default:
        throw new Error('Unknown condition type.');
    }
  }
  return false;
}

/** Result from validating an entire graph. */
export class ValidationResult {
  failures: string[] = [];
  
  get isValid() {
    return this.failures.length === 0;
  }
}

/**
 * A path that walks backwards through the graph, i.e. it walks along the 
 * directed edges in the reverse direction. The path is described by the
 * nodes in the path. Class is immutable.
 */
export class BackwardsPath {
  private constructor(
      /** Nodes in the path. */
      readonly nodes: readonly Node[],
      /** Edges in the path. */
      readonly edges: readonly Edge[]) {}

  /** Constructs a new path from the given edge. */
  static fromEdge(edge: Edge) {
    return new BackwardsPath([edge.end, edge.start], [edge]);
  }

  /** Returns a copy of the current path, with an edge added to the end of it. */
  withNewEdge(edge: Edge): BackwardsPath {
    // Flip the edge around.
    const startNode = edge.end;
    const endNode = edge.start;

    assert(startNode === this.endNode, 'Edge must connect to end of path.');

    if (this.nodes.includes(endNode)) {
      throw new Error('Graph must not include cycles.');
    }

    return new BackwardsPath([...this.nodes, endNode], [...this.edges, edge]);
  }

  get startNode(): Node {
    return this.nodes[0];
  }

  get endNode(): Node {
    return this.nodes[this.nodes.length - 1];
  }

  get endEdge(): Edge {
    return this.edges[this.edges.length - 1];
  }

  edgesInForwardDirection(): Edge[] {
    return this.edges.slice().reverse();
  }

  toString() : string {
    const edgesInPath = this.edgesInForwardDirection();
    return edgesInPath.map(e => e.label).join(' -> ');
  }
}

/** Creates a new node for every given particle. */
function createParticleNodes(particles: Particle[]) {
  const nodes: Map<Particle, ParticleNode> = new Map();
  particles.forEach(particle => {
    nodes.set(particle, new ParticleNode(particle));
  });
  return nodes;
}

/** Creates a new node for every given handle. */
function createHandleNodes(handles: Handle[]) {
  const nodes: Map<Handle, HandleNode> = new Map();
  handles.forEach(handle => {
    nodes.set(handle, new HandleNode(handle));
  });
  return nodes;
}

function createSlotNodes(slots: Slot[]) {
  const nodes: Map<Slot, SlotNode> = new Map();
  slots.forEach(slot => {
    nodes.set(slot, new SlotNode(slot));
  });
  return nodes;
}

/** Adds a connection between the given particle and handle nodes. */
function addHandleConnection(particleNode: ParticleNode, handleNode: HandleNode, connection: HandleConnection): Edge {
  switch (connection.direction) {
    case 'in': {
      const edge = new ParticleInput(particleNode, handleNode, connection);
      particleNode.addInEdge(edge);
      handleNode.addOutEdge(edge);
      return edge;
    }
    case 'out': {
      const edge = new ParticleOutput(particleNode, handleNode, connection);
      particleNode.addOutEdge(edge);
      handleNode.addInEdge(edge);
      return edge;
    }
    case 'inout': // TODO: Handle inout directions.
    case 'host':
    default:
      throw new Error(`Unsupported connection type: ${connection.direction}`);
  }
}

/** Adds a connection between the given particle and slot nodes, where the particle "consumes" the slot. */
function addSlotConnection(particleNode: ParticleNode, slotNode: SlotNode, connection: SlotConnection): Edge {
  const edge = new SlotInput(particleNode, slotNode, connection);
  particleNode.addOutEdge(edge);
  slotNode.addInEdge(edge);
  return edge;
}

export abstract class Node {
  abstract readonly inEdges: readonly Edge[];
  abstract readonly outEdges: readonly Edge[];

  abstract addInEdge(edge: Edge): void;
  abstract addOutEdge(edge: Edge): void;

  get inNodes(): Node[] {
    return this.inEdges.map(e => e.start);
  }

  get outNodes(): Node[] {
    return this.outEdges.map(e => e.end);
  }

  abstract inEdgesFromOutEdge(outEdge: Edge): readonly Edge[];
}

export interface Edge {
  readonly start: Node;
  readonly end: Node;
  
  /** The name of the handle/slot this edge represents, e.g. "output1". */
  readonly connectionName: string;
  
  /** The qualified name of the handle/slot this edge represents, e.g. "MyParticle.output1". */
  readonly label: string;

  readonly claim?: Claim;
  readonly check?: Check;
}

export class ParticleNode extends Node {
  readonly inEdgesByName: Map<string, ParticleInput> = new Map();
  readonly outEdgesByName: Map<string, Edge> = new Map();

  readonly name: string;

  // Maps from handle names to tags.
  readonly claims: Map<string, Claim>;
  readonly checks: Check[];

  constructor(particle: Particle) {
    super();
    this.name = particle.name;
    this.claims = particle.spec.trustClaims;
    this.checks = particle.spec.trustChecks;
  }
    
  addInEdge(edge: ParticleInput) {
    this.inEdgesByName.set(edge.connectionName, edge);
  }
  
  addOutEdge(edge: Edge) {
    this.outEdgesByName.set(edge.connectionName, edge);
  }
  
  get inEdges(): readonly ParticleInput[] {
    return [...this.inEdgesByName.values()];
  }

  get outEdges(): readonly Edge[] {
    return [...this.outEdgesByName.values()];
  }

  /**
   * Iterates through all of the relevant in-edges leading into this particle, that flow out into the given out-edge. The out-edge may have a
   * 'derives from' claim that restricts which edges flow into it.
   */
  inEdgesFromOutEdge(outEdge: Edge): readonly ParticleInput[] {
    assert(this.outEdges.includes(outEdge), 'Particle does not have the given out-edge.');

    if (outEdge.claim && outEdge.claim.type === ClaimType.DerivesFrom) {
      const result: ParticleInput[] = [];
      for (const parentHandle of outEdge.claim.parentHandles) {
        const inEdge = this.inEdgesByName.get(parentHandle.name);
        assert(!!inEdge, `Claim derives from unknown handle: ${parentHandle}.`);
        result.push(inEdge);
      }
      return result;
    }

    return this.inEdges;
  }

}

class ParticleInput implements Edge {
  readonly start: Node;
  readonly end: ParticleNode;
  readonly label: string;
  readonly connectionName: string;
  readonly connectionSpec: HandleConnectionSpec;

  /* Optional check on this input. */
  readonly check?: Check;

  constructor(particleNode: ParticleNode, otherEnd: Node, connection: HandleConnection) {
    this.start = otherEnd;
    this.end = particleNode;
    this.connectionName = connection.name;
    this.label = `${particleNode.name}.${this.connectionName}`;
    this.check = connection.spec.check;
    this.connectionSpec = connection.spec;
  }
}

class ParticleOutput implements Edge {
  readonly start: ParticleNode;
  readonly end: Node;
  readonly label: string;
  readonly connectionName: string;
  readonly connectionSpec: HandleConnectionSpec;

  readonly claim?: Claim;

  constructor(particleNode: ParticleNode, otherEnd: Node, connection: HandleConnection) {
    this.start = particleNode;
    this.end = otherEnd;
    this.connectionName = connection.name;
    this.connectionSpec = connection.spec;
    this.label = `${particleNode.name}.${this.connectionName}`;
    this.claim = particleNode.claims.get(this.connectionName);
  }
}

class SlotInput implements Edge {
  readonly start: ParticleNode;
  readonly end: SlotNode;
  readonly label: string;
  readonly connectionName: string;

  constructor(particleNode: ParticleNode, slotNode: SlotNode, connection: SlotConnection) {
    this.start = particleNode;
    this.end = slotNode;
    this.connectionName = connection.name;
    this.label = `${particleNode.name}.${this.connectionName}`;
  }

  get check(): Check | undefined {
    return this.end.check;
  }
}

class HandleNode extends Node {
  readonly inEdges: ParticleOutput[] = [];
  readonly outEdges: ParticleInput[] = [];
  readonly connectionSpecs: Set<HandleConnectionSpec> = new Set();

  constructor(handle: Handle) {
    super();
  }

  /** Returns a list of all pairs of particles that are connected through this handle, in string form. */
  get connectionsAsStrings(): string[] {
    const connections: string[] = [];
    this.inEdges.forEach(inEdge => {
      this.outEdges.forEach(outEdge => {
        connections.push(`${inEdge.label} -> ${outEdge.label}`);
      });
    });
    return connections;
  }

  addInEdge(edge: ParticleOutput) {
    this.inEdges.push(edge);
    this.connectionSpecs.add(edge.connectionSpec);
  }

  addOutEdge(edge: ParticleInput) {
    this.outEdges.push(edge);
    this.connectionSpecs.add(edge.connectionSpec);
  }

  inEdgesFromOutEdge(outEdge: ParticleInput): readonly ParticleOutput[] {
    assert(this.outEdges.includes(outEdge), 'Handle does not have the given out-edge.');
    return this.inEdges;
  }

  validateIsFromHandleCheck(condition: CheckIsFromHandle): boolean {
    // Check if this handle node has the desired HandleConnectionSpec. If so, it is the right handle.
    return this.connectionSpecs.has(condition.parentHandle);
  }
}

class SlotNode extends Node {
  // For now, slots can only have in-edges (from the particles that consume them).
  // TODO: These should be inout edges, because slots can bubble up user events back to these same particles.
  readonly inEdges: SlotInput[] = [];
  readonly outEdges: readonly Edge[] = [];
  
  // Optional check on the data entering this slot. The check is defined by the particle which provided this slot.
  check?: Check;

  constructor(slot: Slot) {
    super();
  }

  addInEdge(edge: SlotInput) {
    this.inEdges.push(edge);
  }

  addOutEdge(edge: Edge) {
    throw new Error(`Slots can't have out-edges (yet).`);
  }

  inEdgesFromOutEdge(outEdge: Edge): never {
    throw new Error(`Slots can't have out-edges (yet).`);
  }
}
