// Dataset-wide breakdowns. Under Works: production country, spoken language,
// genre and form (distinct works). Under Holdings: format, element, base,
// colour, sound, stock and institution (distinct items), plus the flow.

import { limit, runQuery } from "./sparql.js";
import { humanize } from "./labels.js";
import * as ui from "./ui.js";
import * as materialFlow from "./material-flow.js";

const SPECS = [
  { key: "format", query: "breakdown-format", title: "Item format", unit: "items", colour: "var(--role-1)" },
  { key: "element", query: "breakdown-element", title: "Element type", unit: "items", colour: "var(--role-2)" },
  { key: "base", query: "breakdown-base", title: "Base material", unit: "items", colour: "var(--role-3)" },
  { key: "colour", query: "breakdown-colour", title: "Colour", unit: "items", colour: "var(--role-4)" },
  { key: "sound", query: "breakdown-sound-standard", title: "Sound", unit: "items", colour: "var(--role-5)" },
  { key: "stock", query: "breakdown-stock", title: "Film stock", unit: "items", colour: "var(--role-6)" },
  { key: "country", query: "breakdown-country", title: "Production country", unit: "works", colour: "var(--role-1)" },
  { key: "language", query: "breakdown-language", title: "Spoken language", unit: "works", colour: "var(--role-2)" },
  { key: "genre", query: "breakdown-genre", title: "Genre", unit: "works", colour: "var(--role-7)" },
  { key: "form", query: "breakdown-form", title: "Form", unit: "works", colour: "var(--role-8)" },
  { key: "institution", query: "breakdown-institution", title: "Holding institution", unit: "items", colour: "var(--role-1)" }
];

// The panels for one unit ("works" or "items"); null shows every panel.
export function specsFor(unit) {
  return unit ? SPECS.filter((spec) => spec.unit === unit) : SPECS;
}

