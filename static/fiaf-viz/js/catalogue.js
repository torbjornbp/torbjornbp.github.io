// Catalogue: faceted work search, a result table and record-set navigation.
//
// The page query returns only work IRIs, titles and years; a second query
// enriches just those rows. Filters are composed in sparql.js so no query text
// is built from raw user input here.
//
// SPARQL mode runs user-authored SELECT/ASK queries. The table renders whatever
// variables come back, and every IRI cell opens the matching record through
// ctx.openEntity (work drawer, name drawer or generic record inspector).

import {
  catalogueFilter,
  catalogueQuery,
  iriList,
  limit,
  runQuery,
  runRawQuery,
  withQueryLimit
} from "./sparql.js";
import { FIAF_NS, humanize, localName } from "./labels.js";
import * as ui from "./ui.js";
import { attachSparqlHighlight } from "./sparql-highlight.js";

const SORT_ORDERS = {
  title: "?title ?work",
  "year-asc": 'COALESCE(?year, "9999") ?title ?work',
  "year-desc": 'DESC(COALESCE(?year, "0000")) ?title ?work'
};
const SORT_DEFAULT = "title";
const FACET_KEYS = [
  "decade", "country", "form", "genre", "format", "institution"
];

function splitValues(value) {
  return String(value || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function displayValue(value) {
  return /^https?:\/\//.test(value) ? humanize(value) : value;
}

function displayList(value, transform = displayValue) {
  return splitValues(value).map(transform).join(", ");
}

function emptyFacets() {
  return Object.fromEntries(FACET_KEYS.map((key) => [key, []]));
}

function displayIri(value) {
  const text = String(value || "");
  if (text.startsWith(FIAF_NS)) return `fiaf:${localName(text)}`;
  return localName(text) || text;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function displayIdentifier(value) {
  const text = String(value || "");
  return UUID_RE.test(text) ? `${text.slice(0, 8)}…` : text;
}

function variableLabel(name) {
  return humanize(String(name || "").replace(/_/g, " "));
}

// Prefer a literal label selected alongside the IRI (both ?title and
// ?workTitle style names). Queries that only project the IRI fall back to the
// record drawer's own metadata lookup.
function rowLabel(row, variable) {
  if (!row) return "";
  const specific = [
    `${variable}Label`, `${variable}Title`, `${variable}Name`,
    `${variable}Identifier`
  ];
  for (const key of specific) {
    const term = row[key];
    if (term && term.type === "literal" && term.value) {
      return key.endsWith("Identifier")
        ? displayIdentifier(term.value)
        : term.value;
    }
  }
  // A generic ?title/?name is unambiguous when only one IRI is projected, or
  // when it belongs to the canonical work/agent column. Avoid labelling a
  // manifestation or item with the work title in a multi-entity row.
  const entities = Object.values(row).filter(
    (term) => term && term.type === "uri"
  ).length;
  const generic =
    variable === "work"
      ? ["title", "label"]
      : variable === "agent"
        ? ["name", "label"]
        : variable === "id" || entities === 1
          ? ["label", "title", "name"]
          : [];
  for (const key of generic) {
    const term = row[key];
    if (term && term.type === "literal" && term.value) return term.value;
  }
  return "";
}

const WORK_QUERY = `SELECT ?work (SAMPLE(?candidateTitle) AS ?title) (MIN(?rawYear) AS ?year)
WHERE {
  VALUES ?workType { fiaf:MonographicWork fiaf:Work }
  ?work a ?workType .
  OPTIONAL { ?work rdfs:label ?workLabel }
  OPTIONAL { ?work fiaf:hasTitle/fiaf:hasTitleValue ?titleValue }
  BIND(COALESCE(?workLabel, ?titleValue) AS ?candidateTitle)
  OPTIONAL {
    ?work fiaf:hasEvent ?event .
    ?event a fiaf:ProductionEvent ;
           fiaf:hasDate ?date .
    BIND(SUBSTR(STR(?date), 1, 4) AS ?rawYear)
    FILTER(REGEX(?rawYear, "^[0-9]{4}$"))
  }
}
GROUP BY ?work
ORDER BY ?title ?work
LIMIT 500`;

const NAMES_QUERY = `SELECT ?agent ?name (COUNT(DISTINCT ?work) AS ?works)
WHERE {
  VALUES ?workType { fiaf:MonographicWork fiaf:Work }
  ?work a ?workType ;
        fiaf:hasEvent/fiaf:hasActivity/fiaf:hasAgent ?agent .
  ?agent rdfs:label ?name .
}
GROUP BY ?agent ?name
ORDER BY DESC(?works) ?name
LIMIT 500`;

const HOLDINGS_QUERY = `SELECT ?work ?title ?manifestation ?manifestationLabel ?item ?itemLabel ?itemIdentifier ?format ?institution ?institutionLabel
WHERE {
  {
    SELECT ?work (SAMPLE(?candidateTitle) AS ?title)
    WHERE {
      VALUES ?workType { fiaf:MonographicWork fiaf:Work }
      ?work a ?workType .
      OPTIONAL { ?work rdfs:label ?workLabel }
      OPTIONAL { ?work fiaf:hasTitle/fiaf:hasTitleValue ?titleValue }
      BIND(COALESCE(?workLabel, ?titleValue) AS ?candidateTitle)
    }
    GROUP BY ?work
    ORDER BY ?title
    LIMIT 25
  }
  ?work fiaf:hasManifestation ?manifestation .
  OPTIONAL { ?manifestation rdfs:label ?manifestationLabel }
  OPTIONAL {
    ?manifestation fiaf:hasItem ?item .
    OPTIONAL { ?item rdfs:label ?itemLabel }
    OPTIONAL {
      ?item fiaf:hasIdentifier ?itemIdentifierNode .
      OPTIONAL { ?itemIdentifierNode fiaf:hasIdentifierValue ?itemIdentifierValue }
      BIND(COALESCE(?itemIdentifierValue, STR(?itemIdentifierNode)) AS ?itemIdentifier)
    }
    OPTIONAL { ?item fiaf:hasFormat ?format }
    OPTIONAL {
      ?item fiaf:hasHoldingInstitution ?institution .
      OPTIONAL { ?institution rdfs:label ?institutionLabel }
    }
  }
}
ORDER BY ?title ?manifestation ?item
LIMIT 500`;

const CARRIERS_QUERY = `SELECT ?work ?title ?item ?itemLabel ?itemIdentifier ?carrier ?carrierLabel ?carrierIdentifier
WHERE {
  {
    SELECT ?work (SAMPLE(?candidateTitle) AS ?title)
    WHERE {
      VALUES ?workType { fiaf:MonographicWork fiaf:Work }
      ?work a ?workType .
      OPTIONAL { ?work rdfs:label ?workLabel }
      OPTIONAL { ?work fiaf:hasTitle/fiaf:hasTitleValue ?titleValue }
      BIND(COALESCE(?workLabel, ?titleValue) AS ?candidateTitle)
    }
    GROUP BY ?work
    ORDER BY ?title
    LIMIT 25
  }
  ?work fiaf:hasManifestation/fiaf:hasItem ?item .
  OPTIONAL { ?item rdfs:label ?itemLabel }
  OPTIONAL {
    ?item fiaf:hasIdentifier ?itemIdentifierNode .
    OPTIONAL { ?itemIdentifierNode fiaf:hasIdentifierValue ?itemIdentifierValue }
    BIND(COALESCE(?itemIdentifierValue, STR(?itemIdentifierNode)) AS ?itemIdentifier)
  }
  OPTIONAL {
    ?item fiaf:hasCarrier ?carrier .
    OPTIONAL { ?carrier rdfs:label ?carrierLabel }
    OPTIONAL {
      ?carrier fiaf:hasIdentifier ?carrierIdentifierNode .
      OPTIONAL { ?carrierIdentifierNode fiaf:hasIdentifierValue ?carrierIdentifierValue }
      BIND(COALESCE(?carrierIdentifierValue, STR(?carrierIdentifierNode)) AS ?carrierIdentifier)
    }
  }
}
ORDER BY ?title ?item ?carrier
LIMIT 500`;

// ql:has-predicate is a QLever built-in with its own predeclared prefix. Do not
// add a PREFIX declaration for it: that would shadow the built-in and return
// nothing. This is the fast way to list predicates without scanning ?s ?p ?o.
const PREDICATES_QUERY = `# ql: is a QLever built-in prefix; do not redeclare it.
SELECT ?predicate (COUNT(*) AS ?uses)
WHERE {
  ?subject ql:has-predicate ?predicate .
}
GROUP BY ?predicate
ORDER BY DESC(?uses)
LIMIT 200`;

export function create(ctx, controls) {
  const {
    titleInput,
    identifierInput,
    nameInput,
    countrySelect,
    decadeSelect,
    formSelect,
    genreSelect,
    formatSelect,
    institutionSelect,
    sortSelect,
    resetButton,
    exportButton,
    agentFilterElement,
    agentNameElement,
    agentClearButton,
    filterPanel,
    modeButtons,
    sparqlPanel,
    sparqlInput,
    runButton,
    clearButton,
    templateButtons,
    queryStatusElement,
    statsElement,
    tableElement,
    prevButton,
    nextButton,
    pageElement
  } = controls;
  const refreshHighlight = attachSparqlHighlight(sparqlInput);

  let mode = "faceted";
  let facets = null;
  let facetsKey = "";
  let facetsError = null;
  let page = 0;
  let total = 0;
  let items = [];
  let sparqlResult = null;
  let expertError = null;
  let currentSelection = null;
  let agentFilter = null;
  let pageToken = 0;
  let activeController = null;
  let pendingReload = false;
  let filterTimer = null;

  function pageSize() {
    return Math.max(1, Math.floor(limit("catalogueRows", 100)) || 100);
  }

  function isVisible() {
    const view = titleInput ? titleInput.closest(".view") : null;
    return view ? !view.hidden : true;
  }

  function facetLabel(row) {
    const value = String(row.value || "");
    if (row.facet === "decade") return `${value}s`;
    const label =
      row.label && !/^https?:\/\//.test(row.label) ? row.label : humanize(value);
    return label || value;
  }

  function sortFacetRows(name, rows) {
    if (name === "decade") {
      rows.sort(
        (a, b) => Number(a.value) - Number(b.value) || a.value.localeCompare(b.value)
      );
      return;
    }
    rows.sort(
      (a, b) =>
        b.works - a.works ||
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    );
  }

  function fillSelect(select, options, placeholder) {
    if (!select) return;
    const selected = select.value;
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = placeholder;
    select.append(all);
    for (const option of options) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = `${option.label} (${ui.formatNumber(option.works)})`;
      select.append(element);
    }
    select.value = options.some((option) => option.value === selected)
      ? selected
      : "";
  }

  function renderFacets() {
    const data = facets || emptyFacets();
    fillSelect(countrySelect, data.country, "All countries");
    fillSelect(decadeSelect, data.decade, "All decades");
    fillSelect(formSelect, data.form, "All forms");
    fillSelect(genreSelect, data.genre, "All genres");
    fillSelect(formatSelect, data.format, "All item formats");
    fillSelect(institutionSelect, data.institution, "All institutions");
  }

  async function loadFacets(signal) {
    const key = ctx.scopeFilter();
    if (facets && facetsKey === key) return;
    const rows = await runQuery(
      "catalogue-facets",
      { SCOPE_FILTER: key },
      { signal }
    );
    const grouped = emptyFacets();
    for (const row of rows) {
      if (!row.facet || !row.value || !(row.facet in grouped)) continue;
      grouped[row.facet].push({
        value: row.value,
        label: facetLabel(row),
        works: Number(row.works) || 0
      });
    }
    for (const name of FACET_KEYS) sortFacetRows(name, grouped[name]);
    facets = grouped;
    facetsKey = key;
    facetsError = null;
    renderFacets();
  }

  function refreshFacets() {
    loadFacets().catch((error) => {
      if (error.name === "AbortError") return;
      facetsError = error;
      facets = emptyFacets();
      renderFacets();
    });
  }

  function readFilters() {
    return {
      title: titleInput ? titleInput.value.trim() : "",
      identifier: identifierInput ? identifierInput.value.trim() : "",
      name: nameInput ? nameInput.value.trim() : "",
      country: countrySelect ? countrySelect.value : "",
      decade: decadeSelect ? decadeSelect.value : "",
      form: formSelect ? formSelect.value : "",
      genre: genreSelect ? genreSelect.value : "",
      format: formatSelect ? formatSelect.value : "",
      institution: institutionSelect ? institutionSelect.value : ""
    };
  }

  function sortOrder() {
    const value = sortSelect ? sortSelect.value : SORT_DEFAULT;
    return SORT_ORDERS[value] || SORT_ORDERS[SORT_DEFAULT];
  }

  function queryTemplates() {
    return {
      filters: catalogueQuery({
        scope: ctx.scopeFilter(),
        filter: catalogueFilter({
          ...readFilters(),
          agent: agentFilter ? agentFilter.id : ""
        }),
        order: sortOrder()
      }),
      works: WORK_QUERY,
      names: NAMES_QUERY,
      holdings: HOLDINGS_QUERY,
      carriers: CARRIERS_QUERY,
      predicates: PREDICATES_QUERY
    };
  }

  async function loadPage(externalSignal) {
    const token = ++pageToken;
    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else {
        externalSignal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
    }

    const filters = readFilters();
    const filterText = catalogueFilter({
      ...filters,
      agent: agentFilter ? agentFilter.id : ""
    });
    const size = pageSize();
    const offset = page * size;

    if (statsElement) statsElement.textContent = "Searching the catalogue…";

    try {
      const [works, countRows] = await Promise.all([
        runQuery(
          "catalogue-works",
          {
            SCOPE_FILTER: ctx.scopeFilter(),
            CATALOGUE_FILTER: filterText,
            CATALOGUE_ORDER: sortOrder(),
            LIMIT: size,
            OFFSET: offset
          },
          { signal: controller.signal }
        ),
        runQuery(
          "catalogue-count",
          {
            SCOPE_FILTER: ctx.scopeFilter(),
            CATALOGUE_FILTER: filterText
          },
          { signal: controller.signal }
        )
      ]);
      if (token !== pageToken) return;

      total = countRows.length ? Number(countRows[0].works) || 0 : 0;
      const pages = Math.max(1, Math.ceil(total / size));
      if (total > 0 && page >= pages) {
        page = pages - 1;
        await loadPage();
        return;
      }

      if (!works.length) {
        items = [];
        render();
        return;
      }

      const rowsByWork = new Map();
      const metaRows = await runQuery(
        "catalogue-rows",
        { WORK_IRIS: iriList(works.map((row) => row.work)) },
        { signal: controller.signal }
      );
      if (token !== pageToken) return;
      for (const row of metaRows) rowsByWork.set(row.work, row);
      items = works.map((row) => ({
        ...row,
        ...(rowsByWork.get(row.work) || {})
      }));
      render();
    } finally {
      if (activeController === controller) activeController = null;
    }
  }

  async function runExpert(externalSignal) {
    if (!sparqlInput) return;
    const query = sparqlInput.value.trim();
    if (!query) {
      expertError = new Error("Enter a SPARQL query first.");
      render();
      return;
    }

    const token = ++pageToken;
    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;
    const abort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) abort();
      else externalSignal.addEventListener("abort", abort, { once: true });
    }

    expertError = null;
    if (queryStatusElement) queryStatusElement.textContent = "Running query…";
    if (runButton) runButton.disabled = true;
    if (statsElement) statsElement.textContent = "Running query…";

    try {
      const result = await runRawQuery(query, {
        signal: controller.signal,
        onStatus: (status) => {
          if (!queryStatusElement) return;
          if (
            status.kind === "retry" ||
            status.kind === "queued" ||
            status.kind === "cooldown" ||
            status.kind === "attempt"
          ) {
            queryStatusElement.textContent = status.message;
          }
        }
      });
      if (token !== pageToken) return;
      sparqlResult = result;
      page = 0;
      total = result.rows.length;
      items = result.rows;
      render();
      if (queryStatusElement) {
        const count = result.rows.length;
        queryStatusElement.textContent =
          result.boolean === undefined
            ? `Finished in ${ui.formatNumber(result.elapsedMs)} ms · ` +
              `${ui.formatNumber(count)} ${count === 1 ? "row" : "rows"}`
            : `Finished in ${ui.formatNumber(result.elapsedMs)} ms · ` +
              `result: ${result.boolean}`;
      }
    } catch (error) {
      if (token !== pageToken || error.name === "AbortError") return;
      expertError = error;
      render();
      if (queryStatusElement) queryStatusElement.textContent = error.message;
    } finally {
      if (activeController === controller) activeController = null;
      if (externalSignal) externalSignal.removeEventListener("abort", abort);
      if (token === pageToken && runButton) runButton.disabled = false;
    }
  }

  function refresh() {
    if (mode === "sparql") {
      render();
      return;
    }
    if (!isVisible()) {
      pendingReload = true;
      return;
    }
    loadPage().catch((error) => {
      if (error.name === "AbortError") return;
      ui.setStatus(`Catalogue search failed: ${error.message}`, "error");
    });
  }

  function cancelExpert() {
    pageToken += 1;
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
    if (runButton) runButton.disabled = false;
  }

  function setQueryLimit(maxRows) {
    if (!sparqlInput) return;
    const text = sparqlInput.value.trim();
    if (!text) return;
    sparqlInput.value = withQueryLimit(text, maxRows, true);
  }

  function runSampledQuery() {
    setQueryLimit(100);
    if (queryStatusElement) {
      queryStatusElement.textContent = "Running query with LIMIT 100…";
    }
    runExpert();
  }

  function cell(text, className) {
    return ui.node("td", className, text);
  }

  function renderRow(row, index) {
    const title = row.title || localName(row.work) || row.work;
    const tr = ui.node("tr", "catalogue-row");
    tr.dataset.work = row.work;
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute(
      "aria-label",
      `${title}${row.year ? `, ${row.year}` : ""}. Open record.`
    );

    const titleCell = document.createElement("td");
    titleCell.className = "catalogue-title-cell";
    titleCell.append(ui.node("span", "catalogue-title", title));
    const subParts = [];
    if (row.sourceDatasets) {
      subParts.push(displayList(row.sourceDatasets));
    }
    const identifiers = splitValues(row.identifiers);
    if (identifiers.length) {
      const shown = identifiers.slice(0, 2).join(", ");
      subParts.push(
        identifiers.length > 2 ? `${shown} +${identifiers.length - 2}` : shown
      );
    }
    titleCell.append(
      ui.node(
        "span",
        "catalogue-sub",
        subParts.join(" · ") || localName(row.work) || row.work
      )
    );
    tr.append(titleCell);

    tr.append(cell(row.year || "—", "catalogue-year"));
    tr.append(cell(displayList(row.countries) || "—", "catalogue-tags"));
    tr.append(
      cell(
        [
          displayList(row.forms),
          displayList(row.genres)
        ]
          .filter(Boolean)
          .join(" · ") || "—",
        "catalogue-tags"
      )
    );

    const manifestationCount = Number(row.manifestations) || 0;
    const itemCount = Number(row.items) || 0;
    const carrierCount = Number(row.carriers) || 0;
    const holdings = [
      `${ui.formatNumber(manifestationCount)} M`,
      `${ui.formatNumber(itemCount)} I`
    ];
    if (carrierCount) holdings.push(`${ui.formatNumber(carrierCount)} C`);
    tr.append(cell(holdings.join(" · "), "catalogue-holdings"));

    tr.addEventListener("click", () => openRow(index));
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openRow(index);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const rows = [...tableElement.querySelectorAll("tr.catalogue-row")];
        const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) next.focus();
      }
    });
    return tr;
  }

  function renderFacetedTable() {
    if (!tableElement) return;
    tableElement.replaceChildren();
    if (!items.length) {
      tableElement.append(
        ui.node("p", "catalogue-empty", "No works match these filters.")
      );
      return;
    }

    const table = ui.node("table", "catalogue-table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const columns = [
      ["Title / identifiers", ""],
      ["Year", "catalogue-year"],
      ["Country", "catalogue-tags"],
      ["Form / genre", "catalogue-tags"],
      ["Holdings", "catalogue-holdings"]
    ];
    for (const [label, className] of columns) {
      const th = ui.node("th", className, label);
      th.scope = "col";
      headRow.append(th);
    }
    head.append(headRow);

    const body = document.createElement("tbody");
    items.forEach((row, index) => {
      body.append(renderRow(row, index));
    });
    table.append(head, body);
    tableElement.append(table);
    select(currentSelection);
  }

  function termNode(term, variable, row) {
    if (!term || term.value === undefined) return "—";
    if (term.type === "uri") {
      const label = rowLabel(row, variable) || displayIri(term.value);
      const button = ui.node("button", "catalogue-link", label);
      button.type = "button";
      button.title = term.value;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        ctx.openEntity(term.value, label, variable);
      });
      return button;
    }
    const text = ui.node("span", "catalogue-literal", term.value);
    if (term.type === "bnode") {
      text.textContent = `_:${localName(term.value) || term.value}`;
      return text;
    }
    if (term.lang) {
      text.append(ui.node("span", "catalogue-term-tag", `@${term.lang}`));
    } else if (
      term.datatype &&
      !/XMLSchema#(string|langString)$/.test(term.datatype)
    ) {
      text.append(
        ui.node("span", "catalogue-term-tag", localName(term.datatype))
      );
    }
    return text;
  }

  function renderExpertTable() {
    if (!tableElement) return;
    tableElement.replaceChildren();
    if (expertError) {
      const box = ui.node("div", "catalogue-query-error");
      box.append(ui.node("p", "", expertError.message));
      if (expertError.code === "RATE_LIMITED") {
        box.append(
          ui.node(
            "p",
            "catalogue-query-note",
            "Another retry will likely be rate-limited too. Retry waits for " +
              "the cooldown, but a smaller query is more reliable."
          )
        );
      } else if (expertError.code === "HEAVY_QUERY") {
        box.append(
          ui.node(
            "p",
            "catalogue-query-note",
            "Retrying the same large query is unlikely to help. Reduce it " +
              "with LIMIT 100 or a narrower pattern."
          )
        );
      }
      const actions = ui.node("div", "catalogue-query-error-actions");
      const retry = ui.node("button", "catalogue-run", "Retry query");
      retry.type = "button";
      retry.addEventListener("click", () => runExpert());
      actions.append(retry);
      if (
        expertError.code === "HEAVY_QUERY" ||
        expertError.code === "RATE_LIMITED"
      ) {
        const sampled = ui.node("button", "fit", "Run with LIMIT 100");
        sampled.type = "button";
        sampled.addEventListener("click", runSampledQuery);
        actions.append(sampled);
      }
      box.append(actions);
      tableElement.append(box);
      if (!sparqlResult) return;
      tableElement.append(
        ui.node(
          "p",
          "catalogue-query-hint",
          "Showing the previous successful result; the new query did not replace it."
        )
      );
    }
    if (!sparqlResult) {
      tableElement.append(
        ui.node("p", "catalogue-empty", "Run a query to see results.")
      );
      return;
    }
    if (sparqlResult.boolean !== undefined) {
      tableElement.append(
        ui.node(
          "p",
          "catalogue-ask",
          `ASK result: ${sparqlResult.boolean ? "true" : "false"}`
        )
      );
      return;
    }
    if (!items.length) {
      tableElement.append(
        ui.node(
          "p",
          "catalogue-empty",
          "The query ran successfully but returned no rows."
        )
      );
      const source = sparqlInput ? sparqlInput.value : "";
      if (/rdfs:label/i.test(source) && !/hasTitle/i.test(source)) {
        const hint = ui.node("div", "catalogue-query-hint");
        hint.append(
          ui.node(
            "p",
            "",
            "Public works usually have no rdfs:label. Titles are stored as " +
              "fiaf:hasTitle/fiaf:hasTitleValue."
          )
        );
        const fix = ui.node(
          "button",
          "catalogue-link",
          "Replace rdfs:label with the title path"
        );
        fix.type = "button";
        fix.addEventListener("click", () => {
          if (!sparqlInput) return;
          sparqlInput.value = sparqlInput.value.replace(
            /rdfs:label(?=\s+\?)/,
            "fiaf:hasTitle/fiaf:hasTitleValue"
          );
          sparqlResult = null;
          expertError = null;
          items = [];
          total = 0;
          page = 0;
          if (queryStatusElement) {
            queryStatusElement.textContent =
              "Query updated. Press Run query to execute.";
          }
          render();
        });
        hint.append(fix);
        tableElement.append(hint);
      }
      return;
    }

    const size = pageSize();
    const start = page * size;
    const rows = items.slice(start, start + size);
    const table = ui.node("table", "catalogue-table catalogue-table-query");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const variable of sparqlResult.vars) {
      const th = ui.node("th", "", variableLabel(variable));
      th.scope = "col";
      th.title = `?${variable}`;
      headRow.append(th);
    }
    head.append(headRow);

    const body = document.createElement("tbody");
    for (const row of rows) {
      const tr = ui.node("tr", "catalogue-row catalogue-row-query");
      const workTerm = row.work;
      if (workTerm && workTerm.type === "uri") tr.dataset.work = workTerm.value;
      for (const variable of sparqlResult.vars) {
        const td = document.createElement("td");
        td.append(termNode(row[variable], variable, row));
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(head, body);
    tableElement.append(table);
    select(currentSelection);
  }

  function updatePager() {
    const size = pageSize();
    const pages = Math.max(1, Math.ceil(total / size));
    if (prevButton) prevButton.disabled = page <= 0;
    if (nextButton) nextButton.disabled = page + 1 >= pages;
    if (pageElement) {
      pageElement.textContent = total
        ? `Page ${ui.formatNumber(page + 1)} of ${ui.formatNumber(pages)}`
        : "";
    }
  }

  function visibleCount() {
    if (mode === "sparql") {
      return Math.max(0, Math.min(pageSize(), items.length - page * pageSize()));
    }
    return items.length;
  }

  function renderFaceted() {
    renderFacetedTable();
    updatePager();
    const size = pageSize();
    const start = total ? page * size + 1 : 0;
    const end = Math.min(total, page * size + visibleCount());
    let text = total
      ? `${ui.formatNumber(total)} ${total === 1 ? "work" : "works"} · ` +
        `showing ${ui.formatNumber(start)}–${ui.formatNumber(end)}`
      : "No works match these filters.";
    if (agentFilter) text += ` · credited to ${agentFilter.name}`;
    if (statsElement) statsElement.textContent = text;
    ui.setStatus(
      facetsError
        ? `Catalogue filters could not be loaded: ${facetsError.message}`
        : "",
      facetsError ? "error" : ""
    );
  }

  function renderExpert() {
    renderExpertTable();
    updatePager();
    const size = pageSize();
    const start = total ? page * size + 1 : 0;
    const end = Math.min(total, page * size + visibleCount());
    if (statsElement) {
      if (sparqlResult && sparqlResult.boolean !== undefined) {
        statsElement.textContent = "ASK query";
      } else if (total) {
        statsElement.textContent =
          `${ui.formatNumber(total)} ${total === 1 ? "row" : "rows"} · ` +
          `showing ${ui.formatNumber(start)}–${ui.formatNumber(end)}`;
      } else if (expertError) {
        statsElement.textContent = "Query failed.";
      } else if (sparqlResult) {
        statsElement.textContent = "The query returned no rows.";
      } else {
        statsElement.textContent = "Run a query to see results.";
      }
    }
  }

  function render() {
    if (mode === "sparql") renderExpert();
    else renderFaceted();
  }

  function openRow(index) {
    const row = items[index];
    if (!row) return;
    const navItems = items.map((entry) => ({
      work: entry.work,
      title: entry.title || localName(entry.work) || entry.work
    }));
    ctx.openWork(row.work, row.title || localName(row.work) || row.work, {
      tab: "holdings",
      nav: { items: navItems, index }
    });
  }

  function select(selection) {
    currentSelection = selection || null;
    if (!tableElement) return;
    const id = selection && selection.kind === "work" ? selection.id : null;
    for (const row of tableElement.querySelectorAll("tr.catalogue-row")) {
      row.classList.toggle("is-selected", row.dataset.work === id);
    }
  }

  function syncAgentChip() {
    if (!agentFilterElement) return;
    agentFilterElement.hidden = mode === "sparql" || !agentFilter;
    if (agentNameElement) {
      agentNameElement.textContent = agentFilter ? agentFilter.name : "";
    }
  }

  function clearFilterControls() {
    if (titleInput) titleInput.value = "";
    if (identifierInput) identifierInput.value = "";
    if (nameInput) nameInput.value = "";
    for (const selectElement of [
      countrySelect,
      decadeSelect,
      formSelect,
      genreSelect,
      formatSelect,
      institutionSelect
    ]) {
      if (selectElement) selectElement.value = "";
    }
    if (sortSelect) sortSelect.value = SORT_DEFAULT;
    agentFilter = null;
    syncAgentChip();
  }

  function resetFilters() {
    clearFilterControls();
    page = 0;
    refresh();
  }

  function csvValue(value) {
    return `"${String(value === undefined || value === null ? "" : value).replace(
      /"/g,
      '""'
    )}"`;
  }

  function downloadCsv(lines, filename) {
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], {
      type: "text/csv;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportRows() {
    if (mode === "sparql") {
      exportQueryRows();
      return;
    }
    if (!items.length) {
      ui.setStatus("There are no catalogue rows to export.", "error");
      return;
    }
    const header = [
      "Title", "Year", "Countries", "Forms", "Genres", "Identifiers",
      "Source datasets", "Manifestations", "Items", "Carriers", "Work IRI"
    ];
    const lines = [header.map(csvValue).join(",")];
    for (const row of items) {
      lines.push(
        [
          row.title || localName(row.work) || row.work,
          row.year || "",
          displayList(row.countries),
          displayList(row.forms),
          displayList(row.genres),
          splitValues(row.identifiers).join("; "),
          displayList(row.sourceDatasets),
          Number(row.manifestations) || 0,
          Number(row.items) || 0,
          Number(row.carriers) || 0,
          row.work
        ]
          .map(csvValue)
          .join(",")
      );
    }
    downloadCsv(lines, `fiaf-catalogue-page-${page + 1}.csv`);
  }

  function exportQueryRows() {
    if (!sparqlResult) {
      ui.setStatus("Run a query before exporting results.", "error");
      return;
    }
    let lines;
    if (sparqlResult.boolean !== undefined) {
      lines = [
        ["result", "boolean"].map(csvValue).join(","),
        [String(sparqlResult.boolean), "ASK"].map(csvValue).join(",")
      ];
    } else {
      if (!items.length) {
        ui.setStatus("The query returned no rows to export.", "error");
        return;
      }
      lines = [sparqlResult.vars.map(csvValue).join(",")];
      for (const row of items) {
        lines.push(
          sparqlResult.vars
            .map((variable) => {
              const term = row[variable];
              return csvValue(term ? term.value : "");
            })
            .join(",")
        );
      }
    }
    downloadCsv(lines, "fiaf-query-results.csv");
  }

  function setMode(next, options = {}) {
    if (next !== "faceted" && next !== "sparql") return;
    const changed = next !== mode;
    if (!changed) return;
    mode = next;
    page = 0;
    pageToken += 1;
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
    if (runButton) runButton.disabled = false;
    if (mode === "sparql" && sparqlResult) {
      items = sparqlResult.rows;
      total = items.length;
    } else {
      items = [];
      total = 0;
    }

    for (const button of modeButtons || []) {
      const active = button.dataset.catalogueMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (filterPanel) filterPanel.hidden = mode === "sparql";
    if (sparqlPanel) sparqlPanel.hidden = mode !== "sparql";
    // The counting note describes the faceted table, not a user's own query.
    const countingNote = document.getElementById("catalogue-counting");
    if (countingNote) countingNote.hidden = mode === "sparql";
    syncAgentChip();
    if (exportButton) {
      exportButton.textContent =
        mode === "sparql" ? "Download results CSV" : "Download page CSV";
    }

    if (mode === "sparql") {
      if (sparqlInput && !sparqlInput.value.trim()) {
        sparqlInput.value = queryTemplates().filters;
        sparqlResult = null;
        expertError = null;
        items = [];
        total = 0;
      }
      if (queryStatusElement) {
        queryStatusElement.textContent = sparqlResult
          ? ""
          : "Press Run query to execute.";
      }
      render();
    } else {
      if (queryStatusElement) queryStatusElement.textContent = "";
      refreshFacets();
      render();
      if (options.run !== false) refresh();
    }
  }

  async function load({ signal } = {}) {
    pendingReload = false;
    if (mode === "sparql") {
      render();
      return;
    }
    const facetsPromise = loadFacets(signal).catch((error) => {
      if (error.name === "AbortError") throw error;
      facetsError = error;
      facets = emptyFacets();
      renderFacets();
    });
    await Promise.all([facetsPromise, loadPage(signal)]);
  }

  for (const input of [titleInput, identifierInput, nameInput]) {
    if (!input) continue;
    input.addEventListener("input", () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        page = 0;
        refresh();
      }, 250);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      clearTimeout(filterTimer);
      page = 0;
      refresh();
    });
  }

  for (const selectElement of [
    countrySelect,
    decadeSelect,
    formSelect,
    genreSelect,
    formatSelect,
    institutionSelect
  ]) {
    if (!selectElement) continue;
    selectElement.addEventListener("change", () => {
      page = 0;
      refresh();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      page = 0;
      refresh();
    });
  }

  for (const button of modeButtons || []) {
    button.addEventListener("click", () =>
      setMode(button.dataset.catalogueMode)
    );
  }

  if (sparqlInput) {
    sparqlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        runExpert();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const start = sparqlInput.selectionStart;
        const end = sparqlInput.selectionEnd;
        sparqlInput.setRangeText("  ", start, end, "end");
        // setRangeText fires no input event.
        refreshHighlight();
      }
    });
    sparqlInput.addEventListener("input", () => {
      if (!queryStatusElement) return;
      if (sparqlResult || expertError) {
        queryStatusElement.textContent =
          "Query changed. Press Run query to update results.";
      } else if (!sparqlInput.value.trim()) {
        queryStatusElement.textContent = "";
      }
    });
  }

  if (runButton) runButton.addEventListener("click", () => runExpert());
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      if (!sparqlInput) return;
      cancelExpert();
      sparqlInput.value = "";
      sparqlResult = null;
      expertError = null;
      items = [];
      total = 0;
      page = 0;
      if (queryStatusElement) queryStatusElement.textContent = "";
      render();
      sparqlInput.focus();
    });
  }

  for (const button of templateButtons || []) {
    button.addEventListener("click", () => {
      const name = button.dataset.catalogueTemplate;
      const text = queryTemplates()[name];
      if (!text || !sparqlInput) return;
      cancelExpert();
      sparqlInput.value = text;
      sparqlResult = null;
      expertError = null;
      items = [];
      total = 0;
      page = 0;
      if (queryStatusElement) {
        queryStatusElement.textContent =
          "Template loaded. Press Run query to execute.";
      }
      render();
      sparqlInput.focus();
    });
  }

  if (resetButton) resetButton.addEventListener("click", resetFilters);
  if (exportButton) exportButton.addEventListener("click", exportRows);
  if (agentClearButton) {
    agentClearButton.addEventListener("click", () => {
      agentFilter = null;
      syncAgentChip();
      page = 0;
      refresh();
    });
  }
  if (prevButton) {
    prevButton.addEventListener("click", () => {
      if (page <= 0) return;
      page -= 1;
      if (mode === "sparql") render();
      else refresh();
    });
  }
  if (nextButton) {
    nextButton.addEventListener("click", () => {
      const pages = Math.max(1, Math.ceil(total / pageSize()));
      if (page + 1 >= pages) return;
      page += 1;
      if (mode === "sparql") render();
      else refresh();
    });
  }

  return {
    load,
    invalidate() {
      facets = null;
      facetsKey = "";
      facetsError = null;
      page = 0;
      total = 0;
      items = [];
      sparqlResult = null;
      expertError = null;
      currentSelection = null;
      pendingReload = true;
      clearFilterControls();
      if (activeController) activeController.abort();
      if (tableElement) tableElement.replaceChildren();
    },
    resume() {
      if (!pendingReload) return;
      pendingReload = false;
      if (mode === "sparql") {
        render();
      } else {
        refresh();
      }
    },
    select,
    // Load a ready-made query (from the ontology view) into the SPARQL box.
    // It is not run: the reader sees it first and presses Run query.
    openQuery(text) {
      // A query still running must not land its rows under the new text.
      cancelExpert();
      page = 0;
      if (mode !== "sparql") setMode("sparql", { run: false });
      if (sparqlInput) {
        sparqlInput.value = text;
        refreshHighlight();
      }
      sparqlResult = null;
      expertError = null;
      items = [];
      total = 0;
      if (queryStatusElement) queryStatusElement.textContent = "Press Run query to execute.";
      render();
    },
    filterByAgent(agent, name) {
      agentFilter = agent
        ? { id: agent, name: name || localName(agent) || agent }
        : null;
      if (mode !== "faceted") {
        setMode("faceted", { run: false });
      }
      syncAgentChip();
      page = 0;
      if (isVisible()) refresh();
      else pendingReload = true;
    },
    resize() {},
    exportSvg() {
      return null;
    }
  };
}
