// Record graph for the work drawer's Graph tab: the work, its credits and the
// whole holdings hierarchy drawn as the linked data they are. The work sits at
// the centre. Credited names form a ring sector, grouped by role, and their
// credit edges bundle through one point per role. The holdings tree fans out
// in its own sector, from the work through any FIAF Variants to manifestations,
// items and carriers, and ends at the institutions that hold each item, drawn
// on the rim, so a shared archive shows up as a hub. Related works sit at the
// top.

import { roleLabel } from "./labels.js";
import * as ui from "./ui.js";

// Names drawn per role and in total; the rest are counted in "+N more" nodes.
const PER_ROLE = 12;
const MAX_AGENTS = 36;
// Manifestation, item and carrier nodes drawn in total. Every level is drawn;
// past this many, whole items are left out and counted.
const MAX_HOLDINGS = 2000;
const MAX_RELATED = 6;
// Space around the rings for radial labels.
const LABEL_MARGIN = 122;
// Arc length on the outer ring per labelled node, and per unlabelled leaf of
// each holdings level.
const LABEL_STEP = 12;
const LEAF_STEP = { variant: 10, manifestation: 9, item: 6, carrier: 4.2 };
const MIN_RING = 120;
// Angles kept clear at the top (for related works) and between the holdings
// and the names; a sector never takes less than MIN_SHARE of the circle.
const TOP_GAP = 0.4;
const BOTTOM_GAP = 0.3;
const MIN_SHARE = 0.2;
// Ring position of each holdings level, as a share of the outer ring.
const DEPTH = { manifestation: 0.36, item: 0.64, carrier: 0.86 };
const DEPTH_WITH_VARIANTS = { variant: 0.22, manifestation: 0.42, item: 0.66, carrier: 0.87 };

export const KIND_LABELS = {
  work: "Work",
  related: "Related work",
  variant: "Variant",
  agent: "Name",
  more: "More names",
  manifestation: "Manifestation",
  item: "Item",
  carrier: "Carrier",
  institution: "Holding institution"
};

const RADIUS = {
  work: 9,
  related: 5,
  agent: 4.5,
  more: 3.5,
  variant: 6,
  manifestation: 5.5,
  item: 4,
  carrier: 2.4,
  institution: 5.5
};

