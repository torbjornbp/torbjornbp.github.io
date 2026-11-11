// Preservation copies: works with an item marked fiaf:hasStatus
// fiaf:Preservation, by production decade or country.
//
// FIAFcore records preservation at item level. There is no separate
// preservation-manifestation class, so a work with a preservation manifestation
// is represented here by its preservation-status items.

import { limit, runQuery, sparqlIri, sparqlLiteral } from "./sparql.js";
import { humanize } from "./labels.js";
import * as ui from "./ui.js";

const CATEGORIES = [
  { key: "preservation", label: "Preservation copies recorded", colour: "var(--accent)" },
  { key: "items", label: "Items recorded, no preservation status recorded", colour: "var(--role-other)" },
  { key: "none", label: "No items recorded", colour: "var(--border-strong)" }
];

// Work-level existence, independent of the item carrying preservation status.
// As in the base-material breakdown, accept direct terms and typed blank nodes.
export function withinFilter(within) {
  if (within !== "nitrate") return "";
  return `FILTER EXISTS {
    ?work fiaf:hasManifestation ?nitrateManifestation .
    ?nitrateManifestation fiaf:hasItem ?nitrateItem .
    { ?nitrateItem fiaf:hasBase ?nitrateBase }
    UNION
    { ?nitrateManifestation fiaf:hasBase ?nitrateBase }
    FILTER(?nitrateBase = fiaf:NitrateBase || EXISTS {
      ?nitrateBase a fiaf:NitrateBase . FILTER(isBlank(?nitrateBase))
    })
  }`;
}

export function statusFilter(category) {
  const preservation = `?work fiaf:hasManifestation/fiaf:hasItem ?statusItem .
    ?statusItem fiaf:hasStatus fiaf:Preservation .`;
  const items = "?work fiaf:hasManifestation/fiaf:hasItem ?recordedItem .";
  if (category === "none") return `FILTER NOT EXISTS { ${items} }`;
  if (category === "items") {
    return `FILTER EXISTS { ${items} } FILTER NOT EXISTS { ${preservation} }`;
  }
  return `FILTER EXISTS { ${preservation} }`;
}

function composition(metrics) {
  const total = metrics.works || 0;
  const preservation = metrics.preservation || 0;
  return CATEGORIES.map((category) => ({
    ...category,
    count: category.key === "preservation" ? preservation :
      category.key === "items" ? Math.max(0, (metrics.items || 0) - preservation) :
        Math.max(0, total - (metrics.items || 0))
  }));
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0%";
  if (number < 0.1) return "<0.1%";
  return `${number.toFixed(1)}%`;
}

