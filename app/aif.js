/**
 * Exporting a debate as an argument graph, in the Argument Interchange Format.
 *
 * This is interoperability rather than a feature. Structured argument tooling
 * has a fifty-year lineage and a standard for exchanging graphs, so a debate
 * recorded here should be able to move into that world instead of competing with
 * it. See "Where this sits" in the README.
 *
 * What AIF is, from the specification:
 *
 *  - **I-nodes** carry propositions.
 *  - **S-nodes** carry applications of schemes: `RA` for an inference, `CA` for a
 *    conflict, `PA` for a preference.
 *  - Edges are untyped, and the graph obeys constraints, of which two matter
 *    here: **no edge runs I-node to I-node**, and an `RA` node has at least one
 *    premise and at most one conclusion.
 *
 * That second constraint is the reason this mapping is worth having. A move whose
 * claim is supported by nothing cannot become an `RA` node, because an inference
 * without premises is not an inference. So an uncited assertion exports as a bare
 * proposition — which is exactly what the linter says about it, in the standard's
 * own terms.
 *
 * The dialogue extension (L-nodes carrying "speaker: text", and YA-nodes
 * anchoring a locution to the proposition it asserts) is used so that who said
 * what survives the trip. This targets the xAIF JSON profile: `AIF.nodes`,
 * `AIF.edges`, `AIF.locutions`, `AIF.participants`.
 *
 * What is deliberately not emitted: `PA` nodes. Preference between arguments is a
 * real AIF concept, and this record does not have one — it records concessions
 * and contests, which are not the same thing. Inventing a preference ordering
 * would be putting words in the participants' mouths.
 *
 * DOM-free and dependency-free, so scripts/check.mjs can check the graph against
 * the constraints above.
 */

/** AIF's own rules, checked on the graph this file produces. */
export function aifProblems(aif) {
  const problems = [];
  const nodes = new Map((aif?.AIF?.nodes || []).map((node) => [String(node.nodeID), node]));
  const edges = aif?.AIF?.edges || [];

  for (const edge of edges) {
    const from = nodes.get(String(edge.fromID));
    const to = nodes.get(String(edge.toID));
    if (!from) problems.push(`edge ${edge.edgeID} starts at ${edge.fromID}, which is not a node`);
    if (!to) problems.push(`edge ${edge.edgeID} ends at ${edge.toID}, which is not a node`);
    if (!from || !to) continue;
    // Definition 1.1: E ⊆ V × V \ I × I.
    if (from.type === 'I' && to.type === 'I') {
      problems.push(`edge ${edge.edgeID} runs I-node to I-node, which AIF forbids`);
    }
  }

  const incoming = (id) => edges.filter((edge) => String(edge.toID) === String(id));
  const outgoing = (id) => edges.filter((edge) => String(edge.fromID) === String(id));

  for (const node of nodes.values()) {
    if (node.type !== 'RA' && node.type !== 'CA') continue;
    const premises = incoming(node.nodeID);
    const conclusions = outgoing(node.nodeID);
    if (!premises.length) problems.push(`${node.type} node ${node.nodeID} has no premise, which AIF forbids`);
    if (node.type === 'RA' && !conclusions.length) {
      problems.push(`RA node ${node.nodeID} has no conclusion`);
    }
    if (conclusions.length > 1) {
      problems.push(`${node.type} node ${node.nodeID} has ${conclusions.length} conclusions; AIF allows at most one`);
    }
  }

  for (const locution of aif?.AIF?.locutions || []) {
    if (locution.personID && !(aif?.AIF?.participants || []).some((p) => String(p.personID) === String(locution.personID))) {
      problems.push(`locution ${locution.nodeID} names a participant who is not listed`);
    }
  }

  return problems;
}

/**
 * A debate as an AIF graph.
 *
 * Mapping, so the choices are reviewable:
 *
 *  - each side becomes a participant
 *  - each move becomes an L-node (the locution, "speaker: claim"), a YA-node
 *    anchoring it, and an I-node for the proposition asserted
 *  - a move's evidence and its warrant become I-nodes, and the move becomes an
 *    RA-node with those as premises and its claim as the conclusion — but only
 *    if it has at least one premise
 *  - an objection becomes a CA-node relating the objecting claim to the claim it
 *    attacks
 *  - the motion is an I-node, since it is the proposition under dispute
 */