// Build nodes and links from the drawer's work state. `titles` supplies the
// display titles the holdings tree already uses, so both tabs name a record
// the same way.
export function workGraphModel({ work, title, agents = [], variants = [], manifestations = [], relations = [], titles = {} }) {
  const name = (kind, data) =>
    (titles[kind] && titles[kind](data)) || data.label || data.id;
  const nodes = new Map();
  const links = [];
  const add = (node) => {
    if (!nodes.has(node.id)) nodes.set(node.id, { degree: 0, ...node });
    return nodes.get(node.id);
  };
  const link = (source, target, kind, role = null) => {
    links.push({ source: source.id, target: target.id, kind, role });
    source.degree += 1;
    target.degree += 1;
  };

  const root = add({ id: work, kind: "work", label: title || work });

  // Names credited in more roles first, so a cap keeps the principal credits.
  const rankedAgents = [...agents].sort(
    (a, b) => b.roles.size - a.roles.size || String(a.name).localeCompare(String(b.name))
  );
  // Each role keeps its first PER_ROLE names; the rest of that role become one
  // "+N more" node, so a large cast does not crowd out the crew.
  const perRole = new Map();
  const moreByRole = new Map();
  const shownAgents = [];
  for (const agent of rankedAgents) {
    const roles = agent.roles.size ? [...agent.roles] : [null];
    const kept = roles.filter((role) => (perRole.get(role) || 0) < PER_ROLE);
    if (!kept.length || shownAgents.length >= MAX_AGENTS) {
      for (const role of roles) moreByRole.set(role, (moreByRole.get(role) || 0) + 1);
      continue;
    }
    for (const role of kept) perRole.set(role, (perRole.get(role) || 0) + 1);
    shownAgents.push({ ...agent, shownRoles: kept });
  }
  for (const agent of shownAgents) {
    const roles = agent.shownRoles.filter(Boolean);
    const node = add({
      id: `agent|${agent.agent}`,
      kind: "agent",
      label: agent.name,
      iri: agent.agent,
      roles
    });
    if (!roles.length) link(node, root, "credit");
    for (const role of roles) link(node, root, "credit", role);
  }
  for (const [role, count] of moreByRole) {
    const node = add({
      id: `more|${role}`,
      kind: "more",
      label: `+${count} more${role ? ` · ${roleLabel(role)}` : ""}`,
      role,
      count
    });
    link(node, root, "credit", role);
  }

  const seenRelated = new Set();
  for (const relation of relations) {
    if (!relation.related || relation.related === work || seenRelated.has(relation.related)) continue;
    if (seenRelated.size >= MAX_RELATED) break;
    seenRelated.add(relation.related);
    const node = add({
      id: `related|${relation.related}`,
      kind: "related",
      label: relation.title || relation.related,
      iri: relation.related,
      relation: relation.relation
    });
    link(root, node, "relation");
  }

  // FIAF Variants sit between the work and the manifestations they group. A
  // manifestation in several variants hangs under the first and is linked to
  // the others; one in none hangs under the work.
  const variantOf = new Map();
  for (const variant of variants) {
    if (!variant.variant) continue;
    const vNode = add({
      id: `variant|${variant.variant}`,
      kind: "variant",
      label: variant.variantLabel || variant.variant,
      iri: variant.variant,
      type: variant.variantType || ""
    });
    link(root, vNode, "holding");
    for (const manifestation of String(variant.manifestations || "").split("|").filter(Boolean)) {
      if (!variantOf.has(manifestation)) variantOf.set(manifestation, []);
      variantOf.get(manifestation).push(vNode);
    }
  }

  const counts = { variant: variants.length, manifestation: 0, item: 0, carrier: 0 };
  for (const manifestation of manifestations) {
    counts.manifestation += 1;
    for (const item of manifestation.items.values()) {
      counts.item += 1;
      counts.carrier += item.carriers.size;
    }
  }
  // Every level is drawn. Only a very large work runs out of budget, and then
  // whole items (with their carriers) are left out, never a single level.
  let budget = MAX_HOLDINGS - counts.manifestation;
  const hidden = {
    agents: rankedAgents.length - shownAgents.length,
    roles: moreByRole.size,
    items: 0,
    carriers: 0
  };

  for (const manifestation of manifestations) {
    const mNode = add({
      id: `manifestation|${manifestation.id}`,
      kind: "manifestation",
      label: name("manifestation", manifestation),
      data: manifestation
    });
    const owners = variantOf.get(manifestation.id) || [];
    link(owners[0] || root, mNode, "holding");
    for (const other of owners.slice(1)) link(other, mNode, "variant-also");
    for (const item of manifestation.items.values()) {
      const cost = 1 + item.carriers.size;
      if (budget < cost) {
        hidden.items += 1;
        hidden.carriers += item.carriers.size;
        continue;
      }
      budget -= cost;
      const iNode = add({
        id: `item|${item.id}`,
        kind: "item",
        label: name("item", item),
        data: item
      });
      link(mNode, iNode, "holding");
      for (const institution of item.institutions || []) {
        if (!institution) continue;
        const hNode = add({
          id: `institution|${institution}`,
          kind: "institution",
          label: institution
        });
        link(iNode, hNode, "institution");
      }
      for (const carrier of item.carriers.values()) {
        const cNode = add({
          id: `carrier|${carrier.id}`,
          kind: "carrier",
          label: name("carrier", carrier),
          data: carrier
        });
        link(iNode, cNode, "holding");
      }
    }
  }

  return { nodes: [...nodes.values()], links, counts, hidden, agents: rankedAgents.length };
}

// Angles are radians clockwise from 12 o'clock, so the right half runs from 0
// to π and the left half from π to 2π.
export function point(angle, distance) {
  return [Math.sin(angle) * distance, -Math.cos(angle) * distance];
}

// Spread `count` positions evenly across [from, to], centred if there is one.
function spread(count, from, to) {
  if (count <= 0) return [];
  if (count <= 1) return [(from + to) / 2];
  return Array.from({ length: count }, (_, index) => from + ((to - from) * index) / (count - 1));
}

