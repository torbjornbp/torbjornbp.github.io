// People › Roles, in three modes:
//
// - Sunburst: activity group → role → busiest loaded names per role. The
//   groups are the roles' FIAFcore superclasses (role-groups.rq); clicking a
//   group or role zooms into it. The outer ring is built from the shared agent page (agents.rq) instead of
//   a separate role/agent query. A single global LIMIT on that query could
//   not give every role its busiest names (popular roles consumed the whole
//   budget), and the agent page is already loaded and cached for the
//   name-based views.
// - Combinations: a chord of the roles the same name holds, from
//   role-pairs.rq, which counts every credited name, not only loaded ones.
// - Most roles: the names credited in the most distinct roles.
//
// The combination and list queries load the first time their mode is shown
// and are kept per dataset selection.

import { roleLabel } from "./labels.js";
import { drawChord } from "./chord.js";
import { OTHER, chordColours, mostRoles, roleChord, roleSets } from "./role-combinations.js";
import { runQuery, sparqlIri } from "./sparql.js";
import * as ui from "./ui.js";

const NAMES_PER_ROLE = 8;
const LIST_NAMES = 50;
const MODES = ["sunburst", "chord", "list"];
const DESCRIPTIONS = {
  sunburst: "Roles grouped by activity and sized by works; outer ring shows the busiest names per role. Click a group or role to look closer.",
  chord: "Roles held by the same name. A ribbon is as wide as the names credited in both roles; hover for counts.",
  list: "The names credited in the most different roles. Click a name to open it."
};

function hexChannels(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ""));
  if (!match) return null;
  const number = parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

// Whether a colour, laid over the backdrop at the given opacity, is light
// enough to need dark type.
function isLightColour(value, opacity = 1, backdrop = "#ffffff") {
  const colour = hexChannels(value);
  if (!colour) return false;
  const base = hexChannels(backdrop) || [255, 255, 255];
  const [red, green, blue] = colour.map(
    (channel, index) => channel * opacity + base[index] * (1 - opacity)
  );
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.45;
}

// Cut a label to roughly fit a length in pixels at the chart type size.
function fitLabel(text, pixels) {
  const chars = Math.floor(pixels / 6.6);
  if (chars < 4) return "";
  return text.length > chars ? `${text.slice(0, chars - 1).trimEnd()}…` : text;
}

const FULL_TURN = 2 * Math.PI - 1e-6;
const OPACITY = { group: 0.95, role: 0.8, name: 0.55 };

