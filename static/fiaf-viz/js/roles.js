// Role sunburst: roles by works, outer ring = busiest loaded names per role.
//
// The outer ring is built from the shared agent page (agents.rq) instead of a
// separate role/agent query. A single global LIMIT on that query could not give
// every role its busiest names (popular roles consumed the whole budget), and
// the agent page is already loaded and cached for the name-based views.

import { roleLabel } from "./labels.js";
import * as ui from "./ui.js";

const NAMES_PER_ROLE = 8;

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
  const svg = d3
    .select(root)
    .append("svg")
    .attr("role", "img")
    .attr("aria-label", "Sunburst of credit roles and names");

  svg.on("click", () => ui.closeDrawer());

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
    draw();
    hasRendered = true;
    ui.setStatus("");
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
    render();
    drawnSize = containerSize();
  }

  function render() {
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
    paint();
    updateStats();
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
      return Boolean(data && data.ringAgents.has(id));
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