// Place every node. Deterministic: a work always draws the same way.
//
// The circle is split into sectors, clockwise from the top: related works
// (just inside the top gap), the holdings tree, then the names. Each sector
// gets an angle in proportion to what it has to fit, but never less than a
// fifth of the circle, and the ring grows until every label and leaf has room.
// Returns the ring radius; the drawing spans ±(ring + LABEL_MARGIN).
export function layoutWorkGraph(model) {
  const of = (kind) => model.nodes.filter((node) => node.kind === kind);
  const names = [...of("agent"), ...of("more")];
  const treeLinks = model.links.filter((entry) => entry.kind === "holding");
  const parent = new Map(treeLinks.map((entry) => [entry.target, entry.source]));
  const children = d3.group(treeLinks, (entry) => entry.source);
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const root = model.nodes.find((node) => node.kind === "work");
  Object.assign(root, { angle: 0, distance: 0, x: 0, y: 0 });

  // Holdings leaves in tree order, so siblings stay together.
  const leaves = [];
  const visit = (id) => {
    const kids = (children.get(id) || []).map((entry) => entry.target);
    if (!kids.length) leaves.push(byId.get(id));
    else kids.forEach(visit);
  };
  for (const entry of children.get(root.id) || []) visit(entry.target);

  const institutions = of("institution");
  const holdingNeed = Math.max(
    d3.sum(leaves, (node) => LEAF_STEP[node.kind] || LABEL_STEP),
    institutions.length * LABEL_STEP * 1.6
  );
  const nameNeed = names.length * LABEL_STEP;
  const both = holdingNeed > 0 && nameNeed > 0;
  const available = 2 * Math.PI - TOP_GAP - (both ? BOTTOM_GAP : 0);
  const total = holdingNeed + nameNeed || 1;
  const weight = (need) => (need ? Math.max(need, total * MIN_SHARE) : 0);
  const share = weight(holdingNeed) / (weight(holdingNeed) + weight(nameNeed) || 1);
  const holdingSpan = available * share;
  const nameSpan = available - holdingSpan;
  const ring = Math.max(
    MIN_RING,
    holdingNeed ? holdingNeed / holdingSpan : 0,
    nameNeed ? nameNeed / nameSpan : 0
  );
  const holdingFrom = TOP_GAP / 2;
  const holdingTo = holdingFrom + holdingSpan;
  const nameFrom = holdingTo + (both ? BOTTOM_GAP : 0);
  const nameTo = 2 * Math.PI - TOP_GAP / 2;

  // Names: grouped by their first role, in order of group size.
  const roleOf = (node) => (node.kind === "more" ? node.role : node.roles[0] ?? null);
  const groups = d3
    .groups(names, roleOf)
    .sort((a, b) => b[1].length - a[1].length || roleLabel(a[0]).localeCompare(roleLabel(b[0])));
  const ordered = groups.flatMap(([, members]) =>
    // "+N more" closes its role group.
    members.sort((a, b) => (a.kind === "more") - (b.kind === "more"))
  );
  const pad = nameSpan > 0 ? Math.min(nameSpan / 2, LABEL_STEP / 2 / ring) : 0;
  const nameAngles = spread(ordered.length, nameFrom + pad, nameTo - pad);
  ordered.forEach((node, index) => place(node, nameAngles[index], ring));
  // Credit edges of one role bend through a shared point at the role group's
  // mean angle.
  const bundles = new Map();
  for (const [role, members] of groups) {
    bundles.set(role, d3.mean(members, (node) => node.angle));
  }
  for (const node of names) {
    for (const role of node.kind === "more" ? [node.role] : node.roles.length ? node.roles : [null]) {
      if (!bundles.has(role)) bundles.set(role, node.angle);
    }
  }

  // Holdings: a radial tree. Each leaf takes an arc in proportion to its
  // level's spacing (carriers are packed tighter than items); a parent sits at
  // the mean angle of its children.
  const depth = of("variant").length ? DEPTH_WITH_VARIANTS : DEPTH;
  const steps = leaves.map((node) => LEAF_STEP[node.kind] || LABEL_STEP);
  const stepTotal = d3.sum(steps) || 1;
  let used = 0;
  leaves.forEach((node, index) => {
    const angle = holdingFrom + ((used + steps[index] / 2) / stepTotal) * holdingSpan;
    used += steps[index];
    place(node, angle, ring * depth[node.kind]);
  });
  const settle = (id) => {
    const node = byId.get(id);
    if (node.angle !== undefined) return node.angle;
    const angle = d3.mean((children.get(id) || []).map((entry) => settle(entry.target)));
    place(node, angle, ring * depth[node.kind]);
    return angle;
  };
  for (const entry of children.get(root.id) || []) settle(entry.target);

  // Institutions on the rim at the mean angle of the items they hold, then
  // pushed apart so their labels do not collide.
  const held = d3.group(
    model.links.filter((entry) => entry.kind === "institution"),
    (entry) => entry.target
  );
  const wanted = institutions
    .map((node) => ({
      node,
      angle: d3.mean(held.get(node.id) || [], (entry) => byId.get(entry.source).angle) ??
        (holdingFrom + holdingTo) / 2
    }))
    .sort((a, b) => a.angle - b.angle);
  const minGap = (LABEL_STEP * 1.6) / ring;
  for (let index = 1; index < wanted.length; index += 1) {
    wanted[index].angle = Math.max(wanted[index].angle, wanted[index - 1].angle + minGap);
  }
  const overflow = wanted.length ? Math.max(0, wanted[wanted.length - 1].angle - holdingTo) : 0;
  for (const entry of wanted) {
    place(entry.node, Math.max(holdingFrom, entry.angle - overflow), ring);
  }

  // Related works fan out above the work.
  const related = of("related");
  spread(related.length, -0.45, 0.45).forEach((angle, index) => {
    place(related[index], (angle + 2 * Math.PI) % (2 * Math.PI), ring * 0.45);
  });

  for (const node of model.nodes) {
    if (node.angle === undefined) place(node, (holdingFrom + holdingTo) / 2, ring * 0.5);
  }
  model.ring = ring;
  model.bundles = bundles;
  model.parent = parent;
  return ring;

  function place(node, angle, distance) {
    node.angle = angle;
    node.distance = distance;
    [node.x, node.y] = point(angle, distance);
  }
}