export function create(ctx, root, statsElement) {
  let data = null;
  let lastSelection = null;
  let arcs = null;
  let hasRendered = false;
  let mode = "sunburst";
  // Per dataset selection: { scope, sets } and { scope, entries }.
  let combos = null;
  let listed = null;
  let modeToken = 0;
  let chordView = null;
  let chordModel = null;
  // The sunburst's zoom: [] for every group, [group] or [group, role].
  let focusPath = [];
  const svg = d3
    .select(root)
    .append("svg")
    .attr("role", "img")
    .attr("aria-label", "Sunburst of credit roles and names");

  svg.on("click", () => ui.closeDrawer());

  const modeButtons = [...document.querySelectorAll("[data-roles-mode]")];
  const listRoot = document.getElementById("roles-list");
  const descriptionElement = document.getElementById("roles-description");
  const exportButton = document.querySelector('[data-export="roles"]');
  const filterButton = document.getElementById("roles-filter-role");

  if (filterButton) {
    filterButton.addEventListener("click", () => {
      const focus = focusNode();
      if (!focus) return;
      const iris = focus.kind === "group" ? focus.children.map((role) => role.iri) : [focus.iri];
      ctx.onlyRoles(iris);
    });
  }

  // The group or role the sunburst is zoomed into, or null. A zoom whose
  // group or role has been filtered out falls back to what is left of it.
  function focusNode() {
    if (mode !== "sunburst" || !data || !focusPath.length) return null;
    const group = data.children.find((entry) => entry.iri === focusPath[0]);
    if (!group) return null;
    if (focusPath.length < 2) return group;
    return group.children.find((entry) => entry.iri === focusPath[1]) || group;
  }

  function syncFilterButton() {
    if (!filterButton) return;
    const focus = focusNode();
    filterButton.disabled = !focus;
    filterButton.title = focus
      ? `Keep only ${focus.kind === "group" ? `the ${focus.label} roles` : focus.label} in the Roles filter and open the name cloud`
      : "Zoom into a group or role in the sunburst first";
  }

  function zoom(path) {
    focusPath = path;
    ui.hideTooltip();
    render();
  }

  function syncControls() {
    for (const button of modeButtons) {
      const active = button.dataset.rolesMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (descriptionElement) descriptionElement.textContent = DESCRIPTIONS[mode];
    // The list is HTML; there is no chart to download.
    if (exportButton) exportButton.disabled = mode === "list";
    root.hidden = mode === "list";
    if (listRoot) listRoot.hidden = mode !== "list";
    syncFilterButton();
  }

  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      const next = button.dataset.rolesMode;
      // Pressing the current mode again retries a load that failed.
      if (!MODES.includes(next) || (next === mode && modeLoaded())) return;
      mode = next;
      ui.hideTooltip();
      syncControls();
      loadMode().catch(showModeError);
    });
  }
  syncControls();

  function modeLoaded() {
    const scope = ctx.scopeFilter();
    if (mode === "chord") return Boolean(combos && combos.scope === scope);
    if (mode === "list") return Boolean(listed && listed.scope === scope);
    return true;
  }

  function showModeError(error) {
    if (error.name === "AbortError") return;
    const label = mode === "list" ? "Most roles" : "Combinations";
    ui.setStatus(`${label} could not be loaded: ${error.message}`, "error");
    ui.error(
      mode === "list" && listRoot ? listRoot : root,
      error,
      `Press ${label} again to retry.`
    );
  }

  async function load({ signal } = {}) {
    if (!hasRendered) {
      ui.message(root, "Loading roles…");
    }
    ui.setStatus("Loading role distribution…");
    const [roles, agentData, groups] = await Promise.all([
      ctx.filteredRoles(),
      ctx.agentData(),
      ctx.roleGroups()
    ]);
    if (signal && signal.aborted) return;
    data = build(roles, agentData, groups);
    hasRendered = true;
    ui.setStatus("");
    await loadMode({ signal });
  }

  // Load what the current mode needs, then draw it.
  async function loadMode({ signal } = {}) {
    const token = ++modeToken;
    const scope = ctx.scopeFilter();
    if (mode === "chord" && (!combos || combos.scope !== scope)) {
      ui.message(root, "Counting role combinations…");
      ui.setStatus("Counting the roles each name holds…");
      const rows = await runQuery("role-pairs", { SCOPE_FILTER: scope }, { signal });
      if (token !== modeToken) return;
      combos = { scope, sets: roleSets(rows) };
    }
    if (mode === "list" && (!listed || listed.scope !== scope)) {
      if (listRoot) ui.message(listRoot, "Finding the names with the most roles…");
      ui.setStatus("Finding the names with the most roles…");
      const rows = await runQuery(
        "agents-most-roles",
        { SCOPE_FILTER: scope, LIMIT: String(LIST_NAMES) },
        { signal }
      );
      if (token !== modeToken) return;
      const works = rows.length
        ? await runQuery(
            "agent-role-works",
            { SCOPE_FILTER: scope, AGENT_IRIS: rows.map((row) => sparqlIri(row.agent)).join(" ") },
            { signal }
          )
        : [];
      if (token !== modeToken) return;
      listed = { scope, entries: mostRoles(rows, works) };
    }
    if (token !== modeToken) return;
    // Also clears a loading message left by a mode the visitor switched away
    // from before its query answered.
    ui.setStatus("");
    draw();
  }

  function build(roles, agentData, groups) {
    const byRole = new Map();
    for (const row of agentData.rows) {
      if (Number(row.works) < ctx.state.minWorks) continue;
      for (const entry of agentData.roleMap.get(row.agent) || []) {
        if (!byRole.has(entry.role)) byRole.set(entry.role, []);
        byRole.get(entry.role).push({
          agent: row.agent,
          name: row.name,
          works: entry.works
        });
      }
    }
    const roleNodes = roles
      .filter((role) => Number(role.works) > 0)
      .map((role) => {
        const total = Number(role.works) || 0;
        const top = (byRole.get(role.iri) || [])
          .sort((a, b) => b.works - a.works)
          .slice(0, NAMES_PER_ROLE);
        const topSum = d3.sum(top, (entry) => entry.works);
        const scale = topSum > total && topSum > 0 ? total / topSum : 1;
        const names = top.map((entry) => ({
          kind: "name",
          name: entry.name,
          agent: entry.agent,
          works: entry.works,
          value: entry.works * scale
        }));
        return {
          kind: "role",
          iri: role.iri,
          group: groups.get(role.iri) || role.iri,
          label: roleLabel(role.iri),
          works: total,
          value: Math.max(0, total - d3.sum(names, (entry) => entry.value)),
          children: names
        };
      });

    const byGroup = new Map();
    for (const role of roleNodes) {
      if (!byGroup.has(role.group)) byGroup.set(role.group, []);
      byGroup.get(role.group).push(role);
    }
    const children = [...byGroup].map(([iri, members]) => {
      members.sort((a, b) => b.works - a.works);
      // A group class credited in its own right (fiaf:SoundActivity) sits
      // beside its narrower roles; say so rather than repeat the group name.
      for (const role of members) {
        if (role.iri === iri && members.length > 1) role.label = `${role.label} (general)`;
      }
      return {
        kind: "group",
        iri,
        label: roleLabel(iri),
        works: d3.sum(members, (role) => role.works),
        // Colour a group as its busiest role, so it matches the cloud.
        colour: members[0].iri,
        children: members
      };
    });

    const ringAgents = new Set();
    for (const role of roleNodes) {
      for (const name of role.children) ringAgents.add(name.agent);
    }
    return { children, roleCount: roleNodes.length, nameCount: agentData.rows.length, ringAgents };
  }

  // Remember the container size of the last draw so a tab revisit or a drawer
  // toggle that leaves it unchanged does not rebuild the chart.
  let drawnSize = "";
  const containerSize = () => `${root.clientWidth}x${root.clientHeight}`;

  function draw() {
    if (mode === "chord") {
      if (combos) renderChord();
    } else if (mode === "list") {
      if (listed) renderList();
    } else {
      render();
    }
    drawnSize = containerSize();
  }

  // The roles in the Roles filter; all of them while the filter is unused.
  function roleIncluded(role) {
    return !ctx.state.roles.length || ctx.state.selectedRoles.has(role);
  }

  function roleName(role) {
    return role === OTHER ? "Other roles" : roleLabel(role);
  }

  function renderChord() {
    arcs = null;
    chordModel = roleChord(combos.sets, roleIncluded);
    const { roles, matrix } = chordModel;
    if (roles.length < 2) {
      chordView = null;
      ui.empty(root, "No name holds two of the selected roles.");
      statsElement.textContent = "";
      return;
    }
    ui.clear(root);
    // A group, not an image, so each focusable arc and ribbon keeps its label.
    svg.attr("role", "group").attr("aria-label", "Chord diagram of the roles held by the same name");
    // On a phone the labels get less room and fewer characters, so the
    // chord and its labels fit the column instead of being cut at the sides;
    // tooltips and aria labels keep the full names.
    const width = Math.max(280, root.clientWidth || 900);
    const height = Math.max(420, root.clientHeight || 640);
    const tiny = width < 480;
    const compact = width < 720;
    const labelRoom = tiny ? 66 : compact ? 86 : 118;
    const labelChars = tiny ? 10 : compact ? 14 : 22;
    const outer = Math.max(70, Math.min(width, height) / 2 - labelRoom);
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);
    svg.selectAll("*").remove();

    const pairText = (chord) =>
      `${ui.formatNumber(chord.source.value)} ${chord.source.value === 1 ? "name" : "names"} credited in both`;
    chordView = drawChord(svg, {
      matrix,
      centre: [width / 2, height / 2],
      outer,
      fills: chordColours(roles, ctx.colorFor),
      // The merged Other roles arc is outlined as the remainder.
      arcStroke: (index) => (roles[index] === OTHER ? "var(--muted)" : "var(--surface)"),
      labels: roles.map(roleName),
      labelChars,
      fontSize: compact ? 10 : 11,
      arcTitle: (index) => roleName(roles[index]),
      arcBody: arcText,
      ribbonTitle: (chord) =>
        `${roleName(roles[chord.source.index])} · ${roleName(roles[chord.target.index])}`,
      ribbonBody: pairText,
      // Leaving a mark restores the selected name's highlight, if any.
      onRest: () => paintChord()
    });

    const { names, multi, otherRoles } = chordModel;
    const selectedRoles = ctx.state.selectedRoles.size;
    const totalRoles = ctx.state.roles.length;
    statsElement.textContent =
      `${ui.formatNumber(multi)} of ${ui.formatNumber(names)} credited names hold two or more ` +
      (selectedRoles < totalRoles ? "of the selected roles" : "roles") +
      ` · ${ui.formatNumber(roles.length)} arcs` +
      (otherRoles.length ? `, ${ui.formatNumber(otherRoles.length)} smaller roles under Other roles` : "") +
      " · ribbon width = names credited in both roles";
    paintChord();
  }

  function arcText(index) {
    const { roles, matrix, named, combining, otherRoles } = chordModel;
    const partners = matrix[index].filter(Boolean).length;
    if (roles[index] === OTHER) {
      return (
        `${ui.formatNumber(otherRoles.length)} smaller roles combined, such as ` +
        `${otherRoles.slice(0, 3).map(roleLabel).join(", ")}`
      );
    }
    return (
      `${ui.formatNumber(combining[index])} of ${ui.formatNumber(named[index])} names in this role ` +
      `also hold another, across ${ui.formatNumber(partners)} of the roles shown`
    );
  }

  // With a name selected, only the ribbons between two of its roles stay.
  function paintChord() {
    if (!chordView || !chordModel) return;
    const roles = lastSelection && lastSelection.kind === "agent" ? lastSelection.roles || [] : [];
    if (roles.length < 2) {
      chordView.rest();
      return;
    }
    const held = new Set(roles);
    const otherHeld = roles.some((role) => chordModel.otherRoles.includes(role));
    const holds = (index) =>
      chordModel.roles[index] === OTHER ? otherHeld : held.has(chordModel.roles[index]);
    chordView.fade((chord) => holds(chord.source.index) && holds(chord.target.index));
  }

  function renderList() {
    arcs = null;
    chordView = null;
    if (!listRoot) return;
    const entries = listed.entries;
    if (!entries.length) {
      ui.empty(listRoot, "No name holds more than one role in this selection.");
      statsElement.textContent = "";
      return;
    }
    ui.clear(listRoot);
    const table = ui.node("table", "catalogue-table roles-table");
    const head = ui.node("thead", "");
    const headRow = ui.node("tr", "");
    for (const [label, className] of [["#", "roles-rank"], ["Name", ""], ["Roles", "roles-number"], ["Works", "roles-number"], ["Credited as", ""]]) {
      headRow.append(ui.node("th", className, label));
    }
    head.append(headRow);
    const body = ui.node("tbody", "");
    entries.forEach((entry, index) => {
      const row = ui.node("tr", "catalogue-row");
      row.tabIndex = 0;
      // As in the catalogue: the whole row opens the name.
      row.setAttribute("role", "button");
      row.dataset.agent = entry.agent;
      row.setAttribute(
        "aria-label",
        `${entry.name}: ${entry.roles} roles` +
          (entry.works === null ? "" : `, ${entry.works} ${entry.works === 1 ? "work" : "works"}`) +
          ". Activate to open."
      );
      const open = () => ctx.openAgent(entry.agent, entry.name);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      row.append(ui.node("td", "roles-rank", String(index + 1)));
      const nameCell = ui.node("td", "");
      nameCell.append(ui.node("span", "catalogue-title", entry.name));
      row.append(nameCell);
      row.append(ui.node("td", "roles-number", ui.formatNumber(entry.roles)));
      row.append(ui.node("td", "roles-number", entry.works === null ? "—" : ui.formatNumber(entry.works)));
      const cell = ui.node("td", "");
      const tags = ui.node("div", "roles-tags");
      cell.append(tags);
      for (const { role, works } of entry.byRole) {
        const tag = ui.node("span", "role-tag");
        const swatch = ui.node("span", "role-tag-swatch");
        swatch.style.background = ctx.colorFor(role);
        tag.append(swatch, `${roleLabel(role)} ${ui.formatNumber(works)}`);
        tags.append(tag);
      }
      row.append(cell);
      body.append(row);
    });
    table.append(head, body);
    listRoot.append(table);
    paintList();
    statsElement.textContent =
      `The ${ui.formatNumber(entries.length)} names credited in the most distinct roles` +
      " · every role counts, whatever the Roles filter" +
      " · the number after a role is that name's works in it";
  }

  function paintList() {
    if (!listRoot) return;
    const agent = lastSelection && lastSelection.kind === "agent" ? lastSelection.id : null;
    for (const row of listRoot.querySelectorAll("tr[data-agent]")) {
      row.classList.toggle("is-selected", row.dataset.agent === agent);
    }
  }

  function render() {
    svg.attr("role", "img").attr("aria-label", "Sunburst of credit roles and names");
    chordView = null;
    if (!data || !data.children.length) {
      ui.empty(root, "No credited roles for the current filter.");
      statsElement.textContent = "";
      arcs = null;
      syncFilterButton();
      return;
    }
    ui.clear(root);
    const width = Math.max(360, root.clientWidth || 900);
    const height = Math.max(420, root.clientHeight || 640);
    const radius = Math.max(120, Math.min(width, height) / 2 - 16);
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);
    svg.selectAll("*").remove();

    const focus = focusNode();
    focusPath = !focus ? [] : focus.kind === "group" ? [focus.iri] : [focus.group, focus.iri];
    syncFilterButton();

    // Zoomed into one role, its names share the whole ring between them;
    // the rest of the role's works would leave them a sliver.
    const shown = focus && focus.kind === "role" && focus.children.length
      ? {
          ...focus,
          value: 0,
          children: focus.children.map((name) => ({ ...name, value: name.works }))
        }
      : focus;

    const hierarchy = d3
      .hierarchy({ children: shown ? [shown] : data.children })
      .sum((entry) => Math.max(0, entry.value || 0))
      .sort((a, b) => b.value - a.value);

    d3.partition().size([2 * Math.PI, radius])(hierarchy);

    const rootGroup = svg
      .append("g")
      .attr("transform", `translate(${width / 2},${height / 2})`);

    const arc = d3
      .arc()
      .startAngle((entry) => entry.x0)
      .endAngle((entry) => entry.x1)
      .padAngle((entry) => Math.min((entry.x1 - entry.x0) / 2, 0.003))
      .padRadius(radius)
      .innerRadius((entry) => entry.y0)
      .outerRadius((entry) => Math.max(entry.y0, entry.y1 - 1));

    const nodes = hierarchy.descendants().filter((entry) => entry.depth > 0);

    const styles = getComputedStyle(document.documentElement);
    const surface = styles.getPropertyValue("--surface").trim();
    const colourRole = (entry) =>
      entry.data.kind === "group"
        ? entry.data.colour
        : entry.data.kind === "role"
          ? entry.data.iri
          : entry.parent.data.iri;
    const labelFills = new Map();
    function labelFill(entry) {
      const role = colourRole(entry);
      const opacity = OPACITY[entry.data.kind];
      const key = `${role} ${opacity}`;
      if (labelFills.has(key)) return labelFills.get(key);
      const value = String(ctx.colorFor(role) || "");
      const match = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
      const colour = match ? styles.getPropertyValue(match[1]).trim() : value;
      const fill = isLightColour(colour, opacity, surface) ? "#111111" : "#ffffff";
      labelFills.set(key, fill);
      return fill;
    }

    const hint = (entry) =>
      focus && entry.depth === 1 ? "click to step back" : "click to look closer";

    arcs = rootGroup
      .append("g")
      .selectAll("path")
      .data(nodes)
      .join("path")
      .attr("class", "arc")
      .attr("d", arc)
      .attr("fill", (entry) => ctx.colorFor(colourRole(entry)))
      .attr("fill-opacity", (entry) => OPACITY[entry.data.kind])
      .on("mouseenter", (event, entry) => {
        const item = entry.data;
        if (item.kind === "group") {
          ui.showTooltip(
            event,
            item.label,
            `${ui.formatNumber(item.children.length)} ${item.children.length === 1 ? "role" : "roles"} · ` +
              `${ui.formatNumber(item.works)} works summed over its roles · ${hint(entry)}`
          );
        } else if (item.kind === "role") {
          const group = entry.parent.data.kind === "group" ? entry.parent.data.label : null;
          ui.showTooltip(
            event,
            item.label,
            `${ui.formatNumber(item.works)} works` +
              (group && group !== item.label ? ` · ${group}` : "") +
              ` · ${hint(entry)}`
          );
        } else {
          ui.showTooltip(
            event,
            item.name,
            `${ui.formatNumber(item.works)} works in ${entry.parent.data.label}`
          );
        }
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip)
      .on("click", (event, entry) => {
        event.stopPropagation();
        const item = entry.data;
        if (item.kind === "name") ctx.openAgent(item.agent, item.name);
        else if (focus && entry.depth === 1) zoom(focusPath.slice(0, -1));
        else if (item.kind === "group") zoom([item.iri]);
        else zoom([item.group, item.iri]);
      });

    // Each arc's label runs along the arc where it fits whole, else across
    // the ring (cut to its depth) where the arc is wide enough for a line.
    const labels = [];
    for (const entry of nodes) {
      const text = entry.data.kind === "name" ? entry.data.name : entry.data.label;
      const thickness = entry.y1 - entry.y0;
      const middle = (entry.y0 + entry.y1) / 2;
      const span = entry.x1 - entry.x0;
      if (span >= FULL_TURN) {
        labels.push({ entry, text: fitLabel(text, middle * 2), transform: `translate(0,${-middle})`, anchor: "middle" });
        continue;
      }
      const along = span * middle;
      if (entry.data.kind !== "name" && thickness >= 14 && fitLabel(text, along - 10) === text) {
        const [x, y] = arc.centroid(entry);
        labels.push({ entry, text, transform: `translate(${x},${y}) rotate(${labelAngle(entry)})`, anchor: "middle" });
      } else if (along >= 12) {
        const cut = fitLabel(text, thickness - 10);
        if (!cut) continue;
        const angle = ((entry.x0 + entry.x1) / 2) * (180 / Math.PI) - 90;
        const flip = angle > 90;
        labels.push({
          entry,
          text: cut,
          transform: `rotate(${angle}) translate(${flip ? entry.y1 - 6 : entry.y0 + 5},0)${flip ? " rotate(180)" : ""}`,
          anchor: "start"
        });
      }
    }

    rootGroup
      .append("g")
      .selectAll("text")
      .data(labels)
      .join("text")
      .attr("class", (label) => `arc-label arc-label-${label.entry.data.kind}`)
      .attr("dy", "0.35em")
      .attr("text-anchor", (label) => label.anchor)
      .style("fill", (label) => labelFill(label.entry))
      .attr("transform", (label) => label.transform)
      .text((label) => label.text);

    renderCentre(rootGroup, hierarchy.children[0].y0, focus);

    updateStats();
    paint();
  }

  // The disc inside the rings: a count when every group shows, and the way
  // back out (one level) when zoomed.
  function renderCentre(group, outer, focus) {
    const size = Math.max(0, outer - 4);
    if (!focus) {
      const centre = group.append("g").attr("class", "sunburst-centre-static");
      const lines = [
        ["sunburst-centre-title", `${ui.formatNumber(data.roleCount)} roles`, -0.6],
        ["sunburst-centre-count", `${ui.formatNumber(data.children.length)} activity groups`, 0.8]
      ];
      for (const [className, text, offset] of lines) {
        centre.append("text").attr("class", className).attr("text-anchor", "middle")
          .attr("dy", `${offset + 0.35}em`).text(text);
      }
      return;
    }
    const parent = focus.kind === "role"
      ? data.children.find((entry) => entry.iri === focus.group)
      : null;
    const back = parent ? `← ${parent.label}` : "← All groups";
    const step = () => zoom(focusPath.slice(0, -1));
    const centre = group
      .append("g")
      .attr("class", "sunburst-centre")
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-label", `${back.slice(2)}: step back from ${focus.label}`)
      .on("click", (event) => {
        event.stopPropagation();
        step();
      })
      .on("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        step();
      });
    centre.append("circle").attr("r", size);
    const lines = [
      ["sunburst-centre-title", fitLabel(focus.label, size * 1.7), -1.1],
      ["sunburst-centre-count", `${ui.formatNumber(focus.works)} works`, 0.25],
      ["sunburst-centre-back", fitLabel(back, size * 1.7), 1.6]
    ];
    for (const [className, text, offset] of lines) {
      centre.append("text").attr("class", className).attr("text-anchor", "middle")
        .attr("dy", `${offset + 0.35}em`).text(text);
    }
  }

  function updateStats() {
    if (!data) {
      statsElement.textContent = "";
      return;
    }
    const selectionStatus = ctx.selectionStatus?.();
    const tail = selectionStatus?.short ? ` · ${selectionStatus.short}` : "";
    const focus = focusNode();
    if (focus) {
      statsElement.textContent =
        (focus.kind === "group"
          ? `${focus.label} · ${ui.formatNumber(focus.children.length)} roles · ` +
            `${ui.formatNumber(focus.works)} works summed over its roles`
          : `${focus.label} · ${ui.formatNumber(focus.works)} works · ` +
            `its ${ui.formatNumber(focus.children.length)} busiest names`) +
        (focus.kind === "group" ? ` · top ${NAMES_PER_ROLE} names per role` : "") +
        ` among ${ui.formatNumber(data.nameCount)} loaded names` +
        (focus.kind === "role" ? ", sized against each other" : "") +
        " · click the centre to step back" +
        tail;
      return;
    }
    const totalRoles = ctx.state.roles.length;
    const selectedRoles = ctx.state.selectedRoles.size;
    statsElement.textContent =
      `${ui.formatNumber(data.roleCount)} roles in ` +
      `${ui.formatNumber(data.children.length)} activity groups` +
      (selectedRoles < totalRoles
        ? ` (${ui.formatNumber(selectedRoles)} of ${ui.formatNumber(totalRoles)} roles selected)`
        : "") +
      ` · top ${NAMES_PER_ROLE} names per role among ` +
      `${ui.formatNumber(data.nameCount)} loaded names · click a group or role to look closer` +
      tail;
  }

  // Highlight the arcs for a selected name (and, for a work, every credited
  // name) without rebuilding the chart.
  function paint() {
    if (!arcs) return;
    const agents = new Set();
    if (lastSelection) {
      if (lastSelection.kind === "agent") {
        agents.add(lastSelection.id);
      } else if (lastSelection.agentIds) {
        for (const id of lastSelection.agentIds) agents.add(id);
      }
    }
    if (!agents.size) {
      arcs.attr("opacity", 1);
      return;
    }
    arcs.attr("opacity", (entry) => {
      const hit = entry.descendants().some(
        (node) => node.data.kind === "name" && agents.has(node.data.agent)
      );
      return hit ? 1 : 0.15;
    });
  }

  function select(selection) {
    // A work click only carries its credited names once the query resolves, so
    // leave the current highlight in place until then.
    if (
      selection &&
      selection.pending &&
      selection.kind === "work" &&
      selection.agentIds == null
    ) {
      return;
    }
    lastSelection = selection;
    if (mode === "chord") paintChord();
    else if (mode === "list") paintList();
    else {
      paint();
      updateStats();
    }
  }

  function labelAngle(entry) {
    const angle = ((entry.x0 + entry.x1) / 2) * (180 / Math.PI) - 90;
    return angle > 90 && angle < 270 ? angle + 180 : angle;
  }

  return {
    load,
    select,
    kinds: new Set(["agent"]),
    hasNode(id) {
      // The chord counts every credited name, so every name is in it.
      if (mode === "chord") return true;
      if (mode === "list") return Boolean(listed && listed.entries.some((entry) => entry.agent === id));
      return Boolean(data && data.ringAgents.has(id));
    },
    // Why a selected name is not shown, for the drawer's context note.
    outsideNote() {
      return mode === "list"
        ? {
            text: `This name is not among the ${LIST_NAMES} names credited in the most roles.`,
            short: "selected name is not in the most-roles list"
          }
        : null;
    },
    currentQuery() {
      return mode === "chord" ? "role-pairs" : mode === "list" ? "agents-most-roles" : "roles";
    },
    resize() {
      if (data && containerSize() !== drawnSize) draw();
    },
    // Label fills are resolved from the theme's colours at draw time.
    restyle() {
      if (data) draw();
    },
    exportSvg() {
      return { element: svg.node(), name: "fiaf-roles.svg" };
    }
  };
}
