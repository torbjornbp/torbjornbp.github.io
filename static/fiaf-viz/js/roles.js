// People › Roles, in three modes:
//
// - Sunburst: roles by works, outer ring = busiest loaded names per role.
//   The outer ring is built from the shared agent page (agents.rq) instead of
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
  sunburst: "Roles sized by works; outer ring shows the busiest names per role. Click a role to filter the cloud.",
  chord: "Roles held by the same name. A ribbon is as wide as the names credited in both roles; hover for counts.",
  list: "The names credited in the most different roles. Click a name to open it."
};

function isLightColour(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ""));
  if (!match) return false;
  const number = parseInt(match[1], 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.45;
}

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
    const [roles, agentData] = await Promise.all([
      ctx.filteredRoles(),
      ctx.agentData()
    ]);
    if (signal && signal.aborted) return;
    data = build(roles, agentData);
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

  function build(roles, agentData) {
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
    const children = roles
      .filter((role) => Number(role.works) > 0)
      .map((role) => {
        const total = Number(role.works) || 0;
        const top = (byRole.get(role.iri) || [])
          .sort((a, b) => b.works - a.works)
          .slice(0, NAMES_PER_ROLE);
        const topSum = d3.sum(top, (entry) => entry.works);
        const scale = topSum > total && topSum > 0 ? total / topSum : 1;
        const names = top.map((entry) => ({
          name: entry.name,
          agent: entry.agent,
          works: entry.works,
          value: entry.works * scale
        }));
        return {
          iri: role.iri,
          label: roleLabel(role.iri),
          works: total,
          value: Math.max(0, total - d3.sum(names, (entry) => entry.value)),
          children: names
        };
      });
    const ringAgents = new Set();
    for (const child of children) {
      for (const name of child.children) ringAgents.add(name.agent);
    }
    return { children, nameCount: agentData.rows.length, ringAgents };
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
      return;
    }
    ui.clear(root);
    const width = Math.max(360, root.clientWidth || 900);
    const height = Math.max(420, root.clientHeight || 640);
    const radius = Math.max(120, Math.min(width, height) / 2 - 16);
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);
    svg.selectAll("*").remove();

    const hierarchy = d3
      .hierarchy({ children: data.children })
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
    const labelFills = new Map();
    function labelFill(role) {
      if (labelFills.has(role)) return labelFills.get(role);
      const value = String(ctx.colorFor(role) || "");
      const match = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
      const colour = match ? styles.getPropertyValue(match[1]).trim() : value;
      const fill = isLightColour(colour) ? "#111111" : "#ffffff";
      labelFills.set(role, fill);
      return fill;
    }

    arcs = rootGroup
      .append("g")
      .selectAll("path")
      .data(nodes)
      .join("path")
      .attr("class", "arc")
      .attr("d", arc)
      .attr("fill", (entry) => {
        const role = entry.depth === 1 ? entry.data.iri : entry.parent.data.iri;
        return ctx.colorFor(role);
      })
      .attr("fill-opacity", (entry) => (entry.depth === 1 ? 0.9 : 0.62))
      .on("mouseenter", (event, entry) => {
        if (entry.depth === 1) {
          ui.showTooltip(
            event,
            entry.data.label,
            `${ui.formatNumber(entry.data.works)} works`
          );
        } else {
          ui.showTooltip(
            event,
            entry.data.name,
            `${ui.formatNumber(entry.data.works)} works in ${entry.parent.data.label}`
          );
        }
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip)
      .on("click", (event, entry) => {
        event.stopPropagation();
        if (entry.depth === 1) {
          ctx.onlyRole(entry.data.iri);
        } else {
          ctx.openAgent(entry.data.agent, entry.data.name);
        }
      });

    rootGroup
      .append("g")
      .selectAll("text")
      .data(nodes.filter((entry) => entry.depth === 1))
      .join("text")
      .attr("class", "arc-label")
      .attr("text-anchor", "middle")
      .style("fill", (entry) => labelFill(entry.data.iri))
      .attr("transform", (entry) => {
        const [x, y] = arc.centroid(entry);
        return `translate(${x},${y}) rotate(${labelAngle(entry)})`;
      })
      .attr("display", (entry) => (entry.x1 - entry.x0 > 0.16 ? null : "none"))
      .text((entry) => entry.data.label);

    updateStats();
    paint();
  }

  function updateStats() {
    if (!data) {
      statsElement.textContent = "";
      return;
    }
    const roleCount = data.children.length;
    const totalRoles = ctx.state.roles.length;
    const selectedRoles = ctx.state.selectedRoles.size;
    const selectionStatus = ctx.selectionStatus?.();
    statsElement.textContent =
      `${ui.formatNumber(roleCount)} roles` +
      (selectedRoles < totalRoles
        ? ` (${ui.formatNumber(selectedRoles)} of ${ui.formatNumber(totalRoles)} selected)`
        : "") +
      ` · top ${NAMES_PER_ROLE} names per role among ` +
      `${ui.formatNumber(data.nameCount)} loaded names · click a role to filter the cloud` +
      (selectionStatus?.short ? ` · ${selectionStatus.short}` : "");
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
      if (entry.depth === 2) return agents.has(entry.data.agent) ? 1 : 0.15;
      const hit = (entry.children || []).some((child) =>
        agents.has(child.data.agent)
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