export function radius(node) {
  const base = RADIUS[node.kind] || 4;
  return node.kind === "institution" ? base + Math.min(6, Math.sqrt(node.degree)) : base;
}

// The other end of every link touching each node, for hover highlighting.
export function neighbourhoods(model) {
  const near = new Map(model.nodes.map((node) => [node.id, new Set([node.id])]));
  for (const entry of model.links) {
    near.get(entry.source)?.add(entry.target);
    near.get(entry.target)?.add(entry.source);
  }
  return near;
}

// Radial links: holdings follow the tree outwards; credits bend through their
// role's bundle point.
function linkPath(model, byId) {
  return (entry) => {
    const source = byId.get(entry.source);
    const target = byId.get(entry.target);
    if (entry.kind === "credit") {
      const [bx, by] = point(model.bundles.get(entry.role) ?? source.angle, model.ring * 0.42);
      return `M${source.x},${source.y}Q${bx},${by} ${target.x},${target.y}`;
    }
    if (entry.kind === "relation") return `M${source.x},${source.y}L${target.x},${target.y}`;
    const middle = (source.distance + target.distance) / 2;
    const [ax, ay] = point(source.distance ? source.angle : target.angle, middle);
    const [bx, by] = point(target.angle, middle);
    return `M${source.x},${source.y}C${ax},${ay} ${bx},${by} ${target.x},${target.y}`;
  };
}

// Labels on the rings read outwards; on the left half they are flipped so the
// text is never upside down.
function labelTransform(node) {
  const degrees = (node.angle * 180) / Math.PI - 90;
  const offset = radius(node) + 4;
  return node.angle > Math.PI
    ? `rotate(${degrees + 180}) translate(${-offset},0)`
    : `rotate(${degrees}) translate(${offset},0)`;
}

