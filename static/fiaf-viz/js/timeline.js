// Works per production year (or decade).

import { limit, runQuery, sparqlIri, sparqlLiteral } from "./sparql.js";
import {
  PER_GROUP, SHARE_MINIMUM, drawStreams, groupedStreamModel, layerLabel, shades, streamModel
} from "./streams.js";
import * as ui from "./ui.js";

const DESCRIPTION =
  "Works by production year. Four-digit years only. Click a bar for titles.";
const STREAM_DESCRIPTION =
  "Works, or their items, per production decade, split into streams. Hover a stream for its decades.";
// What the streams can be split by. Each query returns ?value ?decade ?works;
// the item splits reuse the heatmaps' item-facet-decades.rq and, like those
// heatmaps, count items rather than works (a work often has many items on
// different stock), so they also return ?items.
const FIAF = "https://dev.fiafcore.org/";
const itemSplit = (property, noun, each) => ({
  query: "item-facet-decades",
  params: () => ({ FACET: sparqlIri(`${FIAF}${property}`) }),
  count: "items",
  noun,
  each
});
const SPLITS = {
  genres: { query: "timeline-genres", noun: "genres", each: "genre" },
  forms: { query: "timeline-forms", noun: "forms", each: "form" },
  roles: { query: "timeline-roles", noun: "credited roles", each: "role" },
  countries: { query: "timeline-countries", noun: "production countries", each: "country" },
  languages: { query: "language-usage-decades", noun: "language usage types", each: "usage type" },
  colour: itemSplit("hasColourCharacteristic", "colour types", "colour type"),
  base: itemSplit("hasBase", "base materials", "base material"),
  element: itemSplit("isElement", "element types", "element type"),
  // Formats are classes in the ontology (fiaf:35mmFilm is a fiaf:FilmFormat),
  // so their streams are grouped by format class and share its hue.
  format: { ...itemSplit("hasFormat", "item formats", "format"), groupQuery: "format-classes" }
};
const ARIA_LABEL = "Works per production year";

export function normaliseTimelineRows(rows) {
  return rows
    .map((row) => ({
      year: Number(row.year),
      works: Number(row.works) || 0
    }))
    .filter((row) => Number.isFinite(row.year) && row.works > 0)
    .sort((a, b) => a.year - b.year);
}