export function create(ctx, root) {
  // Loaded panels per unit, so moving between Works and Holdings is instant.
  const panelsByUnit = new Map();
  let unit = null;
  let panels = null;
  let hasRendered = false;
  let renderedUnit;
  // "bars" (the panels) or "flow" (parallel sets across the item facets).
  // The flow follows items, so works always show the bars.
  let chosenLayout = "bars";
  let layout = "bars";
  const layoutButtons = [...document.querySelectorAll("[data-breakdown-layout]")];
  const flowSection = document.getElementById("breakdown-flow");
  const exportButton = document.querySelector('[data-export="breakdowns"]');
  const queryButton = document.querySelector('[data-query="breakdowns"]');
  const flow = flowSection
    ? materialFlow.create(
        ctx,
        document.getElementById("breakdown-flow-chart"),
        document.getElementById("breakdown-flow-controls"),
        document.getElementById("breakdown-flow-stats")
      )
    : null;

  function syncLayout() {
    for (const button of layoutButtons) {
      const active = button.dataset.breakdownLayout === layout;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    root.hidden = layout !== "bars";
    if (flowSection) flowSection.hidden = layout !== "flow";
    if (exportButton) exportButton.hidden = layout !== "flow";
    // The bars carry a query link per panel instead.
    if (queryButton) queryButton.hidden = layout !== "flow";
  }

  for (const button of layoutButtons) {
    button.addEventListener("click", () => {
      if (button.dataset.breakdownLayout === layout) return;
      chosenLayout = button.dataset.breakdownLayout;
      layout = unit === "works" ? "bars" : chosenLayout;
      syncLayout();
      load().catch((error) => {
        if (error.name !== "AbortError") ui.setStatus(error.message, "error");
      });
    });
  }
  syncLayout();

  async function load({ signal } = {}) {
    if (layout === "flow" && flow) {
      await flow.load({ signal });
      return;
    }
    const cached = panelsByUnit.get(unit || "all");
    if (cached) {
      if (cached !== panels || root.clientWidth !== renderedWidth) {
        panels = cached;
        render();
        renderedUnit = unit;
      }
      return;
    }
    if (!hasRendered || renderedUnit !== unit) {
      ui.message(root, "Loading distributions…");
    }
    ui.setStatus("Loading breakdowns…");
    const results = await Promise.all(
      specsFor(unit).map(async (spec) => {
        try {
          const rows = await runQuery(
            spec.query,
            {
              SCOPE_FILTER: ctx.scopeFilter(),
              LIMIT: limit("breakdownRows", 20)
            },
            { signal }
          );
          return {
            spec,
            rows: rows
              .map((row) => ({ value: row.value, count: Number(row.n) || 0 }))
              .filter((row) => row.value)
          };
        } catch (error) {
          return { spec, rows: [], error };
        }
      })
    );
    if (signal && signal.aborted) return;
    panelsByUnit.set(unit || "all", results);
    panels = results;
    render();
    renderedUnit = unit;
    hasRendered = true;
    ui.setStatus("");
  }

  // Panel widths follow the container width, so remember it: a tab revisit or
  // a drawer toggle that leaves it unchanged does not rebuild nine charts.
  let renderedWidth = -1;

  function render() {
    if (!panels) return;
    renderedWidth = root.clientWidth;
    root.replaceChildren();
    for (const panel of panels) {
      const card = ui.node("section", "breakdown-panel");
      card.append(ui.node("h3", "", panel.spec.title));
      const note = ui.node(
        "p",
        "panel-note",
        panel.error ? "query failed" : `${panel.spec.unit} · top ${panel.rows.length} · `
      );
      if (!panel.error && ctx.openNamedQuery) {
        const link = ui.node("button", "panel-query", "See the query");
        link.type = "button";
        // Seven panels share the visible text; the name says which one.
        link.setAttribute("aria-label", `See the query for ${panel.spec.title}`);
        link.addEventListener("click", () => ctx.openNamedQuery(panel.spec.query, panel.spec.title));
        note.append(link);
      }
      card.append(note);
      const chart = ui.node("div", "breakdown-chart");
      card.append(chart);
      root.append(card);
      if (panel.error) {
        ui.error(chart, panel.error, "The rest of the page is unaffected.");
      } else if (!panel.rows.length) {
        ui.empty(chart, "No data.");
      } else {
        drawPanel(chart, panel);
      }
    }
  }

  function drawPanel(container, panel) {
    const width = Math.max(280, container.clientWidth || 320);
    const rowHeight = 20;
    const margin = { top: 4, right: 46, bottom: 4, left: Math.min(150, Math.max(96, width * 0.38)) };
    const innerWidth = Math.max(40, width - margin.left - margin.right);
    const height = panel.rows.length * rowHeight + margin.top + margin.bottom;
    const rows = panel.rows.slice().sort((a, b) => b.count - a.count);
    const max = d3.max(rows, (row) => row.count) || 1;
    const shownTotal = d3.sum(rows, (row) => row.count) || 1;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("aria-label", `${panel.spec.title} distribution`);

    const chart = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([0, max]).range([0, innerWidth]);

    const bar = chart
      .append("g")
      .selectAll("g")
      .data(rows, (row) => row.value)
      .join("g")
      .attr("transform", (row, index) => `translate(0,${index * rowHeight})`);

    bar
      .append("rect")
      .attr("class", "bar")
      .attr("x", 0)
      .attr("y", 3)
      .attr("width", (row) => Math.max(1, x(row.count)))
      .attr("height", rowHeight - 6)
      .attr("fill", panel.spec.colour)
      .attr("fill-opacity", 0.85)
      .on("mouseenter", (event, row) => {
        const share = ((100 * row.count) / shownTotal).toFixed(1);
        ui.showTooltip(
          event,
          humanize(row.value),
          `${ui.formatNumber(row.count)} ${panel.spec.unit} (${share}% of panel)`
        );
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip);

    bar
      .append("text")
      .attr("class", "bar-label")
      .attr("x", -6)
      .attr("y", rowHeight / 2 + 3)
      .attr("text-anchor", "end")
      .text((row) => ui.truncate(humanize(row.value), 24));

    bar
      .append("text")
      .attr("class", "bar-value")
      .attr("x", (row) => Math.max(1, x(row.count)) + 4)
      .attr("y", rowHeight / 2 + 3)
      .text((row) => ui.formatNumber(row.count));
  }


  return {
    load,
    currentQuery: () => (layout === "flow" ? "material-flow" : null),
    invalidate() {
      panelsByUnit.clear();
      panels = null;
    },
    // Show the panels for "works" or "items". True when that changes what is
    // shown, so the caller reloads.
    setUnit(next) {
      const value = next || null;
      if (value === unit) return false;
      unit = value;
      layout = unit === "works" ? "bars" : chosenLayout;
      syncLayout();
      return true;
    },
    resize() {
      if (layout === "flow" && flow) flow.resize();
      else if (panels && root.clientWidth !== renderedWidth) render();
    },
    restyle() {
      if (layout === "flow" && flow) flow.redraw();
    },
    exportSvg() {
      return layout === "flow" && flow ? flow.exportSvg() : null;
    }
  };
}