export function renderWorkGraph(container, input, { colorFor, describe, onSelect, exportName }) {
  const model = workGraphModel(input);
  const section = ui.node("section", "work-graph");
  container.append(section);
  if (model.nodes.length < 2) {
    section.append(
      ui.node("p", "drawer-section-note", "No credited names or holdings to draw for this work.")
    );
    return;
  }

  const ring = layoutWorkGraph(model);
  const extent = ring + LABEL_MARGIN;
  const size = extent * 2;
  const near = neighbourhoods(model);
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const outer = new Set(["agent", "more", "institution"]);

  // The drawer's own action buttons, with the zoom hint as a drawer note.
  const controls = ui.node("div", "drawer-actions work-graph-controls");
  const hint = ui.node("p", "drawer-section-note work-graph-hint", "Drag to pan · pinch or Ctrl + scroll to zoom");
  const button = (label, title, onClick) => {
    const element = ui.node("button", "drawer-action", label);
    element.type = "button";
    element.title = title;
    element.setAttribute("aria-label", title);
    element.addEventListener("click", onClick);
    controls.append(element);
    return element;
  };
  section.append(controls, hint);

  const svg = d3
    .select(section)
    .append("svg")
    .attr("class", "work-graph-svg")
    .attr("viewBox", `${-extent} ${-extent} ${size} ${size}`)
    .attr("width", size)
    .attr("height", size)
    .attr("role", "img")
    .attr(
      "aria-label",
      `Record graph: ${model.agents} credited names and ${model.counts.item} items in ${model.counts.manifestation} manifestations`
    );

  const view = svg.append("g").attr("class", "work-graph-view");
  // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as one) zooms; a plain
  // wheel keeps scrolling the drawer.
  const zoom = d3
    .zoom()
    .scaleExtent([1, 16])
    .translateExtent([[-extent, -extent], [extent, extent]])
    .filter((event) => (event.type === "wheel" ? event.ctrlKey || event.metaKey : !event.button))
    .on("zoom", (event) => view.attr("transform", event.transform));
  svg.call(zoom);
  button("+", "Zoom in", () => svg.transition().duration(200).call(zoom.scaleBy, 1.6));
  button("−", "Zoom out", () => svg.transition().duration(200).call(zoom.scaleBy, 1 / 1.6));
  button("Reset", "Show the whole graph", () =>
    svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity)
  );
  button("SVG", "Download the record graph as SVG", () =>
    ui.downloadSvg(svg.node(), exportName || "fiaf-record-graph.svg")
  );

  // Thin role arcs behind the name ring mark where each role group starts and ends.
  const roleArcs = d3
    .groups(
      model.nodes.filter((node) => node.kind === "agent" || node.kind === "more"),
      (node) => (node.kind === "more" ? node.role : node.roles[0] ?? null)
    )
    .map(([role, members]) => ({
      role,
      from: d3.min(members, (node) => node.angle),
      to: d3.max(members, (node) => node.angle)
    }));
  const step = (LABEL_STEP / ring) * 0.45;
  view
    .append("g")
    .attr("class", "work-graph-role-arcs")
    .selectAll("path")
    .data(roleArcs)
    .join("path")
    .attr(
      "d",
      d3
        .arc()
        .innerRadius(ring - 10)
        .outerRadius(ring - 8)
        .startAngle((arc) => arc.from - step)
        .endAngle((arc) => arc.to + step)
    )
    .style("fill", (arc) => colorFor(arc.role));

  const linkPaths = view
    .append("g")
    .attr("class", "work-graph-links")
    .selectAll("path")
    .data(model.links)
    .join("path")
    .attr("class", (entry) => `work-graph-link work-graph-link-${entry.kind}`)
    .attr("d", linkPath(model, byId))
    .style("stroke", (entry) => (entry.kind === "credit" ? colorFor(entry.role) : null));

  const nodeGroups = view
    .append("g")
    .attr("class", "work-graph-nodes")
    .selectAll("g")
    .data(model.nodes)
    .join("g")
    .attr("class", (node) => `work-graph-node work-graph-${node.kind}`)
    .attr("transform", (node) => `translate(${node.x},${node.y})`);

  nodeGroups
    .append("circle")
    .attr("r", radius)
    .style("fill", (node) =>
      node.kind === "agent"
        ? colorFor(node.roles[0] || null)
        : node.kind === "more"
          ? colorFor(node.role)
          : null
    );

  nodeGroups
    .filter((node) => outer.has(node.kind))
    .append("text")
    .attr("class", "work-graph-label")
    .attr("transform", labelTransform)
    .attr("dy", "0.32em")
    .attr("text-anchor", (node) => (node.angle > Math.PI ? "end" : "start"))
    .text((node) => ui.truncate(node.label, 18));
  nodeGroups
    .filter((node) => ["work", "related", "variant"].includes(node.kind))
    .append("text")
    .attr("class", "work-graph-label")
    .attr("dy", (node) => (node.kind === "work" ? "2em" : "-0.9em"))
    .attr("text-anchor", "middle")
    .text((node) => ui.truncate(node.label, node.kind === "work" ? 30 : 20));

  const clickable = (node) => node.kind !== "work" && node.kind !== "institution";
  nodeGroups
    .attr("tabindex", 0)
    .attr("role", (node) => (clickable(node) ? "button" : null))
    .attr("aria-label", (node) => `${KIND_LABELS[node.kind]}: ${node.label}${clickable(node) ? ". Activate to open." : ""}`)
    .classed("is-clickable", clickable);

  // A holding's neighbourhood includes its whole chain back to the work, so
  // hovering a carrier lights up the item and manifestation it belongs to.
  const chain = (node) => {
    const set = new Set(near.get(node.id));
    for (let id = model.parent.get(node.id); id; id = model.parent.get(id)) set.add(id);
    return set;
  };
  const highlight = (node) => {
    const set = node ? chain(node) : null;
    svg.classed("has-focus", Boolean(node));
    nodeGroups.classed("is-dim", (other) => Boolean(set) && !set.has(other.id));
    linkPaths.classed(
      "is-dim",
      (entry) => Boolean(set) && !(set.has(entry.source) && set.has(entry.target) &&
        (entry.source === node.id || entry.target === node.id || model.parent.get(entry.target) === entry.source))
    );
  };
  const tooltipBody = (node) => {
    const parts = [KIND_LABELS[node.kind]];
    if (node.kind === "agent" && node.roles.length) parts.push(node.roles.map(roleLabel).join(", "));
    if (node.kind === "institution") parts.push(`${ui.formatNumber(node.degree)} items`);
    const extra = describe ? describe(node) : "";
    if (extra) parts.push(extra);
    return parts.join(" · ");
  };
  const activate = (node) => {
    if (!clickable(node)) return;
    ui.hideTooltip();
    onSelect(node);
  };

  nodeGroups
    .on("mouseenter", (event, node) => {
      highlight(node);
      ui.showTooltip(event, node.label, tooltipBody(node));
    })
    .on("mousemove", ui.moveTooltip)
    .on("mouseleave", () => {
      highlight(null);
      ui.hideTooltip();
    })
    .on("focus", (_event, node) => highlight(node))
    .on("blur", () => highlight(null))
    .on("click", (_event, node) => activate(node))
    .on("keydown", (event, node) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate(node);
      }
    });

  section.append(legend(model, colorFor));
  section.append(ui.node("p", "drawer-section-note", notes(model).join(" · ")));
}

