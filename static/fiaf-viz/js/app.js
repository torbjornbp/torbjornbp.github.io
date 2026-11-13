// Page shell: config, role filter, routing, shared data and drawer handlers.

import {
  datasetFilter,
  findAgentScopeFilter,
  getConfig,
  limit,
  loadConfig,
  onBusy,
  onQueryStatus,
  roleFilter,
  runQuery,
  sparqlAnyIri,
  sparqlIri,
  sparqlLiteral
} from "./sparql.js";
import { humanize, localName, roleLabel } from "./labels.js";
import { initTheme } from "./theme.js";
import { agentHistory, workAgentModel } from "./records.js";
import * as ui from "./ui.js";
import * as cloud from "./cloud.js";
import * as network from "./network.js";
import * as coCredits from "./co-credits.js";
import * as timeline from "./timeline.js";
import * as worldmap from "./worldmap.js";
import * as geography from "./geography.js";
import * as breakdowns from "./breakdowns.js";
import * as preservation from "./preservation.js";
import * as rolesView from "./roles.js";
import * as catalogue from "./catalogue.js";
import * as ontologyView from "./ontology.js";
import * as filmLength from "./film-length.js";
import { renderCareer } from "./career.js";
import { renderWorkGraph } from "./work-graph.js";

const PALETTE = ui.ROLE_PALETTE;
const OTHER_COLOUR = "var(--role-other)";
const AGENT_VIEWS = new Set(["cloud", "network", "co-credits", "roles"]);
const SEARCH_VIEWS = new Set(["cloud", "network", "co-credits", "roles"]);
const SELECTION_VIEWS = {
  work: new Set(["catalogue", ...AGENT_VIEWS]),
  agent: new Set(AGENT_VIEWS),
  entity: new Set(["catalogue"])
};
const AGENT_TABS = new Set(["works", "co-credits", "overview"]);
const VIEW_LABELS = {
  cloud: "Name cloud",
  network: "Names & works",
  "co-credits": "Co-credits",
  roles: "Roles"
};

const state = {
  scopeIds: [],
  scopes: [],
  roles: [],
  selectedRoles: new Set(),
  topLimit: 2000,
  minWorks: 0,
  search: "",
  colour: new Map()
};

function config() {
  try {
    return getConfig();
  } catch (_) {
    return {};
  }
}

function availableViews() {
  const views = config().views;
  return Array.isArray(views) ? new Set(views) : null;
}

function defaultView() {
  return config().defaultView || "timeline";
}

function scopeOptions() {
  return state.scopes;
}

function selectedScopes() {
  return state.scopes.filter((scope) => state.scopeIds.includes(scope.id));
}

function scopeKeyFor(ids) {
  const unique = [...new Set(ids)].sort();
  return unique.length ? unique.join("|") : "all";
}

function scopeKey() {
  return scopeKeyFor(state.scopeIds);
}

function normalizeScopeIds(ids) {
  const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
  const available = new Set(state.scopes.map((scope) => scope.id));
  return [...new Set(list)].filter((id) => available.has(id));
}

function scopeSummary() {
  const selected = selectedScopes();
  if (!selected.length) return "All works";
  if (selected.length === 1) return selected[0].label;
  return `${selected.length} of ${state.scopes.length} selected`;
}

function scopePhrase() {
  const selected = selectedScopes();
  if (!selected.length) return "";
  if (selected.length === 1) return ` in ${selected[0].label}`;
  return " in the selected datasets";
}

function scopeLabel(count) {
  const selected = selectedScopes();
  const label = !selected.length
    ? "works in the catalogue"
    : selected.length === 1
      ? `works in ${selected[0].label}`
      : `works in ${selected.length} datasets`;
  return count === 1 ? label.replace(/^works\b/, "work") : label;
}

let agentCache = null;
let cloudAgentCache = null;
let activeView = null;
let views = null;
let drawerToken = 0;
let drawerController = null;
let workDrawerState = null;
let agentTabs = null;
let selection = null;
let holdingsSelection = null;
let holdingsInspectorToken = 0;
let scopeToken = 0;
let scopeTimer = null;
const roleCache = new Map();
const agentRequests = new Map();
// Top-N name slices for views that read only their first N names (see
// ctx.agentData), keyed by N. Cleared whenever the shared slice is.
const agentTopSlices = new Map();
const agentTotals = new Map();
const agentWorksCache = new Map();
const workAgentsCache = new Map();
const workMetadataCache = new Map();
const workHoldingsCache = new Map();
const workRelationsCache = new Map();
const workVariantsCache = new Map();
const agentCoCreditCache = new Map();
const entityRecordCache = new Map();
const entityPropertiesCache = new Map();
const loaded = new Set();
const stale = new Set();
const loadTimers = new Map();
const loadControllers = new Map();
const loadTokens = new Map();

const CHART_ROOT = {
  cloud: "cloud-chart",
  network: "network-chart",
  "co-credits": "co-credits-chart",
  timeline: "timeline-chart",
  worldmap: "worldmap-chart",
  catalogue: "catalogue-table",
  geography: "geography-chart",
  breakdowns: "breakdown-chart",
  preservation: "preservation-chart",
  roles: "roles-chart",
  ontology: "ontology-chart",
  length: "length-chart"
};

// -- shared context ---------------------------------------------------------

const ctx = {
  state,

  scopeFilter() {
    return datasetFilter(state.scopeIds);
  },

  scopeAgentFilter() {
    return findAgentScopeFilter(state.scopeIds);
  },

  roleFilter() {
    if (!state.roles.length) return "";
    if (state.selectedRoles.size === state.roles.length) return "";
    return roleFilter([...state.selectedRoles].sort());
  },

  async roles() {
    return state.roles;
  },

  async filteredRoles() {
    return state.roles.filter((role) => state.selectedRoles.has(role.iri));
  },

  topRoles() {
    return state.roles.slice().sort((a, b) => b.activities - a.activities).slice(0, PALETTE.length);
  },

  colorFor(role) {
    return (role && state.colour.get(role)) || OTHER_COLOUR;
  },

  dominantRole(agent, roleMap) {
    const map =
      roleMap ||
      (agentCache && agentCache.roleMap) ||
      (cloudAgentCache && cloudAgentCache.roleMap);
    if (!map) return null;
    const list = map.get(agent);
    return list && list.length ? list[0].role : null;
  },

  // `cap` is for a view that only reads the first `cap` rows (after the
  // minimum-works filter). Rows are ordered by work count, so those rows are a
  // prefix of the shared slice and the view can fetch just its top `cap`
  // instead of waiting for, say, 50,000 names to arrive. A shared slice that is
  // already loaded or in flight is reused rather than queried again.
  // Whether agentData(cloud) would resolve from memory without a query.
  agentDataReady(cloud = false) {
    const useCloudAll = cloud && state.topLimit === null;
    const key = `${agentKey()}|${useCloudAll ? "cloud-all" : "shared"}`;
    const cache = useCloudAll ? cloudAgentCache : agentCache;
    return Boolean(cache && cache.key === key);
  },

  //
  // `top` is for a view with its own name count, independent of the Names
  // setting: it always gets (at least) the top `top` names.
  agentData(cloud = false, { cap = 0, top = 0 } = {}) {
    // The cloud gets a higher "All" ceiling because it is the only view that
    // draws every loaded name. The other name views keep their smaller shared
    // slice, and their own render caps, so selecting "All" in the cloud does
    // not force the network or role views to load the whole catalogue.
    const useCloudAll = cloud && state.topLimit === null;
    const baseKey = agentKey();
    const sharedKey = `${baseKey}|${useCloudAll ? "cloud-all" : "shared"}`;
    const all = state.topLimit === null;
    const allLimit = useCloudAll
      ? cloudAllLimit()
      : limit("allAgents", 20000) || 20000;
    const sharedLimit = all ? allLimit : state.topLimit;
    // A shared slice shorter than `top` cannot serve that view.
    const sharedServes = !top || sharedLimit >= top;
    const cache = useCloudAll ? cloudAgentCache : agentCache;
    if (sharedServes && cache && cache.key === sharedKey) return Promise.resolve(cache);
    if (sharedServes && agentRequests.has(sharedKey)) return agentRequests.get(sharedKey);

    const filter = ctx.roleFilter();
    const scopePattern = ctx.scopeFilter();
    const size = top || cap;
    const capped = top > 0 || (cap > 0 && cap < sharedLimit);
    // Top slices depend on scope and roles only, not on the Names setting.
    const sliceKey = `${scopeKey()}|${roleKey()}`;
    if (capped) {
      // Any top slice at least this long serves the view.
      for (const [length, entry] of agentTopSlices) {
        if (entry.sliceKey === sliceKey && length >= size) return entry.promise;
      }
    }
    const key = capped ? `${sliceKey}|top-${size}` : sharedKey;
    const request = (async () => {
      const [rows, totals] = await Promise.all([
        runQuery("agents", {
          SCOPE_FILTER: scopePattern,
          ROLE_FILTER: filter,
          LIMIT: capped ? size : Number.isFinite(sharedLimit) ? sharedLimit : EVERY_ROW
        }),
        agentTotal(filter, scopePattern)
      ]);
      const roleMap = new Map();
      for (const row of rows) {
        roleMap.set(row.agent, parseRoleCounts(row.roleCounts));
      }
      const result = {
        key,
        rows: rows.map((row) => ({ ...row, works: Number(row.works) || 0 })),
        roleMap,
        total: totals ? totals.agents : rows.length,
        works: totals ? totals.works : null,
        credits: totals ? totals.credits : null
      };
      // A slower, superseded filter must never replace the current cache.
      if (agentKey() === baseKey && !capped) {
        if (useCloudAll) cloudAgentCache = result;
        else agentCache = result;
      }
      return result;
    })();
    if (capped) {
      // Kept until the filters change; a failed request is dropped so a retry
      // queries again.
      agentTopSlices.set(size, { sliceKey, promise: request });
      request.catch(() => {
        if (agentTopSlices.get(size)?.promise === request) agentTopSlices.delete(size);
      });
      return request;
    }
    agentRequests.set(key, request);
    const forget = () => {
      if (agentRequests.get(key) === request) agentRequests.delete(key);
    };
    request.then(forget, forget);
    return request;
  },

  agentCoCredits(agent) {
    const key = `${scopeKey()}|${agent}`;
    if (agentCoCreditCache.has(key)) return agentCoCreditCache.get(key);
    const request = runQuery("agent-co-credits", {
      AGENT: sparqlIri(agent),
      SCOPE_FILTER: ctx.scopeFilter(),
      LIMIT: limit("coCreditAgents", 200)
    }).then((rows) =>
      rows.map((row) => ({
        agent: row.agent,
        name: row.name || row.agent,
        shared: Number(row.shared) || 1
      }))
    );
    agentCoCreditCache.set(key, request);
    request.catch(() => {
      if (agentCoCreditCache.get(key) === request) agentCoCreditCache.delete(key);
    });
    return request;
  },

  openAgent,
  openWork,
  openEntity,
  onlyRole,
  selectionStatus,
  refreshSelectionStatus: updateDrawerContext,
  refreshDrawerOutside,
  // Put a query in the catalogue's SPARQL box and switch to the catalogue.
  openCatalogueQuery(text) {
    if (!views || !views.catalogue || !views.catalogue.openQuery) return;
    views.catalogue.openQuery(text);
    location.hash = "#catalogue";
  },
  // Refetch one view, for a control that lives inside that view.
  reload(name) {
    stale.add(name);
    if (activeView === name) scheduleLoad(name);
  }
};

function selectionSupportedByView(name, selected = selection) {
  if (!selected) return false;
  return Boolean(SELECTION_VIEWS[selected.kind]?.has(name));
}

function agentTabForView(name) {
  return name === "co-credits" ? "co-credits" : "works";
}

function selectedScopeNames() {
  return selectedScopes().map((scope) => scope.label).join(", ");
}

function outsideSliceMessage(name, workCount) {
  const workText = `${ui.formatNumber(workCount)} ${workCount === 1 ? "work" : "works"}`;
  if (name === "cloud") {
    const limitText =
      state.topLimit === null
        ? "the All cap"
        : `the ${ui.formatNumber(state.topLimit)}-name limit`;
    return (
      `${workText} in the current dataset, but outside ${limitText} for Name cloud. ` +
      "Increase “Names loaded” or use Search to open it."
    );
  }
  if (name === "network") {
    const ceiling = nameCeiling("network");
    if (state.topLimit === null || state.topLimit >= ceiling) {
      return (
        `${workText} in the current dataset, but outside the ${ui.formatNumber(ceiling)} ` +
        "busiest names Names & works can draw. Use Search to open it."
      );
    }
    return (
      `${workText} in the current dataset, but outside the loaded Names & works slice. ` +
      "Increase “Names loaded” to include it."
    );
  }
  if (name === "co-credits") {
    return (
      "Not in the loaded co-credit graph at the current threshold. " +
      "Use “Isolate selected name” to inspect its relationships."
    );
  }
  return "Only the busiest names per role are drawn in Roles.";
}

