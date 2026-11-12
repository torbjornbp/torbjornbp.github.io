// Pure models for the ontology view: the FIAFcore class tree with instance
// counts, and the schema graph of what each property connects. Built from the
// rows of the ontology-*.rq queries, so they can be tested without a browser.

export const FIAF_NS = "https://dev.fiafcore.org/";
const ROOT_ID = "fiafcore";

const isFiaf = (iri) => typeof iri === "string" && iri.startsWith(FIAF_NS);
const localName = (iri) => String(iri || "").slice(FIAF_NS.length) || String(iri || "");

// The class tree. Each class gets:
//   direct: instances typed with exactly this class
//   values: times the class itself is used as a value (fiaf:Germany as a
//           production country), and valueTotal the same over the subtree
//   uses:   total + valueTotal, what the tree is shaded and sized by
//   total:  instances of this class or any subclass. Records are typed with
//           their most specific class only, so adding up the subtree gives
//           "instances of this class" (a handful of records carry two types,
//           which this counts twice; that is well under 0.1% of the graph).
// A class with two parents (fiaf:Nauru is a Country and a Language) sits under
// the first in the tree and keeps the others in `otherParents`.
export function classTree(classRows, usageRows = [], valueRows = []) {
  const classes = new Map();
  const ensure = (iri) => {
    if (!classes.has(iri)) {
      classes.set(iri, {
        id: iri,
        label: localName(iri),
        description: "",
        parents: [],
        children: [],
        direct: 0,
        total: 0,
        values: 0,
        valueTotal: 0,
        uses: 0
      });
    }
    return classes.get(iri);
  };
  for (const row of classRows) {
    if (!isFiaf(row.class)) continue;
    const node = ensure(row.class);
    if (row.label) node.label = row.label;
    if (row.description) node.description = row.description;
    node.parents = String(row.parents || "")
      .split("|")
      .filter((parent) => isFiaf(parent) && parent !== row.class)
      .sort();
    for (const parent of node.parents) ensure(parent);
  }
  for (const row of usageRows) {
    if (!isFiaf(row.class)) continue;
    ensure(row.class).direct = Number(row.instances) || 0;
  }
  for (const row of valueRows) {
    if (!isFiaf(row.class)) continue;
    ensure(row.class).values = Number(row.uses) || 0;
  }

  const root = {
    id: ROOT_ID,
    label: "FIAFcore",
    description: "Every class in the FIAFcore ontology.",
    parents: [],
    children: [],
    direct: 0,
    total: 0,
    values: 0,
    valueTotal: 0,
    uses: 0
  };
  for (const node of classes.values()) {
    const [first, ...others] = node.parents;
    node.parent = first ? classes.get(first) : root;
    node.otherParents = others;
    node.parent.children.push(node);
  }
  // Guard against a cycle in the data: a class that cannot reach the root
  // through its parents is hung directly under it.
  for (const node of classes.values()) {
    const seen = new Set();
    let step = node;
    while (step && step !== root && !seen.has(step)) {
      seen.add(step);
      step = step.parent;
    }
    if (step !== root) {
      node.parent.children = node.parent.children.filter((child) => child !== node);
      node.parent = root;
      root.children.push(node);
    }
  }
  const sum = (node) => {
    node.children.sort((a, b) => a.label.localeCompare(b.label));
    for (const child of node.children) sum(child);
    node.total = node.direct + node.children.reduce((total, child) => total + child.total, 0);
    node.valueTotal = node.values + node.children.reduce((total, child) => total + child.valueTotal, 0);
    node.uses = node.total + node.valueTotal;
  };
  sum(root);
  return { root, classes };
}

// The top-level class (directly under the root) that a class belongs to.
export function rootClassOf(tree, iri) {
  let node = tree.classes.get(iri);
  if (!node) return null;
  while (node.parent && node.parent.id !== ROOT_ID) node = node.parent;
  return node;
}

export function ancestors(tree, iri) {
  const path = [];
  for (let node = tree.classes.get(iri); node && node.id !== ROOT_ID; node = node.parent) {
    path.unshift(node);
  }
  return path;
}