export function debateToAif(debate) {
  const nodes = [];
  const edges = [];
  const locutions = [];
  const participants = [];
  let nextEdge = 1;

  const addNode = (nodeID, type, text = '') => {
    nodes.push({ nodeID: String(nodeID), type, text: String(text ?? '') });
    return String(nodeID);
  };
  const addEdge = (fromID, toID) => {
    edges.push({ edgeID: String(nextEdge), fromID: String(fromID), toID: String(toID) });
    nextEdge += 1;
  };

  for (const side of debate?.sides || []) {
    participants.push({ personID: String(side.id), name: side.name || side.id, role: side.position || '' });
  }

  // The proposition under dispute, recorded so a reader of the graph knows what
  // the argument is about. It carries no edges: see the note at the end.
  addNode('motion', 'I', debate?.motion || '');

  const claimNode = (moveId) => `claim_${moveId}`;
  const warrantNode = (moveId) => `warrant_${moveId}`;
  const evidenceNode = (moveId, index) => `evidence_${moveId}_${index}`;

  for (const move of debate?.moves || []) {
    const id = String(move.id);
    const side = (debate.sides || []).find((entry) => entry.id === move.side);

    // The proposition asserted.
    addNode(claimNode(id), 'I', move.claim || '');

    // The locution, in xAIF's "speaker: text" convention, anchored by a YA-node.
    // The same string is used in the node and in the locution entry: two
    // representations of one fact that disagree is a bug waiting to be read as
    // a discrepancy in the argument.
    const spoken = `${side?.name || move.side || 'someone'}: ${move.claim || ''}`;
    addNode(`l_${id}`, 'L', spoken);
    addNode(`ya_${id}`, 'YA', move.kind || 'argument');
    locutions.push({
      nodeID: `l_${id}`,
      personID: String(move.side || ''),
      timestamp: move.at || '',
      text: spoken,
      claim: move.claim || '',
      kind: move.kind || 'argument',
    });
    addEdge(`l_${id}`, `ya_${id}`);
    addEdge(`ya_${id}`, claimNode(id));

    // Premises: the reason given, and anything cited.
    const premises = [];
    if (move.warrant) {
      addNode(warrantNode(id), 'I', move.warrant);
      premises.push(warrantNode(id));
    }
    for (const [index, item] of (move.evidence || []).entries()) {
      addNode(evidenceNode(id, index), 'I', [item.source, item.locator].filter(Boolean).join(' · '));
      premises.push(evidenceNode(id, index));
    }

    // An inference needs at least one premise, so a bare assertion stays a bare
    // assertion. That is the point rather than a limitation.
    if (premises.length) {
      addNode(`ra_${id}`, 'RA', '');
      for (const premise of premises) addEdge(premise, `ra_${id}`);
      addEdge(`ra_${id}`, claimNode(id));
    }

    // Conflict: an objection is a claim conflicting with the claim it attacks.
    if (move.kind === 'objection' && (move.targets || []).length) {
      addNode(`ca_${id}`, 'CA', '');
      addEdge(claimNode(id), `ca_${id}`);
      for (const target of move.targets) addEdge(`ca_${id}`, claimNode(String(target)));
    }

    // Nothing is asserted to follow from the motion, so no edge is drawn to it.
    // An opening move argues *about* the motion; claiming an inference from one
    // to the other would invent a premise-and-conclusion relation the record
    // does not make, and an I-node to I-node edge would be invalid AIF anyway.
    // The motion therefore stands as an isolated proposition: AIF allows I-nodes
    // with no incoming edges.
  }

  return {
    AIF: { nodes, edges, schemefulfillments: [], descriptorfulfillments: [], participants, locutions },
    text: debate?.motion || '',
    dialog: true,
  };
}