function workOutsideSliceMessage(name, creditedNames) {
  const count = ui.formatNumber(creditedNames);
  if (name === "cloud") {
    return (
      `None of this work’s ${count} credited names is in the loaded Name cloud ` +
      "slice. Increase “Names loaded” to include them."
    );
  }
  if (name === "network") {
    return (
      `None of this work’s ${count} credited names is in the loaded Names & works ` +
      "slice. Increase “Names loaded” to include them."
    );
  }
  if (name === "co-credits") {
    return (
      "None of this work’s credited names is in the loaded co-credit graph at " +
      "this threshold."
    );
  }
  return "None of this work’s credited names is among the top names drawn per role.";
}

function selectionStatus() {
  if (!selection || !views || !activeView) return null;
  if (!loaded.has(activeView)) {
    if (AGENT_VIEWS.has(activeView)) {
      return {
        shown: false,
        tone: "note",
        text: "Waiting for this view to finish loading…"
      };
    }
    return null;
  }
  const view = views[activeView];

  if (selection.kind === "agent") {
    if (activeView === "catalogue") {
      return {
        shown: false,
        tone: "note",
        text:
          "Catalogue does not highlight names. Open Works and use " +
          "“Show works in catalogue” to pivot the table."
      };
    }
    if (!AGENT_VIEWS.has(activeView)) return null;
    if (selection.pending || !Array.isArray(selection.workIds)) return null;

    const workCount = selection.workCount;
    if (!workCount) {
      const scope = selectedScopeNames();
      return {
        shown: false,
        tone: "warning",
        text: scope
          ? `Not in the selected dataset · No credited works for this name were found in ${scope}.`
          : "No credited works · This name has no credited works in the current data.",
        short: "selected name is not in this dataset"
      };
    }
    if (state.minWorks > 0 && workCount < state.minWorks) {
      return {
        shown: false,
        tone: "warning",
        text:
          `Filtered out by Min. works · This name has ${ui.formatNumber(workCount)} ` +
          `${workCount === 1 ? "work" : "works"} here, but the filter requires ` +
          `${ui.formatNumber(state.minWorks)}+.`,
        short: "selected name is filtered out by Min. works"
      };
    }
    const roleIris = selection.roles || [];
    const roleNames = roleIris.map(roleLabel);
    if (
      state.roles.length &&
      state.selectedRoles.size < state.roles.length &&
      roleIris.length &&
      roleIris.every((role) => !state.selectedRoles.has(role))
    ) {
      return {
        shown: false,
        tone: "warning",
        text:
          `Filtered out by Roles · None of this name’s roles ` +
          `(${roleNames.join(", ")}) is currently selected.`,
        short: "selected name is filtered out by Roles"
      };
    }
    if (!view.hasNode(selection.id)) {
      return {
        shown: false,
        tone: "warning",
        text:
          `Outside the loaded view · ${outsideSliceMessage(activeView, workCount)}`,
        short:
          activeView === "co-credits"
            ? "selected name is outside the co-credit slice"
            : activeView === "roles"
              ? "selected name is outside the roles ring"
              : "selected name is outside the loaded slice"
      };
    }
    return {
      shown: true,
      tone: "note",
      text: `Shown in ${VIEW_LABELS[activeView] || "this view"}.`
    };
  }

  if (selection.kind === "work") {
    if (!AGENT_VIEWS.has(activeView)) return null;
    if (selection.pending || !Array.isArray(selection.agentIds)) return null;
    if (selection.creditsLimited) {
      return {
        shown: false,
        tone: "warning",
        text: "The credit row limit was reached. The name list, roles and chart highlighting may be incomplete.",
        short: "selected work credits may be incomplete"
      };
    }
    if (!selection.agentIds.length) {
      return {
        shown: false,
        tone: "warning",
        text: "No credited names are recorded for this work in the current data.",
        short: "selected work has no credited names in this view"
      };
    }
    const visible = selection.agentIds.filter((id) => view.hasNode(id)).length;
    if (!visible) {
      return {
        shown: false,
        tone: "warning",
        text:
          "Outside the loaded view · " +
          workOutsideSliceMessage(activeView, selection.agentIds.length),
        short: "selected work has no credited names in this view"
      };
    }
    return {
      shown: true,
      tone: "note",
      text: `Shown in ${VIEW_LABELS[activeView] || "this view"}.`
    };
  }

  return null;
}

function updateDrawerContext() {
  const status = selectionStatus();
  if (!status || status.shown) ui.setDrawerContext("");
  else ui.setDrawerContext(status.text, status.tone);
  if (
    agentTabs &&
    selection &&
    selection.kind === "agent" &&
    agentTabs.active() === "overview"
  ) {
    agentTabs.refresh();
  }
}

function roleKey() {
  return [...state.selectedRoles].sort().join(",");
}

// The name cloud's "All" ceiling. 0 (or unset) loads every credited name.
function cloudAllLimit() {
  const value = limit("cloudAllAgents", 0);
  return value > 0 ? value : Infinity;
}

// LIMIT for a query that should return every row.
const EVERY_ROW = 100000000;

function agentKey() {
  return `${scopeKey()}|${state.topLimit === null ? "all" : state.topLimit}|${roleKey()}`;
}

// Totals depend on scope and roles, not on the row limit. Cache the in-flight
// promise as well so the cloud and both networks never repeat the same count.
function agentTotal(filter, scopePattern) {
  const key = `${scopeKey()}|${roleKey()}`;
  if (agentTotals.has(key)) return agentTotals.get(key);
  const request = runQuery("agents-total", {
    SCOPE_FILTER: scopePattern,
    ROLE_FILTER: filter
  }).then((rows) => {
    const row = rows[0] || {};
    return {
      agents: Number(row.agents) || 0,
      works: Number(row.works) || 0,
      credits: Number(row.credits) || 0
    };
  });
  agentTotals.set(key, request);
  request.catch(() => {
    if (agentTotals.get(key) === request) agentTotals.delete(key);
  });
  return request;
}

function applySelection() {
  if (!views) return;
  const view = activeView && views[activeView];
  if (view && view.select) view.select(selection);
  syncWorkNav();
  updateDrawerContext();
}

function syncWorkNav() {
  if (!selection || selection.kind !== "work" || !selection.nav) {
    ui.setDrawerNav(null);
    return;
  }
  const nav = selection.nav;
  ui.setDrawerNav({
    position: `${nav.index + 1} of ${nav.items.length}`,
    hasPrev: nav.index > 0,
    hasNext: nav.index < nav.items.length - 1,
    onPrev: () => stepWork(-1),
    onNext: () => stepWork(1)
  });
}

function stepWork(delta) {
  if (!selection || selection.kind !== "work" || !selection.nav) return;
  const nav = selection.nav;
  const index = nav.index + delta;
  if (index < 0 || index >= nav.items.length) return;
  const item = nav.items[index];
  openWork(item.work, item.title || localName(item.work) || item.work, {
    tab: selection.tab || "holdings",
    nav: { items: nav.items, index }
  });
}

function clearSelection() {
  drawerToken += 1;
  if (drawerController) drawerController.abort();
  drawerController = null;
  if (workDrawerState) {
    workDrawerState.controller.abort();
    workDrawerState = null;
  }
  selection = null;
  holdingsSelection = null;
  holdingsInspectorToken += 1;
  lastDrawerList = null;
  agentTabs = null;
  applySelection();
}

// `fiaf:` is kept for older view modules; `fiaf-viz:` is the current event.
document.addEventListener("fiaf-viz:drawer-close", clearSelection);
document.addEventListener("fiaf:drawer-close", clearSelection);

const ROLE_NS = "https://dev.fiafcore.org/";

// The sidebar stays focused on the catalogue's core records: works, their
// holdings, and credited names. Other IRIs (formats, countries, concepts) are
// shown as plain values instead of opening a generic record drawer.
const SIDEBAR_ENTITY_TYPES = new Set([
  `${ROLE_NS}Work`,
  `${ROLE_NS}MonographicWork`,
  `${ROLE_NS}Manifestation`,
  `${ROLE_NS}Item`,
  `${ROLE_NS}Carrier`,
  `${ROLE_NS}Agent`,
  `${ROLE_NS}Person`,
  `${ROLE_NS}Organisation`
]);

function isSidebarEntityType(type) {
  return Boolean(type && SIDEBAR_ENTITY_TYPES.has(type));
}

// "Director 12|Writer 3" -> [{ role: ".../Director", works: 12 }, ...]
//
// fiaf:Activity is the generic superclass of every credit activity, not a
// meaningful role (roles.rq excludes it), so it is dropped here. The credits
// still count towards the agent's works total from agents.rq.
function parseRoleCounts(value) {
  if (!value) return [];
  const entries = [];
  for (const part of String(value).split("|")) {
    const cut = part.lastIndexOf(" ");
    if (cut <= 0) continue;
    const local = part.slice(0, cut);
    if (local === "Activity") continue;
    entries.push({
      role: `${ROLE_NS}${local}`,
      works: Number(part.slice(cut + 1)) || 0
    });
  }
  return entries.sort((a, b) => b.works - a.works);
}

// -- roles and filters ------------------------------------------------------

function loadRolesForScope(key, scopePattern) {
  if (roleCache.has(key)) return roleCache.get(key);
  const request = runQuery("roles", { SCOPE_FILTER: scopePattern }).then((rows) =>
    rows.map((row) => ({
      iri: row.role,
      activities: Number(row.activities) || 0,
      works: Number(row.works) || 0
    }))
  );
  roleCache.set(key, request);
  request.catch(() => {
    if (roleCache.get(key) === request) roleCache.delete(key);
  });
  return request;
}

async function refreshRolesForScope(selectAll) {
  const token = ++scopeToken;
  const roles = await loadRolesForScope(scopeKey(), ctx.scopeFilter());
  if (token !== scopeToken) return false;
  const available = new Set(roles.map((role) => role.iri));
  state.roles = roles;
  if (selectAll) {
    state.selectedRoles = available;
  } else {
    state.selectedRoles = new Set(
      [...state.selectedRoles].filter((iri) => available.has(iri))
    );
  }
  buildColours();
  buildRoleList();
  return true;
}

function syncScopeChecks() {
  for (const input of document.querySelectorAll("#scope-list input[type=checkbox]")) {
    input.checked = state.scopeIds.includes(input.value);
  }
  const summary = document.getElementById("scope-summary");
  if (summary) summary.textContent = scopeSummary();
}

function checkedScopeIds() {
  return [...document.querySelectorAll("#scope-list input[type=checkbox]:checked")]
    .map((input) => input.value);
}

// Checking several datasets in a row should feel like one change, not one
// role query and view reload per click.
function queueScopeChange() {
  clearTimeout(scopeTimer);
  scopeTimer = setTimeout(() => applyScope(checkedScopeIds()), 150);
}

function renderScopeOptions() {
  const list = document.getElementById("scope-list");
  if (!list) return;
  list.replaceChildren();
  for (const option of scopeOptions()) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = option.id;
    input.checked = state.scopeIds.includes(option.id);
    input.addEventListener("change", queueScopeChange);
    const text = document.createElement("span");
    text.textContent = option.label;
    const count = document.createElement("span");
    count.className = "role-count";
    count.textContent = ui.formatNumber(option.works);
    label.append(input, text, count);
    list.append(label);
  }
  syncScopeChecks();
}

// Datasets are discovered from identifier authorities on works, so a new
// dataset appears without a config or code change. An empty selection means
// "All works", including works that have no dataset authority.
async function loadScopes() {
  const rows = await runQuery("scopes");
  state.scopes = rows
    .map((row) => ({
      id: row.scope,
      label: row.label || row.scope,
      works: Number(row.works) || 0
    }))
    .filter((option) => option.id);
  const available = new Set(state.scopes.map((scope) => scope.id));
  state.scopeIds = state.scopeIds.filter((id) => available.has(id));
  renderScopeOptions();
}

async function applyScope(scopeIds, forceAllRoles = false) {
  clearTimeout(scopeTimer);
  const next = normalizeScopeIds(scopeIds);
  const key = scopeKeyFor(next);
  const previous = [...state.scopeIds];
  const selectAll =
    forceAllRoles ||
    !state.roles.length ||
    state.selectedRoles.size === state.roles.length;
  state.scopeIds = next;
  syncScopeChecks();
  hideSearchResults();

  const rolesRequest = refreshRolesForScope(selectAll);
  if (activeView && AGENT_VIEWS.has(activeView)) {
    // Name-based views need the new role list before they reload, otherwise
    // they would paint once with the old roles and immediately reload.
    let updated;
    try {
      updated = await rolesRequest;
    } catch (error) {
      // A newer dataset selection has already taken over.
      if (scopeKey() !== key) return;
      state.scopeIds = previous;
      syncScopeChecks();
      ui.setStatus(`Could not change dataset: ${error.message}`, "error");
      return;
    }
    if (!updated || scopeKey() !== key) return;
    invalidateAllViews(true);
  } else {
    // Dataset-wide views do not use the role filter. Reload them immediately
    // and let the role list catch up in the background.
    invalidateAllViews(true);
    rolesRequest
      .then((updated) => {
        if (
          updated &&
          scopeKey() === key &&
          activeView &&
          AGENT_VIEWS.has(activeView)
        ) {
          invalidateAgentViews(true);
        }
      })
      .catch((error) => {
        if (scopeKey() !== key) return;
        ui.setStatus(`Could not refresh role filters: ${error.message}`, "error");
      });
  }

  if (selection && selection.kind === "agent") {
    refreshAgentDrawer();
  }
}

