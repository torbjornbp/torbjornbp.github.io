// Dataset-wide item breakdowns: format, element, base, colour, sound and stock.

import { limit, runQuery } from "./sparql.js";
import { humanize } from "./labels.js";
import * as ui from "./ui.js";

const SPECS = [
  { key: "format", query: "breakdown-format", title: "Item format", unit: "items", colour: "var(--role-1)" },
  { key: "element", query: "breakdown-element", title: "Element type", unit: "items", colour: "var(--role-2)" },
  { key: "base", query: "breakdown-base", title: "Base material", unit: "items", colour: "var(--role-3)" },
  { key: "colour", query: "breakdown-colour", title: "Colour", unit: "items", colour: "var(--role-4)" },
  { key: "sound", query: "breakdown-sound-standard", title: "Sound", unit: "items", colour: "var(--role-5)" },
  { key: "stock", query: "breakdown-stock", title: "Film stock", unit: "items", colour: "var(--role-6)" },
  { key: "genre", query: "breakdown-genre", title: "Genre", unit: "works", colour: "var(--role-7)" },
  { key: "form", query: "breakdown-form", title: "Form", unit: "works", colour: "var(--role-8)" },
  { key: "institution", query: "breakdown-institution", title: "Holding institution", unit: "items", colour: "var(--role-1)" }
];

export function create(ctx, root) {
  let panels = null;
  let hasRendered = false;

  async function load({ signal } = {}) {
    if (!hasRendered) {
      ui.message(root, "Loading distributions…");
    }
    ui.setStatus("Loading breakdowns…");
    const results = await Promise.all(
      SPECS.map(async (spec) => {
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
    panels = results;
    render();
    hasRendered = true;
    ui.setStatus("");
  }

  function render() {
    if (!panels) return;
    root.replaceChildren();
    for (const panel of panels) {
      const card = ui.node("section", "breakdown-panel");
      card.append(ui.node("h3", "", panel.spec.title));
      card.append(
        ui.node(
          "p",
          "panel-note",
          panel.error ? "query failed" : `${panel.spec.unit} · top ${panel.rows.length}`
        )
      );
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
      .attr("rx", 2)
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
      .text((row) => truncate(humanize(row.value), 24));

    bar
      .append("text")
      .attr("class", "bar-value")
      .attr("x", (row) => Math.max(1, x(row.count)) + 4)
      .attr("y", rowHeight / 2 + 3)
      .text((row) => ui.formatNumber(row.count));
  }

  function truncate(text, length) {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  return {
    load,
    invalidate() {
      panels = null;
    },
    resize() {
      if (panels) render();
    },
    exportSvg() {
      return null;
    }
  };
}