function legend(model, colorFor) {
  const list = ui.node("ul", "work-graph-legend");
  const kinds = new Set(model.nodes.map((node) => node.kind));
  for (const kind of ["work", "related", "variant", "manifestation", "item", "carrier", "institution"]) {
    if (!kinds.has(kind)) continue;
    const entry = ui.node("li", "");
    entry.append(ui.node("span", `work-graph-swatch work-graph-swatch-${kind}`));
    entry.append(document.createTextNode(KIND_LABELS[kind]));
    list.append(entry);
  }
  const roles = d3.rollups(
    model.links.filter((entry) => entry.kind === "credit" && entry.role),
    (entries) => entries.length,
    (entry) => entry.role
  ).sort((a, b) => b[1] - a[1]);
  for (const [role] of roles.slice(0, 8)) {
    const entry = ui.node("li", "");
    const swatch = ui.node("span", "work-graph-swatch work-graph-swatch-role");
    swatch.style.background = colorFor(role);
    entry.append(swatch, document.createTextNode(roleLabel(role)));
    list.append(entry);
  }
  return list;
}

function notes(model) {
  const { counts, hidden } = model;
  const institutions = model.nodes.filter((node) => node.kind === "institution").length;
  return [
    count(model.agents, "name", "names"),
    counts.variant ? count(counts.variant, "variant", "variants") : null,
    count(counts.manifestation, "manifestation", "manifestations"),
    count(counts.item, "item", "items"),
    counts.carrier ? count(counts.carrier, "carrier", "carriers") : null,
    institutions ? count(institutions, "holding institution", "holding institutions") : null,
    hidden.agents ? `${count(hidden.agents, "name", "names")} grouped as “more”` : null,
    hidden.items ? `${count(hidden.items, "item", "items")} not drawn` : null,
    hidden.carriers ? `${count(hidden.carriers, "carrier", "carriers")} not drawn` : null
  ].filter(Boolean);
}

function count(value, singular, plural) {
  return `${ui.formatNumber(value)} ${value === 1 ? singular : plural}`;
}