function buildColours() {
  state.colour = new Map(
    ctx.topRoles().map((role, index) => [role.iri, PALETTE[index % PALETTE.length]])
  );
}

function buildRoleList() {
  const list = document.getElementById("role-list");
  if (!list) return;
  list.replaceChildren();
  for (const role of state.roles) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = role.iri;
    input.checked = state.selectedRoles.has(role.iri);
    input.addEventListener("change", () => {
      if (input.checked) state.selectedRoles.add(role.iri);
      else state.selectedRoles.delete(role.iri);
      updateRoleSummary();
      invalidateAgentViews(true);
    });
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = ctx.colorFor(role.iri);
    const text = document.createElement("span");
    text.textContent = roleLabel(role.iri);
    const count = document.createElement("span");
    count.className = "role-count";
    count.textContent = ui.formatNumber(role.activities);
    label.append(input, swatch, text, count);
    list.append(label);
  }
  updateRoleSummary();
}

function syncRoleChecks() {
  for (const input of document.querySelectorAll("#role-list input[type=checkbox]")) {
    input.checked = state.selectedRoles.has(input.value);
  }
}

function updateRoleSummary() {
  const summary = document.getElementById("role-summary");
  if (!summary) return;
  const total = state.roles.length;
  const selected = state.selectedRoles.size;
  summary.textContent =
    selected === total ? "all" : selected === 0 ? "none" : `${selected} of ${total}`;
}

function invalidateAgentViews(refetch) {
  if (refetch) {
    agentCache = null;
    cloudAgentCache = null;
    agentTopSlices.clear();
  }
  for (const name of AGENT_VIEWS) stale.add(name);
  if (activeView && AGENT_VIEWS.has(activeView)) scheduleLoad(activeView);
}

// A dataset change affects every view, not just the name-based ones. Views with
// their own result caches clear them; the loaded/stale flags force a refetch
// when the user next opens a tab.
function invalidateAllViews(refetch) {
  if (refetch) {
    agentCache = null;
    cloudAgentCache = null;
    agentTopSlices.clear();
  }
  for (const name of Object.keys(views || {})) {
    stale.add(name);
    if (views[name] && views[name].invalidate) views[name].invalidate();
  }
  if (activeView) scheduleLoad(activeView);
}

function scheduleLoad(name) {
  clearTimeout(loadTimers.get(name));
  loadTimers.set(
    name,
    setTimeout(() => {
      if (activeView === name) loadView(name);
    }, 120)
  );
}

function wireFilters() {
  const scopesAll = document.getElementById("scopes-all");
  if (scopesAll) {
    scopesAll.addEventListener("click", () => {
      const next = scopeOptions().map((scope) => scope.id);
      if (
        scopeKeyFor(next) === scopeKey() &&
        checkedScopeIds().length === next.length
      ) {
        return;
      }
      applyScope(next);
    });
  }
  const scopesClear = document.getElementById("scopes-clear");
  if (scopesClear) {
    scopesClear.addEventListener("click", () => {
      if (!state.scopeIds.length && !checkedScopeIds().length) return;
      applyScope([]);
    });
  }
  document.getElementById("roles-all").addEventListener("click", () => {
    state.selectedRoles = new Set(state.roles.map((role) => role.iri));
    syncRoleChecks();
    updateRoleSummary();
    invalidateAgentViews(true);
  });
  document.getElementById("roles-none").addEventListener("click", () => {
    state.selectedRoles = new Set();
    syncRoleChecks();
    updateRoleSummary();
    invalidateAgentViews(true);
  });
  document.getElementById("top-limit").addEventListener("change", (event) => {
    const value = event.target.value;
    state.topLimit = value === "all" ? null : Number(value) || limit("cloudAgents", 5000);
    invalidateAgentViews(true);
  });
  document.getElementById("min-works").addEventListener("change", (event) => {
    state.minWorks = Number(event.target.value) || 0;
    invalidateAgentViews(false);
  });
  document.getElementById("reset-filters").addEventListener("click", () => {
    const defaultLimit = limit("cloudAgents", 5000);
    state.topLimit = defaultLimit > 0 ? defaultLimit : null;
    state.minWorks = 0;
    resetSearch();
    syncNameOptions();
    document.getElementById("min-works").value = "0";
    const shared = document.getElementById("shared-threshold");
    if (shared) {
      shared.value = String(limit("coCreditMinShared", 2));
      shared.dispatchEvent(new Event("input"));
    }
    for (const name of ["network", "co-credits"]) {
      if (views && views[name] && views[name].resetLinks) {
        views[name].resetLinks();
      }
    }
    if (views && views.geography && views.geography.resetMode) {
      views.geography.resetMode();
    }
    applyScope([], true);
  });
}

// -- find a name or work ----------------------------------------------------

let searchTimer = null;
let searchToken = 0;
let searchController = null;

function hideSearchResults() {
  searchToken += 1;
  if (searchController) searchController.abort();
  searchController = null;
  const results = document.getElementById("search-results");
  const input = document.getElementById("search");
  if (results) {
    results.hidden = true;
    results.replaceChildren();
  }
  if (input) input.setAttribute("aria-expanded", "false");
}

function resetSearch() {
  clearTimeout(searchTimer);
  const input = document.getElementById("search");
  if (input) input.value = "";
  state.search = "";
  if (views && views.cloud) views.cloud.search("");
  hideSearchResults();
}

function wireSearch() {
  const input = document.getElementById("search");
  const results = document.getElementById("search-results");
  if (!input || !results) return;

  input.addEventListener("input", () => {
    state.search = input.value;
    if (views && views.cloud) views.cloud.search(state.search);
    clearTimeout(searchTimer);
    const token = ++searchToken;
    if (searchController) searchController.abort();
    searchController = null;
    const needle = input.value.trim();
    if (needle.length < 2) {
      hideSearchResults();
      return;
    }
    searchTimer = setTimeout(() => findEntities(needle, token), 300);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      const first = results.querySelector("button.search-result");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === "Escape") {
      hideSearchResults();
    }
  });

  results.addEventListener("keydown", (event) => {
    const buttons = [...results.querySelectorAll("button.search-result")];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown" && index >= 0 && index < buttons.length - 1) {
      event.preventDefault();
      buttons[index + 1].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index > 0) buttons[index - 1].focus();
      else input.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideSearchResults();
      input.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!(event.target.closest && event.target.closest(".filter-search"))) {
      hideSearchResults();
    }
  });
}

async function findEntities(needle, token) {
  const results = document.getElementById("search-results");
  if (!results) return;
  const controller = new AbortController();
  searchController = controller;
  try {
    const rows = await runQuery("find", {
      TERM: sparqlLiteral(needle),
      SCOPE_FILTER: ctx.scopeFilter(),
      SCOPE_AGENT_FILTER: ctx.scopeAgentFilter(),
      LIMIT: limit("findRows", 20)
    }, { signal: controller.signal });
    if (token !== searchToken) return;
    renderSearchResults(rows, needle);
  } catch (error) {
    if (token !== searchToken || error.name === "AbortError") return;
    results.hidden = false;
    results.replaceChildren(ui.node("div", "search-empty", error.message));
    const input = document.getElementById("search");
    if (input) input.setAttribute("aria-expanded", "true");
  } finally {
    if (searchController === controller) searchController = null;
  }
}

function renderSearchResults(rows, needle) {
  const results = document.getElementById("search-results");
  const input = document.getElementById("search");
  if (!results) return;
  results.replaceChildren();
  if (!rows.length) {
    results.append(
      ui.node(
        "div",
        "search-empty",
        `No name or work matches “${needle}”${scopePhrase()}.`
      )
    );
  } else {
    for (const row of rows) {
      const button = ui.node("button", "search-result");
      button.type = "button";
      button.setAttribute("role", "option");
      button.append(
        ui.node(
          "span",
          `search-result-type ${row.type === "work" ? "work" : "agent"}`,
          row.type === "work" ? "Work" : "Name"
        )
      );
      button.append(
        ui.node("span", "search-result-label", row.label || row.id)
      );
      button.addEventListener("click", () => {
        const label = row.label || row.id;
        resetSearch();
        if (row.type === "work") ctx.openWork(row.id, label);
        else ctx.openAgent(row.id, label);
      });
      results.append(button);
    }
  }
  results.hidden = false;
  if (input) input.setAttribute("aria-expanded", "true");
}

// -- views ------------------------------------------------------------------

function createViews() {
  views = {
    cloud: cloud.create(
      ctx,
      document.getElementById("cloud-chart"),
      document.getElementById("cloud-legend"),
      document.getElementById("cloud-stats")
    ),
    network: network.create(
      ctx,
      document.getElementById("network-chart"),
      document.getElementById("network-stats"),
      document.querySelectorAll("#network-links [data-link-scope]")
    ),
    "co-credits": coCredits.create(
      ctx,
      document.getElementById("co-credits-chart"),
      document.getElementById("co-credits-stats"),
      document.getElementById("shared-threshold"),
      document.querySelectorAll("#co-credits-links [data-link-scope]")
    ),
    timeline: timeline.create(
      ctx,
      document.getElementById("timeline-chart"),
      document.getElementById("timeline-stats"),
      document.querySelectorAll("[data-granularity]"),
      document.getElementById("timeline-description")
    ),
    catalogue: catalogue.create(ctx, {
      titleInput: document.getElementById("catalogue-title"),
      identifierInput: document.getElementById("catalogue-identifier"),
      nameInput: document.getElementById("catalogue-name"),
      countrySelect: document.getElementById("catalogue-country"),
      decadeSelect: document.getElementById("catalogue-decade"),
      formSelect: document.getElementById("catalogue-form"),
      genreSelect: document.getElementById("catalogue-genre"),
      formatSelect: document.getElementById("catalogue-format"),
      institutionSelect: document.getElementById("catalogue-institution"),
      sortSelect: document.getElementById("catalogue-sort"),
      resetButton: document.getElementById("catalogue-reset"),
      exportButton: document.getElementById("catalogue-export"),
      agentFilterElement: document.getElementById("catalogue-agent-filter"),
      agentNameElement: document.getElementById("catalogue-agent-name"),
      agentClearButton: document.getElementById("catalogue-agent-clear"),
      filterPanel: document.getElementById("catalogue-filters"),
      modeButtons: document.querySelectorAll(
        "#catalogue-mode [data-catalogue-mode]"
      ),
      sparqlPanel: document.getElementById("catalogue-sparql-panel"),
      sparqlInput: document.getElementById("catalogue-sparql"),
      runButton: document.getElementById("catalogue-run"),
      clearButton: document.getElementById("catalogue-clear"),
      templateButtons: document.querySelectorAll("[data-catalogue-template]"),
      queryStatusElement: document.getElementById("catalogue-query-status"),
      statsElement: document.getElementById("catalogue-stats"),
      tableElement: document.getElementById("catalogue-table"),
      prevButton: document.getElementById("catalogue-prev"),
      nextButton: document.getElementById("catalogue-next"),
      pageElement: document.getElementById("catalogue-page")
    }),
    worldmap: worldmap.create(
      ctx,
      document.getElementById("worldmap-chart"),
      document.getElementById("worldmap-stats"),
      document.getElementById("worldmap-overview")
    ),
    geography: geography.create(
      ctx,
      document.getElementById("geography-chart"),
      document.getElementById("geography-stats"),
      document.getElementById("heatmap-kind"),
      document.getElementById("geography-description"),
      document.getElementById("heatmap-limit"),
      document.querySelectorAll("#heatmap-mode [data-heatmap-mode]")
    ),
    breakdowns: breakdowns.create(ctx, document.getElementById("breakdown-chart")),
    preservation: preservation.create(
      ctx,
      document.getElementById("preservation-chart"),
      document.getElementById("preservation-stats"),
      document.getElementById("preservation-overview"),
      {
        groupButtons: document.querySelectorAll(
          "#preservation-group [data-preservation-group]"
        ),
        measureSelect: document.getElementById("preservation-measure"),
        withinSelect: document.getElementById("preservation-within"),
        withinNote: document.getElementById("preservation-within-note"),
        sortSelect: document.getElementById("preservation-sort"),
        limitSelect: document.getElementById("preservation-limit")
      }
    ),
    roles: rolesView.create(
      ctx,
      document.getElementById("roles-chart"),
      document.getElementById("roles-stats")
    ),
    length: filmLength.create(
      ctx,
      document.getElementById("length-chart"),
      document.getElementById("length-stats"),
      document.getElementById("length-headline"),
      document.getElementById("length-crumbs")
    ),
    ontology: ontologyView.create(
      ctx,
      document.getElementById("ontology-chart"),
      document.getElementById("ontology-stats"),
      document.getElementById("ontology-details")
    )
  };
}