export function create(ctx, root, statsElement, granularityButtons, descriptionElement) {
  let data = null;
  let granularity = "year";
  let drawerToken = 0;
  let drawerController = null;
  let hasRendered = false;
  const svg = d3
    .select(root)
    .append("svg")
    .attr("role", "img")
    .attr("aria-label", ARIA_LABEL);

  // Streams: a split of the decade counts, loaded on demand and cached per
  // dataset selection and split.
  let split = "genres";
  let share = false;
  let streamToken = 0;
  const streamCache = new Map();
  const streamControls = document.querySelectorAll("[data-stream-control]");
  const splitSelect = document.getElementById("timeline-split");
  const shareButtons = document.querySelectorAll("#timeline-stream-mode [data-stream-mode]");
  const legendElement = document.getElementById("timeline-legend");

  function syncStreamControls() {
    const streams = granularity === "streams";
    for (const element of streamControls) element.hidden = !streams;
    if (legendElement) legendElement.hidden = !streams;
    for (const button of shareButtons) {
      const active = (button.dataset.streamMode === "share") === share;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (descriptionElement) {
      descriptionElement.textContent = streams ? STREAM_DESCRIPTION : DESCRIPTION;
    }
  }

  const streamKey = () => `${ctx.scopeFilter()}|${split}`;

  async function loadStreams() {
    const key = streamKey();
    if (streamCache.has(key)) {
      draw();
      return;
    }
    const token = ++streamToken;
    const spec = SPLITS[split];
    const unit = spec.count === "items" ? "items" : "works";
    ui.setStatus(`Counting ${unit} per decade by ${spec.each}…`);
    try {
      const [rows, groupRows] = await Promise.all([
        runQuery(spec.query, {
          ...(spec.params ? spec.params() : {}),
          SCOPE_FILTER: ctx.scopeFilter()
        }),
        spec.groupQuery ? runQuery(spec.groupQuery, {}) : Promise.resolve(null)
      ]);
      // The stream model reads ?works; item splits stream their item counts.
      streamCache.set(key, {
        rows: spec.count === "items" ? rows.map((row) => ({ ...row, works: row.items })) : rows,
        groups: groupRows ? new Map(groupRows.map((row) => [row.format, row.class])) : null
      });
      if (token !== streamToken || granularity !== "streams") return;
      draw();
      ui.setStatus("");
    } catch (error) {
      if (token !== streamToken || error.name === "AbortError") return;
      ui.error(root, error, "Choose another split or reload the page.");
      ui.setStatus("The timeline split query failed.", "error");
    }
  }

  for (const button of granularityButtons || []) {
    button.addEventListener("click", () => {
      granularity = button.dataset.granularity || "year";
      for (const other of granularityButtons) {
        other.classList.toggle("active", other === button);
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
      }
      ui.hideTooltip();
      syncStreamControls();
      if (granularity === "streams") loadStreams();
      else draw();
    });
  }

  if (splitSelect) {
    splitSelect.value = split;
    splitSelect.addEventListener("change", () => {
      split = SPLITS[splitSelect.value] ? splitSelect.value : "genres";
      ui.hideTooltip();
      loadStreams();
    });
  }

  for (const button of shareButtons) {
    button.addEventListener("click", () => {
      const next = button.dataset.streamMode === "share";
      if (next === share) return;
      share = next;
      syncStreamControls();
      draw();
    });
  }
  syncStreamControls();

  document.addEventListener("fiaf-viz:drawer-close", () => {
    drawerToken += 1;
    if (drawerController) drawerController.abort();
    drawerController = null;
  });

  async function load({ signal } = {}) {
    if (!hasRendered) {
      ui.message(root, "Loading production dates…");
    }
    ui.setStatus("Counting works per year…");
    const [rows, decadeRows, totalRows] = await Promise.all([
      runQuery("timeline", { SCOPE_FILTER: ctx.scopeFilter() }, { signal }),
      runQuery("timeline-decades", { SCOPE_FILTER: ctx.scopeFilter() }, { signal }),
      runQuery("works-total", { SCOPE_FILTER: ctx.scopeFilter() }, { signal })
    ]);
    if (signal && signal.aborted) return;
    if (granularity === "streams" && !streamCache.has(streamKey())) {
      // A dataset change while streams are shown: load the split as well.
      loadStreams();
    }
    data = {
      rows: normaliseTimelineRows(rows),
      decades: normaliseTimelineRows(decadeRows),
      dated: totalRows.length ? Number(totalRows[0].datedWorks) || 0 : 0,
      total: totalRows.length ? Number(totalRows[0].works) : 0
    };
    syncStreamControls();
    draw();
    hasRendered = true;
    ui.setStatus("");
  }

  // Remember the container size of the last draw so a tab revisit or a drawer
  // toggle that leaves it unchanged does not rebuild the chart.
  let drawnSize = "";
  const containerSize = () => `${root.clientWidth}x${root.clientHeight}`;

  function draw() {
    paint();
    drawnSize = containerSize();
  }

  function paintStreams() {
    const entry = streamCache.get(streamKey());
    if (!entry) return;
    const spec = SPLITS[split];
    const items = spec.count === "items";
    const unit = items ? "items" : "works";
    const groupOf = entry.groups ? (value) => entry.groups.get(value) || null : null;
    const model = groupOf
      ? groupedStreamModel(entry.rows, groupOf)
      : streamModel(entry.rows);
    if (!model.records.length) {
      ui.empty(root, `No ${items ? "items of dated works" : "dated works"} carry a ${spec.each}.`);
      statsElement.textContent = "";
      if (legendElement) legendElement.replaceChildren();
      return;
    }
    ui.clear(root);
    const width = Math.max(360, root.clientWidth || 1000);
    const height = Math.max(320, root.clientHeight || 420);
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    svg.attr("aria-label", `${items ? "Items" : "Works"} per decade by ${spec.each}`);

    // Resolve the palette now so a downloaded SVG keeps its colours.
    const styles = getComputedStyle(document.documentElement);
    const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    const palette = d3.range(1, 9).map((index) => token(`--role-${index}`, "#888888"));
    const other = token("--role-other", "#b8b8b8");
    let colours;
    if (model.grouped) {
      // One hue per class, its formats in shades from dark to light.
      colours = new Map();
      model.groups.forEach((group, index) => {
        const members = model.layers.filter((layer) => model.groupOfLayer.get(layer) === group);
        const base = group ? palette[index % palette.length] : other;
        shades(base, members.length).forEach((shade, position) => {
          colours.set(members[position], String(shade));
        });
      });
    } else {
      colours = new Map(
        model.layers.map((layer, index) => [
          layer,
          model.other && index === model.layers.length - 1 ? other : palette[index % palette.length]
        ])
      );
    }
    const drawn = drawStreams(svg, {
      width,
      height,
      model,
      share,
      colour: (layer) => colours.get(layer),
      stroke: token("--surface", "#ffffff"),
      noun: unit
    });

    if (legendElement) {
      const swatchItem = (layer) => {
        const item = ui.node("span", "legend-item");
        const swatch = ui.node("span", "legend-swatch");
        swatch.style.background = colours.get(layer);
        item.append(swatch, ui.node("span", "", layerLabel(layer)));
        return item;
      };
      if (model.grouped) {
        // One legend line per class, headed by the class name.
        legendElement.replaceChildren(
          ...model.groups.map((group) => {
            const line = ui.node("span", "legend-group");
            line.append(
              ui.node("span", "legend-group-title", group ? layerLabel(group) : "Unclassified"),
              ...model.layers
                .filter((layer) => model.groupOfLayer.get(layer) === group)
                .map(swatchItem)
            );
            return line;
          })
        );
      } else {
        legendElement.replaceChildren(...model.layers.map(swatchItem));
      }
    }
    const shown = model.other ? model.layers.length - 1 : model.layers.length;
    statsElement.textContent =
      `${ui.formatNumber(model.valueCount)} ${spec.noun}` +
      (model.grouped
        ? ` in ${ui.formatNumber(model.groups.length)} format classes, shaded by class` +
          (model.layers.some((layer) => layerLabel(layer).startsWith("Other"))
            ? ` · beyond ${PER_GROUP} formats a class's smallest are combined`
            : "")
        : "") +
      (model.other ? ` · the ${shown} largest have their own stream, the rest are under Other` : "") +
      (items
        ? ` · items of works by production decade; an item with several counts under each ${spec.each}`
        : ` · a work with several counts under each ${spec.each}`) +
      (share ? shareNote(model, drawn.records, unit) : "");
  }

  function shareNote(model, records, unit = "works") {
    const first = records[0].decade;
    const last = records[records.length - 1].decade;
    const trimmed = first !== model.decades[0] || last !== model.decades[model.decades.length - 1];
    return (
      " · share of each decade" +
      (trimmed
        ? `, ${first}s–${last}s, where each decade has at least ${SHARE_MINIMUM} ${unit}`
        : "")
    );
  }

  function paint() {
    if (!data) return;
    if (granularity === "streams") {
      paintStreams();
      return;
    }
    svg.attr("aria-label", ARIA_LABEL);
    const rows = granularity === "decade" ? data.decades : data.rows;
    if (!rows.length) {
      ui.empty(root, "No dated works found.");
      statsElement.textContent = "";
      return;
    }
    ui.clear(root);

    const width = Math.max(360, root.clientWidth || 1000);
    const height = Math.max(320, root.clientHeight || 420);
    const margin = { top: 16, right: 20, bottom: 38, left: 58 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);
    svg.selectAll("*").remove();

    const step = granularity === "decade" ? 10 : 1;
    const domain = d3.range(
      rows[0].year,
      rows[rows.length - 1].year + step,
      step
    );
    const x = d3.scaleBand().domain(domain).range([0, innerWidth]).paddingInner(0.18);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(rows, (row) => row.works) || 1])
      .nice()
      .range([innerHeight, 0]);

    const chart = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    chart
      .append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(y).ticks(6).tickSize(-innerWidth).tickFormat(""));

    const tickValues =
      innerWidth < 520
        ? d3.ticks(
            rows[0].year,
            rows[rows.length - 1].year,
            Math.max(3, Math.floor(innerWidth / 65))
          )
        : granularity === "year"
          ? domain.filter((year) => year % 10 === 0)
          : domain;

    chart
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(tickValues)
          .tickFormat((year) => (granularity === "decade" ? `${year}s` : String(year)))
      );

    chart.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat(ui.formatNumber));

    chart
      .append("g")
      .selectAll("rect")
      .data(rows, (row) => row.year)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (row) => x(row.year))
      .attr("y", (row) => y(row.works))
      .attr("width", Math.max(1, x.bandwidth()))
      .attr("height", (row) => innerHeight - y(row.works))
      .attr("fill", "var(--accent)")
      .attr("fill-opacity", 0.8)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (row) => {
        const period = granularity === "decade" ? `${row.year}s` : String(row.year);
        return `${period}: ${ui.formatNumber(row.works)} works. Activate to list works.`;
      })
      .on("mouseenter", (event, row) => {
        const period = granularity === "decade" ? `${row.year}s` : String(row.year);
        ui.showTooltip(
          event,
          period,
          `${ui.formatNumber(row.works)} works · activate for titles`
        );
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip)
      .on("click", (event, row) => {
        openPeriod(row);
      })
      .on("keydown", (event, row) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPeriod(row);
        }
      });

    const dated = data.dated;
    const total = data.total;
    const percent = total ? (100 * dated) / total : 0;
    const scopeSuffix = ctx.scopeFilter() ? " in this dataset" : " in total";
    statsElement.textContent =
      `${ui.formatNumber(dated)} works dated · ${ui.formatNumber(total)} works${scopeSuffix}` +
      ` (${percent.toFixed(1)}% dated)`;
  }

  async function openPeriod(row) {
    const token = ++drawerToken;
    if (drawerController) drawerController.abort();
    const controller = new AbortController();
    drawerController = controller;
    const workLimit = limit("heatmapWorkRows", 200);
    const mode = granularity;
    const period = mode === "decade" ? `${row.year}s` : String(row.year);
    const year = String(row.year).padStart(4, "0");
    const prefix = mode === "decade" ? year.slice(0, 3) : year;
    const subtitle =
      `${ui.formatNumber(row.works)} ${row.works === 1 ? "work" : "works"} ` +
      (mode === "decade" ? "dated in this decade." : "dated in this year.");
    ui.openDrawer(period, subtitle);
    ui.drawerMessage("Loading works…");
    try {
      const rows = await runQuery(
        "timeline-period-works",
        {
          YEAR_PREFIX: sparqlLiteral(prefix),
          SCOPE_FILTER: ctx.scopeFilter(),
          LIMIT: workLimit
        },
        { signal: controller.signal }
      );
      if (token !== drawerToken) return;
      const limited = workLimit === 0 || rows.length >= workLimit;
      ui.openDrawer(
        period,
        subtitle +
          (limited
            ? ` Row limit reached; showing at most ${ui.formatNumber(workLimit)} works.`
            : "")
      );
      if (!rows.length) {
        ui.drawerMessage("No works returned for this period.");
        return;
      }
      ui.drawerList(rows, {
        title: (entry) => entry.title || entry.work,
        meta: (entry) => entry.work,
        onSelect: (entry) => ctx.openWork(entry.work, entry.title || entry.work)
      });
    } catch (error) {
      if (token !== drawerToken || error.name === "AbortError") return;
      ui.drawerMessage(error.message, "error");
    } finally {
      if (token === drawerToken) drawerController = null;
    }
  }

  return {
    load,
    invalidate() {
      data = null;
      streamCache.clear();
    },
    // The streams resolve their palette from the theme when drawn.
    restyle() {
      if (granularity === "streams" && data) draw();
    },
    resize() {
      if (data && containerSize() !== drawnSize) draw();
    },
    exportSvg() {
      return { element: svg.node(), name: "fiaf-timeline.svg" };
    }
  };
}