// Special nodes for objects that are not records of a FIAFcore class.
export const LITERAL = "literal";
export const UNTYPED = "untyped";

// The schema graph, at the level of the top-level classes. Each sampled
// (subject type, object class) pair for a property is scaled by that
// property's real triple count, so edges carry an estimate of how many
// triples connect the two classes. Values that are themselves classes (the
// country fiaf:Germany, the format fiaf:35mmFilm) are attributed to their
// top-level class and flagged as class values.
export function schemaGraph(tree, properties, samples) {
  const nodes = new Map();
  const edges = new Map();
  const node = (id, extra = {}) => {
    if (!nodes.has(id)) {
      const cls = tree.classes.get(id);
      nodes.set(id, {
        id,
        label: cls ? cls.label : id === LITERAL ? "Literal value" : "Untyped",
        instances: cls ? cls.total : 0,
        kind: cls ? "class" : id,
        ...extra
      });
    }
    return nodes.get(id);
  };
  const top = (iri) => {
    const cls = isFiaf(iri) ? rootClassOf(tree, iri) : null;
    return cls ? cls.id : UNTYPED;
  };

  for (const property of properties) {
    const rows = samples.get(property.property) || [];
    const sampled = rows.reduce((total, row) => total + (Number(row.sampled) || 0), 0);
    if (!sampled) continue;
    const scale = (Number(property.triples) || 0) / sampled;
    for (const row of rows) {
      const source = top(row.subjectType);
      const target = row.objectKind === LITERAL ? LITERAL : top(row.objectClass);
      node(source);
      node(target);
      const key = `${source}|${property.property}|${target}`;
      if (!edges.has(key)) {
        edges.set(key, {
          id: key,
          source,
          target,
          property: property.property,
          label: property.label || localName(property.property),
          description: property.description || "",
          classValues: row.objectKind === "class",
          sampled: 0,
          estimate: 0,
          pairs: []
        });
      }
      const edge = edges.get(key);
      const count = Number(row.sampled) || 0;
      edge.sampled += count;
      edge.estimate += count * scale;
      edge.pairs.push({ subjectType: row.subjectType, objectClass: row.objectClass, objectKind: row.objectKind, sampled: count });
    }
  }
  for (const edge of edges.values()) {
    edge.estimate = Math.round(edge.estimate);
    edge.pairs.sort((a, b) => b.sampled - a.sampled);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()].sort((a, b) => b.estimate - a.estimate) };
}

// The literal-valued properties of one top-level class (dates, title values,
// identifier values), which the schema graph lists instead of drawing.
export function literalProperties(graph, classId) {
  return graph.edges
    .filter((edge) => edge.source === classId && edge.target === LITERAL)
    .sort((a, b) => b.estimate - a.estimate);
}

// Ready-made queries for the catalogue's SPARQL box.
export function classQuery(iri) {
  return `PREFIX fiaf: <${FIAF_NS}>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

# Records typed ${shortIri(iri)} (not its subclasses).
SELECT ?record (SAMPLE(?name) AS ?label)
WHERE {
  ?record a ${shortIri(iri)} .
  OPTIONAL { ?record rdfs:label ?labelValue }
  OPTIONAL { ?record fiaf:hasTitle/fiaf:hasTitleValue ?title }
  BIND(COALESCE(?labelValue, ?title) AS ?name)
}
GROUP BY ?record
LIMIT 100`;
}

export function propertyQuery(iri) {
  return `PREFIX fiaf: <${FIAF_NS}>

# Triples that use ${shortIri(iri)}, with the subject and object types.
SELECT ?subject ?subjectType ?object ?objectType
WHERE {
  ?subject ${shortIri(iri)} ?object .
  OPTIONAL { ?subject a ?subjectType }
  OPTIONAL { ?object a ?objectType }
}
LIMIT 100`;
}

function shortIri(iri) {
  return isFiaf(iri) && /^[A-Za-z_][\w-]*$/.test(localName(iri)) ? `fiaf:${localName(iri)}` : `<${iri}>`;
}