function isViewAvailable(name) {
  const available = availableViews();
  return !available || available.has(name);
}

function route() {
  const name = (location.hash || "").replace(/^#/, "");
  return views && views[name] && isViewAvailable(name) ? name : defaultView();
}

function cancelLoad(name) {
  const controller = loadControllers.get(name);
  if (controller) controller.abort();
  loadControllers.delete(name);
  loadTokens.set(name, (loadTokens.get(name) || 0) + 1);
}

// Most names a view loads or draws, whatever "Names" is set to.
function nameCeiling(view) {
  if (view === "cloud") return cloudAllLimit();
  const shared = limit("allAgents", 20000) || 20000;
  if (view === "network") return Math.min(shared, limit("networkAgents", 0) || Infinity);
  return shared;
}

// The Names dropdown follows the active view: options above what the view can
// show are hidden, and the last option says what it really loads ("All" only
// where that is every name). The shared setting itself is not changed, so
// switching views keeps the user's choice.
function syncNameOptions() {
  const select = document.getElementById("top-limit");
  if (!select) return;
  const ceiling = nameCeiling(activeView);
  const options = [...select.options];
  const allOption = options.find((option) => option.value === "all");
  let largest = null;
  for (const option of options) {
    if (option === allOption) continue;
    const value = Number(option.value);
    // The "all" option stands for the ceiling, so an option at the ceiling
    // would repeat it.
    const hide = value > ceiling || (allOption && value >= ceiling);
    option.hidden = hide;
    option.disabled = hide;
    if (!hide && (largest === null || value > Number(largest.value))) largest = option;
  }
  if (allOption) {
    allOption.textContent = !Number.isFinite(ceiling)
      ? "All"
      : activeView === "network"
        ? `Max (${ui.formatNumber(ceiling)})`
        : `Top ${ui.formatNumber(ceiling)}`;
  }
  const atCeiling = state.topLimit === null || state.topLimit >= ceiling;
  if (!atCeiling) select.value = String(state.topLimit);
  else if (allOption) select.value = "all";
  else if (largest) select.value = largest.value;
}

function showView(name) {
  if (!views[name] || !isViewAvailable(name)) {
    name = defaultView();
    if (location.hash) history.replaceState(null, "", `#${name}`);
  }
  const previousView = activeView;
  if (previousView && previousView !== name) {
    cancelLoad(previousView);
    if (views[previousView].pause) views[previousView].pause();
  }
  for (const section of document.querySelectorAll(".view")) {
    section.hidden = section.dataset.view !== name;
  }
  for (const tab of document.querySelectorAll(".tabs a")) {
    const active = tab.dataset.view === name;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  const agentView = AGENT_VIEWS.has(name);
  for (const element of document.querySelectorAll('[data-filter="agents"]')) {
    element.hidden = !agentView;
  }
  // Co-credits sets its name count with its own control.
  for (const element of document.querySelectorAll("[data-names-filter]")) {
    element.hidden = !agentView || name === "co-credits";
  }
  for (const element of document.querySelectorAll('[data-filter="search"]')) {
    element.hidden = !SEARCH_VIEWS.has(name);
  }
  for (const element of document.querySelectorAll('[data-filter="dataset"]')) {
    element.hidden = agentView;
  }
  activeView = name;
  document.body.dataset.activeView = name;
  syncNameOptions();
  hideSearchResults();
  ui.hideTooltip();
  if (previousView && previousView !== name) {
    if (selection && selectionSupportedByView(name, selection)) {
      if (selection.kind === "agent") {
        openAgent(selection.id, selection.label, { tab: agentTabForView(name) });
      } else if (selection.kind === "work") {
        openWork(selection.id, selection.label, {
          tab: AGENT_VIEWS.has(name) ? "credits" : selection.tab,
          nav: selection.nav
        });
      } else if (selection.kind === "entity") {
        openRecord(selection.id, selection.label);
      }
    } else if (selection || ui.drawerIsOpen()) {
      // A record drawer is only meaningful in views that can highlight it.
      // Aggregate drill-downs (country, year, heatmap cell) must not follow
      // the user to another view either.
      ui.closeDrawer();
    }
  }
  if (!loaded.has(name) || stale.has(name)) loadView(name);
  else {
    if (views[name].resume) views[name].resume();
    views[name].resize();
    applySelection();
    refreshDrawerOutside();
  }
}

async function loadView(name) {
  clearTimeout(loadTimers.get(name));
  cancelLoad(name);
  const token = loadTokens.get(name);
  const controller = new AbortController();
  loadControllers.set(name, controller);
  stale.delete(name);
  loaded.delete(name);
  try {
    await views[name].load({ signal: controller.signal });
    if (token !== loadTokens.get(name)) return;
    loaded.add(name);
    if (name === activeView) {
      applySelection();
      refreshDrawerOutside();
      ui.setStatus("");
    } else if (views[name].pause) {
      views[name].pause();
    }
  } catch (error) {
    if (token !== loadTokens.get(name) || error.name === "AbortError") return;
    loaded.delete(name);
    ui.error(
      document.getElementById(CHART_ROOT[name]) || document.body,
      error,
      "Check the endpoint shown above and try again."
    );
    if (name === activeView) {
      ui.setStatus("The query failed. Check the endpoint shown above.", "error");
    }
  } finally {
    if (loadControllers.get(name) === controller) loadControllers.delete(name);
  }
}

function wireNavigation() {
  window.addEventListener("hashchange", () => showView(route()));
  if (!location.hash) history.replaceState(null, "", `#${defaultView()}`);
}

function wireExport() {
  for (const button of document.querySelectorAll("[data-export]")) {
    button.addEventListener("click", () => {
      const view = views[button.dataset.export];
      if (!view || !view.exportSvg) return;
      const result = view.exportSvg();
      if (!result) return;
      if (result.canvas) ui.downloadCanvas(result.canvas, result.name, result.background);
      else if (result.element) ui.downloadSvg(result.element, result.name);
    });
  }
}

function wireFit() {
  for (const button of document.querySelectorAll("[data-fit]")) {
    button.addEventListener("click", () => {
      const view = views[button.dataset.fit];
      if (view && view.fit) view.fit();
    });
  }
}

function wireResize() {
  let timer = null;
  const resizeNow = () => {
    if (activeView && views && loaded.has(activeView)) views[activeView].resize();
  };
  const resizeActive = () => {
    clearTimeout(timer);
    timer = setTimeout(resizeNow, 200);
  };
  // The docked sidebar changes the content width synchronously. Reflow in the
  // next frame rather than waiting for the window-resize debounce.
  const resizeForDrawer = () => {
    clearTimeout(timer);
    requestAnimationFrame(resizeNow);
  };
  window.addEventListener("resize", resizeActive);
  window.addEventListener("fiaf-viz:drawer-mode", resizeForDrawer);
}

// -- drawer handlers --------------------------------------------------------

// The last rendered drawer list, so its dimming and "N in this view" note can be
// refreshed when the active view (and therefore its node set) changes.
let lastDrawerList = null;

// True when the active view renders this entity, or when the view has no node
// set (dataset-wide views) or cannot render that kind of entity at all. A view
// that has not finished loading counts as "in view" so rows are not dimmed
// before the chart exists.
function inActiveView(id, kind) {
  if (!views || !activeView) return true;
  const view = views[activeView];
  if (!view || typeof view.hasNode !== "function") return true;
  if (view.kinds && kind && !view.kinds.has(kind)) return true;
  if (!loaded.has(activeView)) return true;
  return view.hasNode(id);
}

function refreshDrawerOutside() {
  if (!lastDrawerList) return;
  if (lastDrawerList.isActive && !lastDrawerList.isActive()) return;
  ui.drawerListInto(
    lastDrawerList.container || ui.drawerContent(),
    lastDrawerList.items,
    lastDrawerList.describe
  );
}

function loadAgentWorks(agent) {
  const key = `${scopeKey()}|${agent}`;
  if (agentWorksCache.has(key)) return agentWorksCache.get(key);
  const substitutions = { AGENT: sparqlIri(agent), SCOPE_FILTER: ctx.scopeFilter() };
  const request = Promise.all([
    runQuery("agent-works", substitutions),
    runQuery("agent-summary", substitutions)
  ]).then(([rows, summary]) => agentHistory(rows, summary));
  agentWorksCache.set(key, request);
  request.catch(() => {
    if (agentWorksCache.get(key) === request) agentWorksCache.delete(key);
  });
  return request;
}

// Cache the resolved rows, not the promise: the drawer aborts a superseded
// work query, and an aborted promise must never become the cached answer.
function loadWorkAgents(work, signal) {
  if (workAgentsCache.has(work)) return Promise.resolve(workAgentsCache.get(work));
  return runQuery("work-agents", { WORK: sparqlIri(work) }, { signal }).then(
    (rows) => {
      workAgentsCache.set(work, rows);
      return rows;
    }
  );
}

// Like the agent query, cache the resolved row rather than the promise: an
// aborted request must not become the cached answer for the next drawer.
function loadWorkMetadata(work, signal) {
  if (workMetadataCache.has(work)) {
    return Promise.resolve(workMetadataCache.get(work));
  }
  return runQuery("work-metadata", { WORK: sparqlIri(work) }, { signal }).then(
    (rows) => {
      const row = rows[0] || {};
      workMetadataCache.set(work, row);
      return row;
    }
  );
}

function loadWorkHoldings(work, signal) {
  if (workHoldingsCache.has(work)) {
    return Promise.resolve(workHoldingsCache.get(work));
  }
  return runQuery("work-holdings", { WORK: sparqlIri(work) }, { signal }).then(
    (rows) => {
      workHoldingsCache.set(work, rows);
      return rows;
    }
  );
}

function loadWorkRelations(work, signal) {
  if (workRelationsCache.has(work)) {
    return Promise.resolve(workRelationsCache.get(work));
  }
  return runQuery("work-relations", { WORK: sparqlIri(work) }, { signal }).then(
    (rows) => {
      workRelationsCache.set(work, rows);
      return rows;
    }
  );
}

// Keep a failed holdings/relations query inside its drawer tab instead of
// replacing the whole record.
function loadWorkVariants(work, signal) {
  if (workVariantsCache.has(work)) {
    return Promise.resolve(workVariantsCache.get(work));
  }
  return runQuery("work-variants", { WORK: sparqlIri(work) }, { signal }).then(
    (rows) => {
      workVariantsCache.set(work, rows);
      return rows;
    }
  );
}

function optionalRows(promise) {
  return promise.then(
    (rows) => ({ rows, error: null }),
    (error) => {
      if (error.name === "AbortError") throw error;
      return { rows: null, error };
    }
  );
}

function agentWorkItems(rows) {
  const works = new Map();
  for (const row of rows) {
    if (!works.has(row.work)) {
      works.set(row.work, {
        work: row.work,
        title: row.title || row.work,
        year: null,
        roles: new Set()
      });
    }
    const item = works.get(row.work);
    if (row.role) item.roles.add(row.role);
    const year = Number.parseInt(row.year, 10);
    if (Number.isFinite(year) && (item.year === null || year < item.year)) item.year = year;
  }
  return [...works.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function updateAgentSelection(rows, summary) {
  if (!selection || selection.kind !== "agent") return;
  const roleTotals = summary.roleTotals;
  selection = {
    ...selection,
    pending: false,
    workIds: [...new Set(rows.map((row) => row.work))],
    workCount: summary.works,
    roles: roleTotals.map((entry) => entry.role),
    roleCounts: roleTotals
  };
  applySelection();
}

function renderAgentWorks(panel, agent, name, state, tabs) {
  const items = state.workItems;
  if (!items.length) {
    ui.panelMessage(panel, `No works found for this name${scopePhrase()}.`);
    return;
  }
  const describe = {
    heading: "Credited works",
    actions: [
      {
        label: "Show works in catalogue",
        onClick: () => {
          ui.closeDrawer();
          if (views && views.catalogue) {
            views.catalogue.filterByAgent(agent, name);
          }
          if (location.hash === "#catalogue") showView("catalogue");
          else location.hash = "#catalogue";
        }
      }
    ],
    note: () => {
      const visible = items.filter((item) => inActiveView(item.work, "work")).length;
      return (
        `${ui.formatNumber(items.length)} ${scopeLabel(items.length)}` +
        (state.works > items.length
          ? ` · showing ${ui.formatNumber(items.length)} of ${ui.formatNumber(state.works)} credited works; history is capped`
          : "") +
        (visible < items.length
          ? ` · ${ui.formatNumber(visible)} in this view; dimmed rows are outside it`
          : "")
      );
    },
    title: (item) => item.title,
    meta: (item) => `${[...item.roles].map(roleLabel).join(", ")} · ${item.work}`,
    id: (item) => item.work,
    inView: (item) => inActiveView(item.work, "work"),
    onSelect: (item) => openWork(item.work, item.title)
  };
  lastDrawerList = {
    items,
    describe,
    container: panel,
    isActive: () => Boolean(tabs && tabs.active() === "works")
  };
  ui.drawerListInto(panel, items, describe);
}

function renderAgentCoCredits(panel, agent, name, state, tabs) {
  if (state.coCreditError) {
    ui.panelMessage(panel, state.coCreditError.message, "error");
    return;
  }
  if (!state.coCreditRows) {
    ui.panelMessage(panel, "Loading co-credited names…");
    if (!state.coCreditPromise) {
      const token = state.token;
      state.coCreditPromise = ctx.agentCoCredits(agent).then((rows) => {
        if (state.token !== token || !selection || selection.id !== agent) return;
        state.coCreditRows = rows;
        if (tabs && tabs.active() === "co-credits") tabs.refresh();
      }).catch((error) => {
        if (error.name === "AbortError") return;
        if (state.token !== token) return;
        state.coCreditError = error;
        if (tabs && tabs.active() === "co-credits") tabs.refresh();
      });
    }
    return;
  }

  const rows = state.coCreditRows;
  if (!rows.length) {
    ui.panelMessage(panel, `No co-credited names found for ${name}${scopePhrase()}.`);
    return;
  }
  const limitReached = rows.length >= limit("coCreditAgents", 200);
  const describe = {
    heading: "Co-credited names",
    note: () => {
      const visible = rows.filter((row) => inActiveView(row.agent, "agent")).length;
      return (
        `${ui.formatNumber(rows.length)} names · sorted by shared works` +
        (visible < rows.length
          ? ` · ${ui.formatNumber(visible)} in this view; dimmed rows are outside it`
          : "") +
        (limitReached ? " · strongest relationships only" : "")
      );
    },
    title: (row) => row.name,
    meta: (row) =>
      `${ui.formatNumber(row.shared)} shared ${row.shared === 1 ? "work" : "works"}`,
    id: (row) => row.agent,
    inView: (row) => inActiveView(row.agent, "agent"),
    onSelect: (row) => openAgent(row.agent, row.name)
  };
  lastDrawerList = {
    items: rows,
    describe,
    container: panel,
    isActive: () => Boolean(tabs && tabs.active() === "co-credits")
  };
  ui.drawerListInto(panel, rows, describe);
}

function ensureAgentRecord(state, agent, tabs) {
  if (state.record || state.recordPromise || state.recordError) return;
  const token = state.token;
  state.recordPromise = loadEntityRecord(agent).then((record) => {
    if (state.token !== token) return;
    state.record = record;
    if (tabs && tabs.active() === "overview") tabs.refresh();
  }).catch((error) => {
    if (error.name === "AbortError" || state.token !== token) return;
    state.recordError = error;
    if (tabs && tabs.active() === "overview") tabs.refresh();
  });
}

function renderAgentOverview(panel, agent, name, state, tabs) {
  const roles = state.roleTotals;
  const viewStatus = selectionStatus();
  const groups = [
    {
      heading: "Activity",
      rows: [
        { label: "Credited works", value: ui.formatNumber(state.works) },
        {
          label: "Roles",
          value: roles.length
            ? roles
                .map((entry) => `${roleLabel(entry.role)} (${ui.formatNumber(entry.works)})`)
                .join(", ")
            : null
        },
        {
          label: "Current view",
          value: viewStatus ? viewStatus.text : "Checking this view…"
        }
      ]
    }
  ];

  if (state.record) {
    groups.push({
      heading: "Identification",
      rows: [
        { label: "Name", value: name },
        {
          label: "Type",
          value: [...state.record.types].map((type) => humanize(type)).join(", ")
        },
        {
          label: "Source dataset",
          value: (state.record.sourceDatasets || []).join(", ")
        },
        {
          label: "Identifiers",
          value: (state.record.identifiers || []).join(", ")
        },
        { label: "Record", value: localName(agent) || agent }
      ]
    });
  }

  ui.drawerMeta(panel, groups);

  // Career strip above the facts: works by year, one lane per role.
  if (state.workItems && state.workItems.length) {
    const strip = ui.node("div", "career-wrapper");
    panel.prepend(strip);
    renderCareer(strip, state.workItems, {
      colorFor: ctx.colorFor,
      capped: state.works > state.workItems.length,
      onSelect: (dot) => openWork(dot.work, dot.title)
    });
  }

  if (!state.record) {
    if (state.recordError) {
      panel.append(
        ui.node(
          "p",
          "drawer-section-note",
          `Identification unavailable: ${state.recordError.message}`
        )
      );
      return;
    }
    panel.append(ui.node("p", "drawer-section-note", "Loading identification…"));
    ensureAgentRecord(state, agent, tabs);
  }
}

function renderAgentDrawerTabs(agent, name, state) {
  let tabs = null;
  const requested = AGENT_TABS.has(selection && selection.tab)
    ? selection.tab
    : agentTabForView(activeView);
  tabs = ui.drawerTabs(
    [
      {
        id: "works",
        label: "Works",
        render: (panel) => renderAgentWorks(panel, agent, name, state, tabs)
      },
      {
        id: "co-credits",
        label: "Co-credits",
        render: (panel) => renderAgentCoCredits(panel, agent, name, state, tabs)
      },
      {
        id: "overview",
        label: "Overview",
        render: (panel) => renderAgentOverview(panel, agent, name, state, tabs)
      }
    ],
    {
      active: requested,
      label: "Name details",
      onChange: (active) => {
        if (selection && selection.kind === "agent" && selection.id === agent) {
          selection = { ...selection, tab: active };
        }
      }
    }
  );
  agentTabs = tabs;
  return tabs;
}

function labelNeedsLookup(label, iri) {
  if (!label) return true;
  const local = localName(iri) || iri;
  return (
    label === iri ||
    label === local ||
    label === `fiaf:${local}` ||
    label.startsWith("fiaf:")
  );
}

async function refreshAgentDrawer() {
  if (!selection || selection.kind !== "agent" || !views) return;
  const agent = selection.id;
  let name = selection.label || agent;
  const token = ++drawerToken;
  if (drawerController) {
    drawerController.abort();
    drawerController = null;
  }
  agentTabs = null;
  ui.openDrawer(name, agent);
  lastDrawerList = null;
  ui.drawerMessage("Loading name…");
  try {
    const [history, lookedUpRecord] = await Promise.all([
      loadAgentWorks(agent),
      labelNeedsLookup(name, agent)
        ? loadEntityRecord(agent).catch((error) => {
            if (error.name === "AbortError") throw error;
            return null;
          })
        : Promise.resolve(null)
    ]);
    if (token !== drawerToken || !selection || selection.id !== agent) return;
    let record = lookedUpRecord;
    if (record) {
      const resolved = recordTitle(record, name);
      if (resolved && resolved !== name) {
        name = resolved;
        selection = { ...selection, label: name };
        ui.setDrawerTitle(name, agent);
      }
    }
    const { rows } = history;
    updateAgentSelection(rows, history);
    const state = {
      token,
      agent,
      name,
      rows,
      works: history.works,
      workItems: agentWorkItems(rows),
      roleTotals: history.roleTotals,
      record,
      recordPromise: record ? Promise.resolve(record) : null,
      recordError: null,
      coCreditRows: null,
      coCreditPromise: null,
      coCreditError: null
    };
    renderAgentDrawerTabs(agent, name, state);
  } catch (error) {
    if (token !== drawerToken || !selection || selection.id !== agent) return;
    ui.drawerMessage(error.message, "error");
  }
}

async function openAgent(agent, name, options = {}) {
  // A stale Work query must not repaint the drawer after switching to a name.
  if (workDrawerState) {
    workDrawerState.controller.abort();
    workDrawerState = null;
  }
  const requestedTab = options.tab;
  const tab = AGENT_TABS.has(requestedTab)
    ? requestedTab
    : agentTabForView(activeView);
  agentTabs = null;
  // `pending` tells the views that workIds are still loading: an out-of-slice
  // name must not repaint the chart until its works have arrived.
  selection = {
    kind: "agent",
    id: agent,
    label: name || agent,
    pending: true,
    tab
  };
  applySelection();
  await refreshAgentDrawer();
}

// -- generic record inspector (expert queries) ------------------------------

function guessEntityKind(hint) {
  const name = String(hint || "").toLowerCase();
  if (!name) return "";
  if (name.includes("work")) return "work";
  if (
    name.includes("agent") ||
    name.includes("person") ||
    name.includes("organisation") ||
    name.includes("organization") ||
    name.includes("director") ||
    name.includes("cast") ||
    name.includes("writer") ||
    name.includes("company") ||
    name.includes("name")
  ) {
    return "agent";
  }
  return "";
}

function loadEntityRecord(iri, signal) {
  if (entityRecordCache.has(iri)) {
    return Promise.resolve(entityRecordCache.get(iri));
  }
  return runQuery("entity-record", { ENTITY: sparqlAnyIri(iri) }, { signal }).then(
    (rows) => {
      const types = new Set();
      const identifiers = [];
      const sourceDatasets = new Set();
      let label = null;
      let parentWork = null;
      let parentWorkLabel = null;
      for (const row of rows) {
        if (row.type) types.add(row.type);
        if (row.identifier && !identifiers.includes(row.identifier)) {
          identifiers.push(row.identifier);
        }
        if (row.authority) {
          sourceDatasets.add(row.authorityLabel || humanize(row.authority));
        }
        if (!label && row.label) label = row.label;
        if (!parentWork && row.parentWork) {
          parentWork = row.parentWork;
          parentWorkLabel = row.parentWorkLabel || null;
        }
      }
      const record = {
        entity: iri,
        types,
        identifiers,
        sourceDatasets: [...sourceDatasets],
        label,
        parentWork,
        parentWorkLabel,
        found: rows.length > 0
      };
      entityRecordCache.set(iri, record);
      return record;
    }
  );
}

function entityKindLabel(types) {
  const preferred = [
    "Item", "Carrier", "Manifestation", "ProductionEvent",
    "Person", "Organisation", "Agent", "Work", "MonographicWork"
  ];
  for (const name of preferred) {
    if (types.has(`${ROLE_NS}${name}`)) return humanize(`${ROLE_NS}${name}`);
  }
  for (const type of types) {
    if (type.startsWith("http://www.w3.org")) continue;
    return humanize(type);
  }
  return "";
}

// Items and carriers usually have no title or rdfs:label. Use their identifier
// (shortened when it is a UUID), then the parent work title, so the drawer
// heading is meaningful instead of a local id.
function recordTitle(record, fallback) {
  if (record.label) return record.label;
  const kind = entityKindLabel(record.types);
  const identifier = record.identifiers[0];
  if (identifier && !UUID_RE.test(identifier)) {
    return kind ? `${kind} ${identifier}` : identifier;
  }
  if (record.parentWorkLabel) {
    return kind
      ? `${record.parentWorkLabel} · ${kind.toLowerCase()}`
      : record.parentWorkLabel;
  }
  if (identifier) {
    const short = shortText(identifier);
    return kind ? `${kind} ${short}` : short;
  }
  return fallback;
}

function loadEntityProperties(iri, signal) {
  if (entityPropertiesCache.has(iri)) {
    return Promise.resolve(entityPropertiesCache.get(iri));
  }
  return runQuery(
    "entity-properties",
    { ENTITY: sparqlAnyIri(iri) },
    { signal }
  ).then((rows) => {
    const seen = new Map();
    const properties = [];
    for (const row of rows) {
      if (!row.property) continue;
      const key =
        row.valueIsIri === "true"
          ? `${row.property}|${row.value}`
          : `${row.property}|${row.value}|${row.valueType}`;
      const existing = seen.get(key);
      if (existing) {
        // A value can have several types; keep the link if any of them is a
        // core catalogue record.
        if (!existing.valueIsSidebarLink && isSidebarEntityType(row.valueType)) {
          existing.valueIsSidebarLink = true;
        }
        continue;
      }
      const entry = {
        ...row,
        valueIsSidebarLink: isSidebarEntityType(row.valueType)
      };
      seen.set(key, entry);
      properties.push(entry);
    }
    entityPropertiesCache.set(iri, properties);
    return properties;
  });
}

const ENTITY_DETAIL_PROPERTIES = [
  ["hasFormat", "Format"],
  ["isElement", "Element"],
  ["hasBase", "Base"],
  ["hasColourCharacteristic", "Colour"],
  ["hasSoundCharacteristic", "Sound"],
  ["hasStock", "Film stock"],
  ["hasStatus", "Status"],
  ["hasHoldingInstitution", "Holding institution"],
  ["hasCarrier", "Carriers"],
  ["hasItem", "Items"],
  ["hasManifestation", "Manifestations"]
];

function entityPropertyValue(row) {
  if (row.valueLabel && !/^https?:\/\//.test(row.valueLabel)) {
    return row.valueLabel;
  }
  if (row.valueTitle) return row.valueTitle;
  if (row.valueType) return humanize(row.valueType);
  return localName(row.value) || row.value;
}

function entityDetailRows(properties) {
  const found = new Map();
  for (const [property, label] of ENTITY_DETAIL_PROPERTIES) {
    const values = new Set();
    for (const row of properties || []) {
      if (localName(row.property) !== property) continue;
      const value = entityPropertyValue(row);
      if (value) values.add(value);
    }
    if (values.size) found.set(label, [...values].join(", "));
  }
  return [...found.entries()].map(([label, value]) => ({ label, value }));
}

function holdingKindForRecord(record) {
  if (record.types.has(`${ROLE_NS}Item`)) return "item";
  if (record.types.has(`${ROLE_NS}Carrier`)) return "carrier";
  if (record.types.has(`${ROLE_NS}Manifestation`)) return "manifestation";
  return null;
}

function renderEntityOverview(panel, iri, record) {
  const identification = [
    { label: "Label", value: record.label },
    {
      label: "Identifier",
      value: (record.identifiers || []).join(", ")
    },
    {
      label: "Type",
      value: [...record.types].map((type) => humanize(type)).join(", ")
    },
    {
      label: "Source dataset",
      value: (record.sourceDatasets || []).join(", ")
    },
    { label: "Record", value: localName(iri) || iri }
  ];
  const groups = [{ heading: "Identification", rows: identification }];
  const details = entityDetailRows(record.properties);
  if (details.length) groups.push({ heading: "Details", rows: details });
  ui.drawerMeta(panel, groups);

  if (record.parentWork) {
    const section = ui.node("section", "drawer-meta-section");
    section.append(ui.node("h3", "drawer-section-title", "Parent work"));
    const button = ui.node(
      "button",
      "drawer-action",
      record.parentWorkLabel ||
        localName(record.parentWork) ||
        record.parentWork
    );
    button.type = "button";
    button.title = record.parentWork;
    const kind = holdingKindForRecord(record);
    button.addEventListener("click", () =>
      openWork(record.parentWork, record.parentWorkLabel, {
        tab: "holdings",
        holding: kind ? { kind, id: iri } : null
      })
    );
    section.append(button);
    panel.append(section);
  }

  if (!record.found) {
    panel.append(
      ui.node(
        "p",
        "drawer-section-note",
        "The endpoint returned no statements for this IRI."
      )
    );
  }
}

function entityPropertySections(properties) {
  const groups = new Map();
  for (const row of properties) {
    if (!groups.has(row.property)) groups.set(row.property, []);
    groups.get(row.property).push(row);
  }
  const sections = [];
  for (const [property, rows] of groups) {
    const section = ui.node("section", "drawer-meta-section");
    section.append(ui.node("h3", "drawer-section-title", humanize(property)));
    const values = ui.node("div", "drawer-property-values");
    for (const row of rows) {
      if (row.valueIsIri === "true") {
        const label =
          row.valueLabel && !/^https?:\/\//.test(row.valueLabel)
            ? row.valueLabel
            : localName(row.value) || row.value;
        if (row.valueIsSidebarLink) {
          const button = ui.node("button", "drawer-entity-link", label);
          button.type = "button";
          button.title = row.value;
          button.addEventListener("click", () =>
            openEntity(row.value, label, property)
          );
          values.append(button);
        } else {
          const span = ui.node("span", "drawer-property-value", label);
          span.title = row.value;
          values.append(span);
        }
      } else if (row.valueIsBlank === "true") {
        // Blank nodes have no stable public IRI. Show what they resolve to
        // (label, nested title, or type) instead of their internal id.
        const label =
          row.valueLabel ||
          row.valueTitle ||
          (row.valueType ? humanize(row.valueType) : "");
        if (label) values.append(ui.node("span", "drawer-property-value", label));
      } else {
        values.append(ui.node("span", "drawer-property-value", row.value));
      }
    }
    section.append(values);
    sections.push(section);
  }
  return sections;
}

function renderEntityProperties(panel, iri, properties) {
  panel.replaceChildren();
  if (!properties.length) {
    ui.panelMessage(panel, "No outgoing properties found for this record.");
    return;
  }
  panel.append(...entityPropertySections(properties));
}

function renderEntityDrawer(iri, record) {
  ui.drawerTabs(
    [
      {
        id: "record-overview",
        label: "Overview",
        render: (panel) => renderEntityOverview(panel, iri, record)
      },
      {
        id: "record-properties",
        label: "Properties",
        render: (panel) =>
          renderEntityProperties(panel, iri, record.properties || [])
      }
    ],
    { active: "record-overview", label: "Record details" }
  );
}

async function openRecord(iri, label) {
  const token = ++drawerToken;
  agentTabs = null;
  if (drawerController) drawerController.abort();
  if (workDrawerState) {
    workDrawerState.controller.abort();
    workDrawerState = null;
  }
  const controller = new AbortController();
  drawerController = controller;
  lastDrawerList = null;

  let title = label || localName(iri) || iri;
  selection = { kind: "entity", id: iri, label: title, pending: true };
  ui.openDrawer(title, iri);
  ui.drawerMessage("Loading record…");
  applySelection();

  try {
    const record = await loadEntityRecord(iri, controller.signal);
    if (token !== drawerToken) return;
    const displayTitle = recordTitle(record, title);
    if (displayTitle !== title) {
      title = displayTitle;
      selection = { ...selection, label: title };
      ui.setDrawerTitle(title, iri);
    }
    if (
      record.types.has(`${ROLE_NS}Work`) ||
      record.types.has(`${ROLE_NS}MonographicWork`)
    ) {
      await openWork(iri, record.label || title);
      return;
    }
    if (
      record.types.has(`${ROLE_NS}Person`) ||
      record.types.has(`${ROLE_NS}Organisation`) ||
      record.types.has(`${ROLE_NS}Agent`)
    ) {
      await openAgent(iri, record.label || title);
      return;
    }
    const properties = await loadEntityProperties(iri, controller.signal);
    if (token !== drawerToken) return;
    record.properties = properties;
    selection = { kind: "entity", id: iri, label: title, pending: false };
    applySelection();
    renderEntityDrawer(iri, record);
  } catch (error) {
    if (token !== drawerToken || error.name === "AbortError") return;
    ui.drawerMessage(error.message, "error");
  } finally {
    if (drawerController === controller) drawerController = null;
  }
}

function openEntity(iri, label, hint) {
  const kind = guessEntityKind(hint);
  if (kind === "work") return openWork(iri, label);
  if (kind === "agent") return openAgent(iri, label);
  return openRecord(iri, label);
}

function splitMetadata(value) {
  if (value === undefined || value === null || value === "") return [];
  return String(value)
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function metadataList(value, format = humanize) {
  const parts = splitMetadata(value).map((part) => format(part));
  return parts.length ? parts.join(", ") : null;
}

function metadataLanguages(value) {
  const parts = splitMetadata(value).map((part) => {
    const cut = part.indexOf("~");
    const language = cut >= 0 ? part.slice(0, cut) : part;
    const usage = cut >= 0 ? part.slice(cut + 1) : "";
    const label = humanize(language);
    return usage ? `${label} (${humanize(usage)})` : label;
  });
  return parts.length ? parts.join(", ") : null;
}

function metadataCount(value) {
  if (value === undefined || value === null || value === "") return null;
  return ui.formatNumber(Number(value) || 0);
}

function workOverviewGroups(row) {
  const data = row || {};
  return [
    {
      heading: "Identification",
      rows: [
        { label: "Title", value: data.label },
        {
          label: "Title variants",
          value: metadataList(data.titles, (value) => value)
        },
        { label: "Production year", value: data.year },
        { label: "Countries", value: metadataList(data.countries) },
        { label: "Forms", value: metadataList(data.forms) },
        { label: "Genres", value: metadataList(data.genres) },
        { label: "Languages", value: metadataLanguages(data.languages) },
        {
          label: "Ratings",
          value: metadataList(data.ratings, (value) => value)
        },
        {
          label: "Source dataset",
          value: metadataList(data.sourceDatasets, (value) => value)
        },
        {
          label: "Identifiers",
          value: metadataList(data.identifiers, (value) => value)
        }
      ]
    },
    {
      heading: "Holdings",
      rows: [
        { label: "Manifestations", value: metadataCount(data.manifestations) },
        { label: "Items", value: metadataCount(data.items) },
        { label: "Carriers", value: metadataCount(data.carriers) },
        { label: "Digital items", value: metadataCount(data.digitalItems) }
      ]
    }
  ];
}

function renderWorkOverview(panel, state) {
  if (!state.metadata) {
    ui.panelMessage(panel, "Loading work metadata…");
    return;
  }
  ui.drawerMeta(panel, workOverviewGroups(state.metadata));
}

function renderWorkCredits(panel, state, tabs) {
  if (!state.agents) {
    ui.panelMessage(panel, "Loading credited names…");
    return;
  }
  const items = state.agents.items;
  if (!items.length) {
    lastDrawerList = null;
    ui.panelMessage(panel, "No credited names found for this work.");
    return;
  }
  const describe = {
    heading: "Credited names",
    note: () => {
      const visible = items.filter((item) => inActiveView(item.agent, "agent")).length;
      return (
        (state.agents.limited
          ? `Showing ${ui.formatNumber(items.length)} names · credit row limit reached; names and roles may be incomplete`
          : `${ui.formatNumber(items.length)} names in the catalogue`) +
        (visible < items.length
          ? ` · ${ui.formatNumber(visible)} in this view; dimmed rows are outside it`
          : "")
      );
    },
    title: (item) => item.name,
    meta: (item) =>
      `${[...item.roles].map(roleLabel).join(", ")} · ${item.agent}`,
    id: (item) => item.agent,
    inView: (item) => inActiveView(item.agent, "agent"),
    onSelect: (item) => openAgent(item.agent, item.name)
  };
  lastDrawerList = {
    items,
    describe,
    container: panel,
    isActive: () => tabs.active() === "credits"
  };
  ui.drawerListInto(panel, items, describe);
}

// -- work holdings tree -----------------------------------------------------

const RELATION_LABELS = {
  hasWork: "Related work",
  parentWork: "Parent work",
  seeAlso: "See also"
};

function languageText(value) {
  const text = String(value || "");
  const cut = text.indexOf("~");
  const language = cut >= 0 ? text.slice(0, cut) : text;
  const usage = cut >= 0 ? text.slice(cut + 1) : "";
  const label = humanize(language);
  return usage ? `${label} (${humanize(usage)})` : label;
}

function groupHoldings(rows) {
  const manifestations = new Map();
  for (const row of rows) {
    if (!row.manifestation) continue;
    let manifestation = manifestations.get(row.manifestation);
    if (!manifestation) {
      manifestation = {
        id: row.manifestation,
        type: row.manifestationType,
        label: row.manifestationLabel,
        identifiers: splitMetadata(row.manifestationIdentifiers),
        languages: splitMetadata(row.manifestationLanguages),
        ratings: splitMetadata(row.manifestationRatings),
        items: new Map()
      };
      manifestations.set(row.manifestation, manifestation);
    }
    if (!row.item) continue;
    let item = manifestation.items.get(row.item);
    if (!item) {
      item = {
        id: row.item,
        label: row.itemLabel,
        identifiers: splitMetadata(row.itemIdentifiers),
        formats: splitMetadata(row.itemFormats),
        elements: splitMetadata(row.itemElements),
        bases: splitMetadata(row.itemBases),
        colours: splitMetadata(row.itemColours),
        sounds: splitMetadata(row.itemSounds),
        stocks: splitMetadata(row.itemStocks),
        statuses: splitMetadata(row.itemStatuses),
        institutions: splitMetadata(row.itemInstitutions),
        carriers: new Map()
      };
      manifestation.items.set(row.item, item);
    }
    if (row.carrier) {
      item.carriers.set(row.carrier, {
        id: row.carrier,
        label: row.carrierLabel,
        identifiers: splitMetadata(row.carrierIdentifiers)
      });
    }
  }
  return [...manifestations.values()];
}

function wmicBadge(kind, letter) {
  return ui.node("span", `wmic-badge wmic-badge-${kind}`, letter);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shortText(value) {
  const text = String(value || "");
  return UUID_RE.test(text) ? `${text.slice(0, 8)}…` : text;
}

function shortId(value) {
  const local = localName(value) || String(value || "");
  return UUID_RE.test(local) ? `${local.slice(0, 8)}…` : local;
}

function joined(parts, separator = " · ") {
  return parts.filter(Boolean).join(separator);
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function wmicSummary(kind, letter, title, meta, count) {
  const summary = ui.node("summary", "wmic-summary");
  summary.append(wmicBadge(kind, letter));
  const text = ui.node("span", "wmic-summary-text");
  text.append(ui.node("span", "wmic-title", title));
  if (meta) text.append(ui.node("span", "wmic-meta-line", meta));
  summary.append(text);
  if (count) summary.append(ui.node("span", "wmic-count", count));
  summary.title = joined([title, meta, count]);
  return summary;
}

function wmicLeaf(kind, letter, title, meta) {
  const leaf = ui.node("div", "wmic-leaf");
  leaf.append(wmicBadge(kind, letter));
  const text = ui.node("span", "wmic-summary-text");
  text.append(ui.node("span", "wmic-title", title));
  if (meta) text.append(ui.node("span", "wmic-meta-line", meta));
  leaf.append(text);
  leaf.title = joined([title, meta]);
  return leaf;
}

function formatHumanized(values) {
  return values.map((value) => humanize(value)).join(", ");
}

function firstIdentifier(values) {
  return values.length ? shortText(values[0]) : "";
}

// Kinds that can be selected in the holdings tree and inspected below it.
const HOLDINGS_KINDS = {
  manifestation: { letter: "M", label: "Manifestation" },
  item: { letter: "I", label: "Item" },
  carrier: { letter: "C", label: "Carrier" }
};

const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

// Outgoing properties already shown by the structured inspector fields.
const HOLDINGS_DETAIL_SKIP = {
  manifestation: new Set([
    `${ROLE_NS}hasIdentifier`,
    `${ROLE_NS}hasLanguageUsage`,
    `${ROLE_NS}hasEvent`,
    `${ROLE_NS}hasItem`
  ]),
  item: new Set([
    `${ROLE_NS}hasIdentifier`,
    `${ROLE_NS}hasFormat`,
    `${ROLE_NS}isElement`,
    `${ROLE_NS}hasBase`,
    `${ROLE_NS}hasColourCharacteristic`,
    `${ROLE_NS}hasSoundCharacteristic`,
    `${ROLE_NS}hasStock`,
    `${ROLE_NS}hasStatus`,
    `${ROLE_NS}hasHoldingInstitution`,
    `${ROLE_NS}hasCarrier`
  ]),
  carrier: new Set([`${ROLE_NS}hasIdentifier`])
};

function manifestationTitle(manifestation) {
  const recordTitle = firstIdentifier(manifestation.identifiers);
  return (
    manifestation.label ||
    recordTitle ||
    (manifestation.type ? humanize(manifestation.type) : "Manifestation")
  );
}

function itemTitle(item) {
  const formats = formatHumanized(item.formats);
  const elements = formatHumanized(item.elements);
  const recordTitle = firstIdentifier(item.identifiers);
  return item.label || formats || elements || recordTitle || "Item";
}

function carrierTitle(carrier) {
  return (
    carrier.label || firstIdentifier(carrier.identifiers) || shortId(carrier.id)
  );
}

function compactRows(rows) {
  return rows.filter((row) => {
    const value = row.value;
    return value !== undefined && value !== null && String(value).trim();
  });
}

function holdingsInspectorGroups(kind, data) {
  if (kind === "manifestation") {
    return [
      {
        rows: compactRows([
          { label: "Label", value: data.label },
          { label: "Type", value: data.type ? humanize(data.type) : null },
          { label: "Identifiers", value: data.identifiers.join(", ") },
          {
            label: "Languages",
            value: data.languages.map(languageText).join(", ")
          },
          { label: "Ratings", value: data.ratings.join(", ") },
          { label: "Items", value: ui.formatNumber(data.items.size) },
          { label: "Record", value: localName(data.id) || data.id }
        ])
      }
    ];
  }
  if (kind === "item") {
    return [
      {
        rows: compactRows([
          { label: "Label", value: data.label },
          { label: "Identifiers", value: data.identifiers.join(", ") },
          { label: "Format", value: formatHumanized(data.formats) },
          { label: "Element", value: formatHumanized(data.elements) },
          { label: "Base", value: formatHumanized(data.bases) },
          { label: "Colour", value: formatHumanized(data.colours) },
          { label: "Sound", value: formatHumanized(data.sounds) },
          { label: "Film stock", value: data.stocks.join(", ") },
          { label: "Status", value: formatHumanized(data.statuses) },
          {
            label: "Holding institution",
            value: data.institutions.join(", ")
          },
          { label: "Carriers", value: ui.formatNumber(data.carriers.size) },
          { label: "Record", value: localName(data.id) || data.id }
        ])
      }
    ];
  }
  return [
    {
      rows: compactRows([
        { label: "Label", value: data.label },
        { label: "Identifiers", value: data.identifiers.join(", ") },
        { label: "Record", value: localName(data.id) || data.id }
      ])
    }
  ];
}

function holdingsExtraProperties(kind, properties) {
  const skip = HOLDINGS_DETAIL_SKIP[kind] || new Set();
  return properties.filter(
    (row) => row.property !== RDFS_LABEL && !skip.has(row.property)
  );
}

async function renderHoldingsExtra(container, kind, iri, token) {
  container.replaceChildren(
    ui.node("p", "drawer-section-note", "Loading additional properties…")
  );
  try {
    const properties = await loadEntityProperties(iri);
    if (token !== holdingsInspectorToken) return;
    const extra = holdingsExtraProperties(kind, properties);
    container.replaceChildren();
    if (!extra.length) {
      container.remove();
      return;
    }
    container.append(
      ui.node("h3", "drawer-section-title", "Additional properties")
    );
    container.append(...entityPropertySections(extra));
  } catch (error) {
    if (token !== holdingsInspectorToken || error.name === "AbortError") return;
    container.replaceChildren(
      ui.node(
        "p",
        "drawer-section-note",
        `Additional properties unavailable: ${error.message}`
      )
    );
  }
}

function renderHoldingsInspector(container, kind, data, onClear) {
  const token = ++holdingsInspectorToken;
  container.replaceChildren();
  if (!kind || !data) {
    container.append(
      ui.node(
        "p",
        "wmic-inspector-hint",
        "Select a manifestation, item or carrier in the hierarchy to inspect its metadata."
      )
    );
    return;
  }

  const meta = HOLDINGS_KINDS[kind];
  const header = ui.node("div", "wmic-inspector-head");
  header.append(wmicBadge(kind, meta.letter));
  const heading = ui.node("div", "wmic-inspector-heading");
  const title =
    kind === "manifestation"
      ? manifestationTitle(data)
      : kind === "item"
        ? itemTitle(data)
        : carrierTitle(data);
  heading.append(ui.node("span", "wmic-inspector-title", title));
  heading.append(
    ui.node("span", "wmic-inspector-meta", `${meta.label} · ${shortId(data.id)}`)
  );
  header.append(heading);
  const close = ui.node("button", "wmic-inspector-close", "×");
  close.type = "button";
  close.title = "Clear selection";
  close.setAttribute("aria-label", "Clear selection");
  close.addEventListener("click", onClear);
  header.append(close);
  container.append(header);

  const body = ui.node("div", "wmic-inspector-body");
  ui.drawerMeta(body, holdingsInspectorGroups(kind, data));
  container.append(body);

  const extra = ui.node("section", "wmic-inspector-extra");
  container.append(extra);
  renderHoldingsExtra(extra, kind, data.id, token);
}

function renderCarrier(carrier, holdings) {
  const meta = joined([
    carrier.identifiers.length > 1
      ? `ID ${carrier.identifiers.map(shortText).join(", ")}`
      : "",
    shortId(carrier.id)
  ]);
  const leaf = wmicLeaf("carrier", "C", carrierTitle(carrier), meta);
  leaf.classList.add("wmic-selectable");
  leaf.tabIndex = 0;
  leaf.setAttribute("role", "button");
  holdings.register("carrier", carrier, leaf);
  leaf.addEventListener("click", () => holdings.select("carrier", carrier));
  leaf.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      holdings.select("carrier", carrier);
    }
  });
  return leaf;
}

function renderItem(item, holdings) {
  const details = document.createElement("details");
  details.className = "wmic-branch wmic-item";
  const formats = formatHumanized(item.formats);
  const elements = formatHumanized(item.elements);
  const recordTitle = firstIdentifier(item.identifiers);
  const title = itemTitle(item);
  const meta = joined([
    item.label ? formats : "",
    title !== elements ? elements : "",
    formatHumanized(item.bases),
    formatHumanized(item.colours),
    formatHumanized(item.sounds),
    item.institutions.join(", "),
    title !== recordTitle && item.identifiers.length
      ? `ID ${item.identifiers.map(shortText).join(", ")}`
      : ""
  ]);
  const carrierCount = item.carriers.size;
  const summary = wmicSummary(
    "item",
    "I",
    title,
    meta,
    carrierCount ? countLabel(carrierCount, "carrier", "carriers") : ""
  );
  holdings.register("item", item, summary);
  summary.addEventListener("click", () => holdings.select("item", item));
  details.append(summary);

  const body = ui.node("div", "wmic-body");
  if (!carrierCount) {
    body.append(
      ui.node("p", "wmic-empty", "No carriers recorded for this item.")
    );
  } else {
    for (const carrier of item.carriers.values()) {
      body.append(renderCarrier(carrier, holdings));
    }
  }
  details.append(body);
  return details;
}

function renderManifestation(manifestation, holdings) {
  const details = document.createElement("details");
  details.className = "wmic-branch wmic-manifestation";
  details.open = true;
  const count = manifestation.items.size;
  const recordTitle = firstIdentifier(manifestation.identifiers);
  const title = manifestationTitle(manifestation);
  const meta = joined([
    manifestation.languages.map(languageText).join(", "),
    manifestation.ratings.join(", "),
    title !== recordTitle && manifestation.identifiers.length
      ? `ID ${manifestation.identifiers.map(shortText).join(", ")}`
      : ""
  ]);
  const summary = wmicSummary(
    "manifestation",
    "M",
    title,
    meta,
    countLabel(count, "item", "items")
  );
  holdings.register("manifestation", manifestation, summary);
  summary.addEventListener("click", () =>
    holdings.select("manifestation", manifestation)
  );
  details.append(summary);

  const body = ui.node("div", "wmic-body");
  if (!count) {
    body.append(
      ui.node("p", "wmic-empty", "No items recorded for this manifestation.")
    );
  } else {
    for (const item of manifestation.items.values()) {
      body.append(renderItem(item, holdings));
    }
  }
  details.append(body);
  return details;
}

function renderWorkRelations(relations) {
  const section = ui.node("section", "wmic-relations");
  section.append(ui.node("h3", "drawer-section-title", "Related works"));
  const list = ui.node("ul", "wmic-relation-list");
  for (const relation of relations) {
    if (!relation.related) continue;
    const item = ui.node("li", "");
    const button = ui.node("button", "wmic-relation-link");
    button.type = "button";
    button.title = relation.related;
    button.append(
      ui.node(
        "span",
        "wmic-relation-type",
        RELATION_LABELS[relation.relation] || humanize(relation.relation)
      )
    );
    button.append(
      ui.node(
        "span",
        "wmic-relation-title",
        relation.title || localName(relation.related) || relation.related
      )
    );
    button.addEventListener("click", () => {
      openWork(relation.related, relation.title || relation.related);
    });
    item.append(button);
    list.append(item);
  }
  section.append(list);
  return section;
}

function renderWorkHoldings(panel, state, tabs) {
  if (state.holdingsError) {
    ui.panelMessage(panel, state.holdingsError.message, "error");
    return;
  }
  if (!state.holdings) {
    ui.panelMessage(panel, "Loading holdings…");
    return;
  }

  panel.replaceChildren();
  if (state.relationsError) {
    panel.append(
      ui.node("p", "drawer-message error", state.relationsError.message)
    );
  } else if (state.relations && state.relations.length) {
    panel.append(renderWorkRelations(state.relations));
  }

  const manifestations = groupHoldings(state.holdings);
  const metadata = state.metadata || {};
  const workTitle = metadata.label || localName(state.work) || state.work;
  const countries = splitMetadata(metadata.countries)
    .map((value) => humanize(value))
    .join(", ");
  const identifiers = splitMetadata(metadata.identifiers).map(shortText);
  const workMeta = joined([
    metadata.year,
    countries,
    identifiers.length ? `ID ${identifiers.join(", ")}` : "",
    splitMetadata(metadata.sourceDatasets).join(", ")
  ]);
  const workNode = document.createElement("details");
  workNode.className = "wmic-branch wmic-work";
  workNode.open = true;
  workNode.append(
    wmicSummary(
      "work",
      "W",
      workTitle,
      workMeta,
      countLabel(manifestations.length, "manifestation", "manifestations")
    )
  );

  const nodes = new Map();
  const inspector = ui.node("section", "wmic-inspector");
  inspector.setAttribute("aria-label", "Selected holding details");
  inspector.setAttribute("aria-live", "polite");
  const current =
    holdingsSelection && holdingsSelection.work === state.work
      ? holdingsSelection
      : null;
  const selectedToken = current ? `${current.kind}|${current.id}` : null;

  function clearSelection() {
    holdingsSelection = null;
    showInspector();
  }

  function showInspector() {
    const active =
      holdingsSelection && holdingsSelection.work === state.work
        ? nodes.get(`${holdingsSelection.kind}|${holdingsSelection.id}`)
        : null;
    for (const [token, entry] of nodes) {
      entry.element.classList.toggle(
        "is-selected",
        Boolean(active) && token === `${active.kind}|${active.data.id}`
      );
    }
    if (active) {
      renderHoldingsInspector(
        inspector,
        active.kind,
        active.data,
        clearSelection
      );
    } else {
      renderHoldingsInspector(inspector, null, null, clearSelection);
    }
  }

  function selectNode(kind, data) {
    holdingsSelection = { work: state.work, kind, id: data.id };
    showInspector();
    // A long hierarchy can push the inspector below the drawer viewport.
    requestAnimationFrame(() => {
      if (inspector.getBoundingClientRect().top > window.innerHeight) {
        inspector.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }

  function registerNode(kind, data, element) {
    const token = `${kind}|${data.id}`;
    nodes.set(token, { kind, data, element });
    if (token === selectedToken) element.classList.add("is-selected");
  }

  const holdings = { select: selectNode, register: registerNode };
  const body = ui.node("div", "wmic-body");
  if (!manifestations.length) {
    body.append(
      ui.node("p", "wmic-empty", "No manifestations recorded for this work.")
    );
  } else {
    manifestations.forEach((manifestation) => {
      body.append(renderManifestation(manifestation, holdings));
    });
  }
  workNode.append(body);
  panel.append(workNode, inspector);
  showInspector();

  // A record picked in the graph may sit inside a collapsed item.
  const picked = selectedToken && nodes.get(selectedToken);
  if (picked) {
    for (let branch = picked.element.closest("details"); branch; ) {
      branch.open = true;
      branch = branch.parentElement && branch.parentElement.closest("details");
    }
    requestAnimationFrame(() => picked.element.scrollIntoView({ block: "center" }));
  }
}

// The work's credits, variants, holdings and related works as one graph.
function renderWorkGraphTab(panel, state, tabs) {
  if (state.holdingsError) {
    ui.panelMessage(panel, state.holdingsError.message, "error");
    return;
  }
  if (!state.holdings || !state.agents) {
    ui.panelMessage(panel, "Loading the record graph…");
    return;
  }
  panel.replaceChildren();
  if (state.variantsError) {
    panel.append(ui.node("p", "drawer-message error", state.variantsError.message));
  }
  const metadata = state.metadata || {};
  const holdingDetail = (data) =>
    joined([
      formatHumanized(data.formats || []),
      formatHumanized(data.elements || []),
      formatHumanized(data.bases || [])
    ]);
  renderWorkGraph(
    panel,
    {
      work: state.work,
      title: metadata.label || localName(state.work) || state.work,
      agents: state.agents ? state.agents.items : [],
      variants: state.variants || [],
      manifestations: groupHoldings(state.holdings || []),
      relations: state.relationsError ? [] : state.relations || [],
      titles: {
        manifestation: manifestationTitle,
        item: itemTitle,
        carrier: carrierTitle
      }
    },
    {
      colorFor: ctx.colorFor,
      exportName: `fiaf-record-graph-${localName(state.work) || "work"}.svg`,
      describe: (node) => {
        if (node.kind === "variant") return node.type ? humanize(node.type) : "";
        if (node.kind === "item") return holdingDetail(node.data);
        if (node.kind === "manifestation" && node.data.type) return humanize(node.data.type);
        if (node.kind === "related") {
          return RELATION_LABELS[node.relation] || humanize(node.relation);
        }
        return "";
      },
      onSelect: (node) => {
        if (node.kind === "agent") openAgent(node.iri, node.label);
        else if (node.kind === "related") openWork(node.iri, node.label);
        else if (node.kind === "variant") openRecord(node.iri, node.label);
        else if (node.kind === "more") tabs.activate("credits");
        else if (HOLDINGS_KINDS[node.kind]) {
          // Show the record in the tree, where the inspector lists its fields.
          holdingsSelection = { work: state.work, kind: node.kind, id: node.data.id };
          tabs.activate("holdings");
        }
      }
    }
  );
}

async function openWork(work, title, options = {}) {
  const token = ++drawerToken;
  agentTabs = null;
  if (drawerController) drawerController.abort();
  if (workDrawerState) {
    workDrawerState.controller.abort();
    workDrawerState = null;
  }
  const controller = new AbortController();
  drawerController = controller;
  if (options.holding && options.holding.kind && options.holding.id) {
    holdingsSelection = {
      work,
      kind: options.holding.kind,
      id: options.holding.id
    };
  } else if (!holdingsSelection || holdingsSelection.work !== work) {
    holdingsSelection = null;
  }

  const requestedTab = options.tab || "credits";
  const validTabs = ["credits", "holdings", "graph", "overview"];
  const defaultTab = validTabs.includes(requestedTab) ? requestedTab : "credits";
  const nav = options.nav || null;
  selection = {
    kind: "work",
    id: work,
    label: title || work,
    agentIds: null,
    pending: true,
    tab: defaultTab,
    nav
  };
  ui.openDrawer(title || work, work);
  lastDrawerList = null;
  applySelection();

  const drawerState = {
    work,
    metadata: null,
    agents: null,
    holdings: null,
    holdingsError: null,
    relations: null,
    relationsError: null,
    variants: null,
    variantsError: null
  };
  workDrawerState = { work, token, controller, state: drawerState };

  let tabs = null;
  tabs = ui.drawerTabs(
    [
      {
        id: "credits",
        label: "Credits",
        render: (panel) => renderWorkCredits(panel, drawerState, tabs)
      },
      {
        id: "holdings",
        label: "Holdings",
        render: (panel) => renderWorkHoldings(panel, drawerState, tabs)
      },
      {
        id: "graph",
        label: "Graph",
        render: (panel) => renderWorkGraphTab(panel, drawerState, tabs)
      },
      {
        id: "overview",
        label: "Overview",
        render: (panel) => renderWorkOverview(panel, drawerState)
      }
    ],
    {
      active: defaultTab,
      label: "Work details",
      onChange: (active) => {
        if (selection && selection.kind === "work" && selection.id === work) {
          selection = { ...selection, tab: active };
        }
      }
    }
  );

  try {
    const [metadata, agentRows, holdingsResult, relationsResult, variantsResult] =
      await Promise.all([
        loadWorkMetadata(work, controller.signal),
        loadWorkAgents(work, controller.signal),
        optionalRows(loadWorkHoldings(work, controller.signal)),
        optionalRows(loadWorkRelations(work, controller.signal)),
        optionalRows(loadWorkVariants(work, controller.signal))
      ]);
    if (
      token !== drawerToken ||
      !workDrawerState ||
      workDrawerState.token !== token
    ) {
      return;
    }
    const agents = workAgentModel(agentRows);
    const resolvedTitle = metadata.label || title || localName(work) || work;
    drawerState.metadata = metadata;
    drawerState.agents = agents;
    drawerState.holdings = holdingsResult.rows;
    drawerState.holdingsError = holdingsResult.error;
    drawerState.relations = relationsResult.rows;
    drawerState.relationsError = relationsResult.error;
    drawerState.variants = variantsResult.rows;
    drawerState.variantsError = variantsResult.error;
    ui.setDrawerTitle(resolvedTitle, work);
    selection = {
      kind: "work",
      id: work,
      label: resolvedTitle,
      agentIds: agents.agentIds,
      agents: agents.items,
      creditsLimited: agents.limited,
      pending: false,
      tab: tabs.active(),
      nav
    };
    applySelection();
    tabs.refresh();
  } catch (error) {
    if (token !== drawerToken || error.name === "AbortError") return;
    if (!workDrawerState || workDrawerState.token !== token) return;
    ui.drawerMessage(error.message, "error");
  } finally {
    if (drawerController === controller) drawerController = null;
  }
}

function onlyRole(iri) {
  state.selectedRoles = new Set([iri]);
  syncRoleChecks();
  updateRoleSummary();
  invalidateAgentViews(true);
  if (location.hash === "#cloud") showView("cloud");
  else location.hash = "#cloud";
}

// -- boot -------------------------------------------------------------------

function applyBrand() {
  const brand = config().brand || {};
  const title = document.querySelector(".brand h1");
  if (title && brand.title) {
    title.replaceChildren(document.createTextNode(`${brand.title} `));
    const accent = document.createElement("span");
    accent.textContent = brand.accent || "";
    title.append(accent);
  }
  if (brand.title) {
    document.title = `${brand.title} ${brand.accent || ""}`.trim();
  }
}

function applyViewVisibility() {
  const available = availableViews();
  for (const tab of document.querySelectorAll(".tabs a")) {
    tab.hidden = Boolean(available && !available.has(tab.dataset.view));
  }
}

async function ping(endpoint) {
  try {
    await runQuery("ping");
    ui.setEndpoint(endpoint, true);
  } catch (error) {
    ui.setEndpoint(endpoint, false);
    ui.setStatus(`The endpoint ${endpoint} is not reachable. Check the endpoint and try again.`, "error");
  }
}

// Under 1000px the name views fold their role, name and search filters
// behind one toggle, so the filter bar is a single row in every view and
// switching tabs does not move the page. CSS does the folding; this keeps
// the state and the accessible name in step.
function initFiltersToggle() {
  const toggle = document.getElementById("filters-toggle");
  const bar = toggle ? toggle.closest(".filters") : null;
  if (!toggle || !bar) return;
  toggle.addEventListener("click", () => {
    const open = !bar.classList.contains("is-expanded");
    bar.classList.toggle("is-expanded", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Hide name filters" : "Name filters";
  });
}

async function init() {
  initTheme();
  const restyleActive = () => {
    // Views that resolve theme colours in script expose restyle(); the others
    // are styled through CSS variables and only need the size check.
    if (activeView && views && loaded.has(activeView)) {
      const view = views[activeView];
      if (view.restyle) view.restyle();
      else view.resize();
    }
  };
  window.addEventListener("fiaf-viz:theme-change", restyleActive);
  // Canvas labels drawn before the web font arrives use the fallback face;
  // repaint once it has loaded.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(restyleActive, () => {});
  }
  ui.initDrawer();
  initFiltersToggle();
  onBusy((busy) => {
    const indicator = document.getElementById("busy");
    if (indicator) indicator.hidden = !busy;
  });
  onQueryStatus((status) => {
    const indicator = document.getElementById("busy");
    if (!indicator || !status) return;
    if (
      status.kind === "retry" ||
      status.kind === "queued" ||
      status.kind === "cooldown"
    ) {
      indicator.textContent = status.message;
    } else if (status.kind === "attempt" || status.kind === "done") {
      indicator.textContent = "Querying QLever…";
    }
  });

  try {
    const cfg = await loadConfig();
    applyBrand();
    applyViewVisibility();
    ui.setEndpoint(cfg.endpoint, true);
    state.topLimit = limit("cloudAgents", 5000) > 0 ? limit("cloudAgents", 5000) : null;
    const limitSelect = document.getElementById("top-limit");
    if (limitSelect) {
      if (
        state.topLimit !== null &&
        ![...limitSelect.options].some((option) => Number(option.value) === state.topLimit)
      ) {
        const option = document.createElement("option");
        option.value = String(state.topLimit);
        option.textContent = ui.formatNumber(state.topLimit);
        limitSelect.append(option);
      }
      const allowAll = !(cfg.features && cfg.features.allowAllNames === false);
      let allOption = [...limitSelect.options].find((option) => option.value === "all");
      if (allowAll && !allOption) {
        allOption = document.createElement("option");
        allOption.value = "all";
        allOption.textContent = "All";
        limitSelect.append(allOption);
      } else if (!allowAll && allOption) {
        allOption.remove();
        allOption = null;
      }
      if (state.topLimit === null && !allowAll) {
        state.topLimit = limit("cloudAgents", 5000) || 1000;
      }
      limitSelect.value = state.topLimit === null ? "all" : String(state.topLimit);
      syncNameOptions();
    }
    renderScopeOptions();
    wireFilters();
    createViews();
    wireSearch();
    wireNavigation();
    wireExport();
    wireFit();
    wireResize();
    showView(route());
    // The dataset list and role metadata are not needed before the first map
    // query. Load them after the landing view so a slow public endpoint cannot
    // delay first paint.
    loadScopes().catch((error) => {
      ui.setStatus(`Could not load the dataset list: ${error.message}`, "error");
    });
    refreshRolesForScope(true)
      .then((updated) => {
        if (updated && activeView && AGENT_VIEWS.has(activeView)) {
          invalidateAgentViews(true);
        }
      })
      .catch((error) => {
        ui.setStatus(`Could not load role filters: ${error.message}`, "error");
      });
    ping(cfg.endpoint);
  } catch (error) {
    ui.setStatus("Could not start the views.", "error");
    for (const name of Object.keys(CHART_ROOT)) {
      const root = document.getElementById(CHART_ROOT[name]);
      if (root) {
        ui.error(root, error, "Check config.json and that the endpoint is running.");
      }
    }
  }
}

init();