function truncate(text, length) {
  const value = String(text || "");
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export function create(ctx, root, statsElement, overviewElement, controls = {}) {
  const { groupButtons, measureSelect, sortSelect, limitSelect, withinSelect, withinNote } = controls;

  let group = "decade";
  let measure = "count";
  let sort = "total";
  let within = "all";
  let overview = null;
  let overviewKey = "";
  let data = null;
  let hasRendered = false;
  let rowLimit = Math.max(1, Math.floor(limit("preservationRows", 25)) || 25);
  let requestToken = 0;
  let requestController = null;
  let drawerToken = 0;
  let drawerController = null;
  let fallbackNote = false;
  let lastRows = [];
  const facetCache = new Map();

  if (withinSelect) {
    withinSelect.value = within;
    withinSelect.addEventListener("change", () => {
      within = withinSelect.value === "nitrate" ? "nitrate" : "all";
      ui.closeDrawer();
      view.invalidate();
      setGroupChrome();
      load().catch((error) => {
        if (error.name === "AbortError") return;
        ui.error(root, error, "Choose another selection or reload the page.");
        ui.setStatus("The preservation query failed.", "error");
      });
    });
  }

  if (sortSelect) {
    sortSelect.value = sort;
    sortSelect.addEventListener("change", () => {
      sort = ["name", "coverage"].includes(sortSelect.value) ? sortSelect.value : "total";
      draw();
    });
  }
  if (limitSelect) {
    // Preserve a configured default even when it is not one of the standard sizes.
    if (![25, 50].includes(rowLimit)) {
      const option = ui.node("option", "", String(rowLimit));
      option.value = String(rowLimit);
      limitSelect.append(option);
    }
    limitSelect.value = String(rowLimit);
    limitSelect.addEventListener("change", () => {
      const value = Number(limitSelect.value);
      rowLimit = limitSelect.value === "all" ? null :
        Number.isInteger(value) && value > 0 ? value : 25;
      draw();
    });
  }

  const svg = d3
    .select(root)
    .append("svg")
    .attr("role", "img")
    .attr("aria-label", "Works with preservation copies recorded by production decade");

  if (measureSelect) {
    measureSelect.value = measure;
    measureSelect.addEventListener("change", () => {
      measure = ["count", "all"].includes(measureSelect.value)
        ? measureSelect.value
        : "count";
      draw();
    });
  }

  for (const button of groupButtons || []) {
    button.addEventListener("click", () => {
      const next =
        button.dataset.preservationGroup === "country" ? "country" : "decade";
      if (next === group) return;
      group = next;
      fallbackNote = false;
      setGroupChrome();
      ui.closeDrawer();
      loadGroup().catch((error) => {
        if (error.name === "AbortError") return;
        ui.error(root, error, "Choose another grouping or reload the page.");
        ui.setStatus("The preservation query failed.", "error");
      });
    });
  }

  function setGroupChrome() {
    if (withinNote) {
      withinNote.textContent = within === "nitrate"
        ? "Within works with nitrate base recorded on an item or its manifestation. " +
          "Preservation status may belong to any item of the work, not necessarily its nitrate item. " +
          "No items recorded is necessarily zero in this selection."
        : "Preservation status can belong to any item of a work. Missing status is not evidence that a work is unpreserved.";
    }
    if (sortSelect) sortSelect.disabled = group !== "country";
    if (limitSelect) limitSelect.disabled = group !== "country";
    for (const button of groupButtons || []) {
      const active = (button.dataset.preservationGroup || "decade") === group;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    svg.attr(
      "aria-label",
      group === "country"
        ? "Works with preservation copies recorded by production country"
        : "Works with preservation copies recorded by production decade"
    );
  }

  function overviewCacheKey() {
    return `${ctx.scopeFilter()}|${within}`;
  }

  function queryFilter() {
    return `${ctx.scopeFilter()}\n${withinFilter(within)}`;
  }

  function facetKey() {
    return `${overviewCacheKey()}|${group}`;
  }

  function cancelRequest() {
    requestToken += 1;
    if (requestController) requestController.abort();
    requestController = null;
  }

  function controllerFor(signal) {
    if (requestController) requestController.abort();
    const controller = new AbortController();
    requestController = controller;
    if (signal) {
      if (signal.aborted) controller.abort();
      else
        signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
    }
    return controller;
  }

  async function ensureOverview(signal) {
    const key = overviewCacheKey();
    if (overview && overviewKey === key) {
      renderOverview();
      return;
    }
    const rows = await runQuery(
      "preservation-overview",
      { SCOPE_FILTER: queryFilter() },
      { signal }
    );
    if (signal?.aborted || overviewCacheKey() !== key) return;
    const metrics = {};
    for (const row of rows) {
      if (row.metric) metrics[row.metric] = Number(row.n) || 0;
    }
    overview = {
      works: metrics.works || 0,
      items: metrics.items || 0,
      preservation: metrics.preservation || 0,
      access: metrics.access || 0
    };
    overviewKey = key;
    renderOverview();
    refreshStats();
  }

  async function ensureGroup(signal, allowFallback = false) {
    const requested = group;
    const key = facetKey();
    if (facetCache.has(key)) {
      data = { key, group: requested, rows: facetCache.get(key) };
      draw();
      return;
    }
    const query =
      requested === "country"
        ? "preservation-countries"
        : "preservation-decades";
    const rows = await runQuery(
      query,
      { SCOPE_FILTER: queryFilter() },
      { signal }
    );
    if (signal?.aborted || group !== requested || facetKey() !== key) return;
    const grouped = new Map();
    for (const row of rows) {
      if (!row.metric) continue;
      const value =
        requested === "country" ? row.country : String(row.decade || "");
      if (!value) continue;
      let entry = grouped.get(value);
      if (!entry) {
        entry = { key: value, metrics: {} };
        grouped.set(value, entry);
      }
      entry.metrics[row.metric] = Number(row.n) || 0;
    }
    const list = [...grouped.values()];
    facetCache.set(key, list);
    if (
      requested === "decade" &&
      !list.length &&
      allowFallback &&
      group === "decade"
    ) {
      // Some contributed datasets carry no production dates. Keep the view
      // useful by opening the country facet, but say explicitly what happened.
      group = "country";
      fallbackNote = true;
      setGroupChrome();
      await ensureGroup(signal, false);
      return;
    }
    data = { key, group: requested, rows: list };
    draw();
  }

  function numeratorFor(entry) {
    return entry.metrics.preservation || 0;
  }

  function denominatorFor(entry) {
    return entry.metrics.works || 0;
  }

  function measureValue(entry) {
    if (measure === "count") return entry.metrics.works || 0;
    const denominator = denominatorFor(entry);
    return denominator ? 100 : 0;
  }

  function normaliseRows() {
    if (!data || data.group !== group || data.key !== facetKey()) return [];
    if (group === "decade") {
      const entries = data.rows
        .map((entry) => ({ ...entry, value: measureValue(entry) }))
        .sort((a, b) => Number(a.key) - Number(b.key));
      if (!entries.length) return [];
      const first = Number(entries[0].key);
      const last = Number(entries[entries.length - 1].key);
      const lookup = new Map(entries.map((entry) => [entry.key, entry]));
      const rows = [];
      for (let decade = first; decade <= last; decade += 10) {
        const key = String(decade);
        const entry = lookup.get(key) || { key, metrics: {} };
        rows.push({
          ...entry,
          label: `${key}s`,
          numerator: numeratorFor(entry),
          denominator: denominatorFor(entry),
          value: measureValue(entry)
        });
      }
      return rows;
    }
    const entries = data.rows
      .map((entry) => ({
        ...entry,
        label: humanize(entry.key),
        numerator: numeratorFor(entry),
        denominator: denominatorFor(entry),
        value: measureValue(entry)
      }))
      .sort(
        (a, b) =>
          (sort === "total" ? b.denominator - a.denominator :
            sort === "coverage" ?
              (b.denominator ? b.numerator / b.denominator : -1) -
              (a.denominator ? a.numerator / a.denominator : -1) : 0) ||
          a.label.localeCompare(b.label)
      );
    return rowLimit === null ? entries : entries.slice(0, rowLimit);
  }

  function tooltipBody(row) {
    return `${row.category.label}: ${ui.formatNumber(row.count)} works · ` +
      `${formatPercent(row.denominator ? 100 * row.count / row.denominator : 0)} of ` +
      `${ui.formatNumber(row.denominator)} works in this group · activate for titles`;
  }

  function ariaLabel(row) {
    return `${row.label}. ${tooltipBody(row)}.`;
  }

  function stackRows(rows) {
    return rows.flatMap((row, index) => {
      let offset = 0;
      return composition(row.metrics).map((category) => {
        const start = offset;
        offset += measure === "count" ? category.count :
          row.denominator ? 100 * category.count / row.denominator : 0;
        return { ...row, category, count: category.count, index, start, end: offset };
      }).filter((segment) => segment.count > 0);
    });
  }

  function attachBar(selection) {
    return selection
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (row) => ariaLabel(row))
      .on("mouseenter", (event, row) => {
        ui.showTooltip(event, row.label, tooltipBody(row));
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip)
      .on("click", (event, row) => openGroup(row))
      .on("keydown", (event, row) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openGroup(row);
        }
      });
  }

  function refreshStats() {
    if (!data || data.group !== group) return;
    updateStats();
  }

  // Both charts derive their height from the width, so remember the width of
  // the last draw: a tab revisit or a drawer toggle that leaves it unchanged
  // does not rebuild the chart.
  let drawnWidth = -1;

  function draw() {
    paint();
    drawnWidth = root.clientWidth;
  }

  function paint() {
    const rows = normaliseRows();
    lastRows = rows;
    if (!rows.length) {
      root.style.height = "";
      ui.empty(
        root,
        group === "country"
          ? "No works with a production country were found in this selection."
          : "No dated works in this selection. Switch to Country to see preservation copies by production country."
      );
      refreshStats();
      return;
    }

    if (group === "country") drawCountryBars(rows);
    else drawDecadeBars(rows);
    refreshStats();
  }

  function drawDecadeBars(rows) {
    ui.clear(root);
    const width = Math.max(360, root.clientWidth || 1000);
    const height = Math.max(380, Math.min(520, Math.round(width * 0.42)));
    const margin = { top: 18, right: 24, bottom: 42, left: 62 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    root.style.height = `${height}px`;
    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height);
    svg.selectAll("*").remove();

    const x = d3
      .scaleBand()
      .domain(rows.map((row) => row.key))
      .range([0, innerWidth])
      .paddingInner(0.18);
    const maximum =
      measure === "count"
        ? d3.max(rows, (row) => row.value) || 1
        : 100;
    const y = d3
      .scaleLinear()
      .domain([0, maximum])
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
      rows.length > 20
        ? rows.filter((row) => Number(row.key) % 20 === 0)
        : rows;

    chart
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(tickValues.map((row) => row.key))
          .tickFormat((key) => `${key}s`)
      );

    chart
      .append("g")
      .attr("class", "axis")
      .call(
        d3
          .axisLeft(y)
          .ticks(6)
          .tickFormat((value) =>
            measure === "count" ? ui.formatNumber(value) : `${value}%`
          )
      );

    attachBar(
      chart
        .append("g")
        .selectAll("rect")
        .data(stackRows(rows), (row) => `${row.key}|${row.category.key}`)
        .join("rect")
        .attr("class", "bar preservation-bar")
        .attr("x", (row) => x(row.key))
        .attr("y", (row) => y(row.end))
        .attr("width", Math.max(1, x.bandwidth()))
        .attr("height", (row) => Math.max(0, y(row.start) - y(row.end)))
        .attr("fill", (row) => row.category.colour)
    );
  }

  function drawCountryBars(rows) {
    ui.clear(root);
    const width = Math.max(360, root.clientWidth || 1000);
    const rowHeight = 27;
    const margin = {
      top: 10,
      right: 108,
      bottom: 32,
      left: Math.min(180, Math.max(112, width * 0.3))
    };
    const height = rows.length * rowHeight + margin.top + margin.bottom;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = rows.length * rowHeight;
    root.style.height = `${height}px`;
    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height);
    svg.selectAll("*").remove();

    const maximum =
      measure === "count"
        ? d3.max(rows, (row) => row.value) || 1
        : 100;
    const x = d3.scaleLinear().domain([0, maximum]).nice().range([0, innerWidth]);

    const chart = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    chart
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(5)
          .tickFormat((value) =>
            measure === "count" ? ui.formatNumber(value) : `${value}%`
          )
      );

    chart
      .append("g")
      .selectAll("text")
      .data(rows, (row) => row.key)
      .join("text")
      .attr("class", "bar-label")
      .attr("x", -8)
      .attr("y", (row, index) => index * rowHeight + rowHeight / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", "end")
      .text((row) => truncate(row.label, Math.round(margin.left / 7)));

    attachBar(
      chart
        .append("g")
        .selectAll("rect")
        .data(stackRows(rows), (row) => `${row.key}|${row.category.key}`)
        .join("rect")
        .attr("class", "bar preservation-bar")
        .attr("x", (row) => x(row.start))
        .attr("y", (row) => row.index * rowHeight + 4)
        .attr("width", (row) => Math.max(0, x(row.end) - x(row.start)))
        .attr("height", rowHeight - 8)
        .attr("fill", (row) => row.category.colour)
    );

    chart
      .append("g")
      .selectAll("text")
      .data(rows, (row) => row.key)
      .join("text")
      .attr("class", "bar-value")
      .attr("x", (row) => Math.max(0, x(row.value)) + 5)
      .attr("y", (row, index) => index * rowHeight + rowHeight / 2)
      .attr("dy", "0.35em")
      .text((row) =>
        measure === "count"
          ? ui.formatNumber(row.denominator)
          : row.denominator ? formatPercent(100 * row.numerator / row.denominator) : "N/A"
       );
  }

  function updateStats() {
    if (!statsElement) return;
    const parts = [
      measure === "count"
        ? "Stacked counts of distinct works, not copies" +
          (group === "country" ? "; row-end values show total works" : "")
        : "Each stack = 100% of works in its group" +
          (group === "country" ? "; row-end values show preservation coverage" : "")
    ];
    if (fallbackNote && group === "country") {
      parts.unshift("No dated works in this selection; showing production countries");
    }
    if (group === "country") {
      parts.push(
        `Showing ${ui.formatNumber(lastRows.length)} of ${ui.formatNumber(data.rows.length)} countries`,
        sort === "name" ? "country name order" : sort === "total" ? "total works, highest first" :
          "preservation coverage, highest first (preservation-recorded works / all works in each country)",
        "Co-productions count under each country"
      );
    } else {
      const first = data && data.rows.length ? data.rows[0].key : null;
      const last =
        data && data.rows.length
          ? data.rows[data.rows.length - 1].key
          : null;
      const range = first && last ? ` (${first}s–${last}s)` : "";
      parts.push(
        `${ui.formatNumber(data.rows.length)} decades with dated works${range}`,
        "Chronological order; works with dates in several decades count in each"
      );
    }
    statsElement.textContent = parts.join(" · ");
  }

  function renderOverview() {
    if (!overviewElement || !overview) return;
    const works = overview.works || 0;
    const items = overview.items || 0;
    const preservation = overview.preservation || 0;
    const segments = composition(overview).map((segment) => ({
      ...segment,
      share: works ? (100 * segment.count) / works : 0
    }));

    overviewElement.replaceChildren();
    overviewElement.append(ui.node("h3", "preservation-headline",
      `${ui.formatNumber(preservation)} ${preservation === 1 ? "work has" : "works have"} preservation copies recorded`
    ));
    overviewElement.append(ui.node("p", "preservation-note",
      `${works ? formatPercent(100 * preservation / works) : "N/A"} of ${ui.formatNumber(works)} total works · ` +
      `${items ? formatPercent(100 * preservation / items) : "N/A"} of ${ui.formatNumber(items)} works with recorded items`
    ));
    const bar = ui.node("div", "preservation-composition");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", works ? segments.map((segment) =>
      `${segment.label}: ${ui.formatNumber(segment.count)} works, ${formatPercent(segment.share)}`
    ).join("; ") : "No works in this selection");
    for (const segment of segments) {
      const part = ui.node("span", "preservation-segment");
      part.style.background = segment.colour;
      part.style.width = `${segment.share}%`;
      part.hidden = segment.count === 0;
      part.title = `${segment.label}: ${ui.formatNumber(segment.count)} works (${formatPercent(segment.share)})`;
      bar.append(part);
    }
    overviewElement.append(bar);
    const details = ui.node("details", "preservation-details");
    details.append(ui.node("summary", "", "How this is counted and missing data"));
    const legend = ui.node("ul", "preservation-legend");
    for (const segment of segments) {
      const item = ui.node("li", "preservation-legend-item");
      const swatch = ui.node("span", "preservation-swatch");
      swatch.style.background = segment.colour;
      swatch.setAttribute("aria-hidden", "true");
      const text = ui.node("span", "preservation-legend-label", segment.label);
      const value = ui.node(
        "span",
        "preservation-legend-value",
        `${ui.formatNumber(segment.count)} · ${formatPercent(segment.share)}`
      );
      item.append(swatch, text, value);
      legend.append(item);
    }
    overviewElement.append(legend);

    const definition = ui.node(
      "p",
      "preservation-note",
      "A work is counted once when at least one item hasStatus Preservation. " +
        "Formats, codecs and element types do not imply preservation status."
    );
    details.append(definition);

    const caveat = ui.node(
      "p",
      "preservation-note",
      "Recorded data only. Neither missing preservation status nor missing item records " +
        "means a work is unpreserved. Coverage reflects cataloguing as well as holdings."
    );
    if (overview.access) {
      caveat.textContent +=
        ` Access copies are recorded for ${ui.formatNumber(overview.access)} ` +
        "works; they are not counted as preservation copies.";
    }
    details.append(caveat);
    overviewElement.append(details);
  }

  async function load({ signal } = {}) {
    const token = ++requestToken;
    const controller = controllerFor(signal);
    fallbackNote = false;
    if (!hasRendered) {
      ui.message(root, "Loading preservation copies…");
    }
    ui.setStatus("Loading preservation copies…");
    try {
      await Promise.all([
        ensureOverview(controller.signal),
        ensureGroup(controller.signal, true)
      ]);
      if (token !== requestToken) return;
      hasRendered = true;
      ui.setStatus("");
    } finally {
      if (requestController === controller) requestController = null;
    }
  }

  async function loadGroup() {
    const token = ++requestToken;
    const controller = controllerFor(null);
    if (!facetCache.has(facetKey())) {
      ui.message(root, "Loading recorded preservation coverage…");
      if (statsElement) statsElement.textContent = "Loading grouping…";
    }
    ui.setStatus("Loading preservation copies…");
    try {
      await Promise.all([
        ensureOverview(controller.signal),
        ensureGroup(controller.signal)
      ]);
      if (token !== requestToken) return;
      hasRendered = true;
      ui.setStatus("");
    } finally {
      if (requestController === controller) requestController = null;
    }
  }

  async function openGroup(row) {
    const token = ++drawerToken;
    if (drawerController) drawerController.abort();
    const controller = new AbortController();
    drawerController = controller;
    const workLimit = limit("heatmapWorkRows", 200);
    const title = `${row.label} · ${row.category.label}`;
    const share = row.denominator
      ? ` · ${formatPercent((100 * row.count) / row.denominator)} of ` +
        `${ui.formatNumber(row.denominator)} works in this group`
      : "";
    const subtitle =
      `${ui.formatNumber(row.count)} ${row.count === 1 ? "work" : "works"}${share}.` +
      (within === "nitrate" ? " Within works with nitrate holdings; preservation status may belong to any item of the work." : "");
    ui.openDrawer(title, subtitle);
    ui.drawerMessage("Loading works…");
    try {
      const query =
        group === "country"
          ? "preservation-country-works"
          : "preservation-decade-works";
      const substitutions = {
        SCOPE_FILTER: queryFilter(),
        STATUS_FILTER: statusFilter(row.category.key),
        LIMIT: workLimit
      };
      if (group === "country") {
        substitutions.COUNTRY = sparqlIri(row.key);
      } else {
        substitutions.YEAR_PREFIX = sparqlLiteral(String(row.key).slice(0, 3));
      }
      const rows = await runQuery(query, substitutions, {
        signal: controller.signal
      });
      if (token !== drawerToken) return;
      const limited = workLimit > 0 && rows.length < row.count && rows.length >= workLimit;
      ui.openDrawer(
        title,
        subtitle +
          (limited
            ? ` Row limit reached; showing at most ${ui.formatNumber(
                workLimit
              )} works.`
            : "")
      );
      if (!rows.length) {
        ui.drawerMessage("No works returned for this bar.");
        return;
      }
      ui.drawerList(rows, {
        title: (entry) => entry.title || entry.work,
        meta: (entry) => {
          const parts = [];
          if (entry.year) parts.push(entry.year);
          const copies = Number(entry.preservationItems) || 0;
          if (copies) {
            parts.push(
              `${ui.formatNumber(copies)} preservation ${
                copies === 1 ? "copy" : "copies"
              }`
            );
          }
          return parts.join(" · ");
        },
        onSelect: (entry) =>
          ctx.openWork(entry.work, entry.title || entry.work)
      });
    } catch (error) {
      if (token !== drawerToken || error.name === "AbortError") return;
      ui.drawerMessage(error.message, "error");
    } finally {
      if (token === drawerToken) drawerController = null;
    }
  }

  document.addEventListener("fiaf-viz:drawer-close", () => {
    drawerToken += 1;
    if (drawerController) drawerController.abort();
    drawerController = null;
  });

  setGroupChrome();

  const view = {
    load,
    invalidate() {
      cancelRequest();
      drawerToken += 1;
      if (drawerController) drawerController.abort();
      drawerController = null;
      facetCache.clear();
      data = null;
      overview = null;
      overviewKey = "";
      hasRendered = false;
      fallbackNote = false;
      lastRows = [];
      if (overviewElement) overviewElement.replaceChildren();
      if (statsElement) statsElement.textContent = "";
      ui.clear(root);
    },
    pause() {
      cancelRequest();
    },
    resize() {
      if (data && data.group === group && root.clientWidth !== drawnWidth) draw();
    },
    exportSvg() {
      return { element: svg.node(), name: "fiaf-preservation.svg" };
    }
  };
  return view;
}
