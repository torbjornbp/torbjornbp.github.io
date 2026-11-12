// Thin SPARQL client used by every view.
//
// Query files live in queries/*.rq and are loaded on demand. Placeholders use
// {{NAME}} and are substituted from a small, validated set. IRIs and literals
// are escaped here; no view builds query text itself.

let config = null;
const queryText = new Map();
const queryResults = new Map();
// Response text length per parsed payload, so the result cache can size an
// entry without serialising a multi-megabyte result a second time.
const payloadChars = new WeakMap();
const pendingQueries = new Map();
let resultCacheChars = 0;
let cacheGeneration = 0;
let activeRequests = 0;
let activeQueries = 0;
let cooldownUntil = 0;
const queryQueue = [];
const queryStatusListeners = new Set();

export async function loadConfig() {
  if (config) return config;
  const response = await fetch("config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`could not load config.json (${response.status})`);
  config = await response.json();
  if (!config.endpoint) throw new Error("config.json is missing endpoint");
  return config;
}

export function getConfig() {
  if (!config) throw new Error("config.json not loaded yet");
  return config;
}

export function limit(name, fallback) {
  const limits = (config && config.limits) || {};
  const value = Number(limits[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Identifier authorities are discovered from the endpoint and may live outside
// the FIAF namespace in a future dataset. Keep the same injection-safe character
// set but allow any http(s) host.
const AUTHORITY_RE = /^https?:\/\/[^\s<>"{}|^`\\]+$/;
// Records reached from an expert query can use any scheme (fiaf:, http(s):,
// bundesarchiv:, ...). Reject only characters that could break out of <...>.
const ANY_IRI_RE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\]*$/;

export function sparqlIri(value) {
  // Record identifiers are not restricted to the vocabulary namespace.
  return sparqlAnyIri(value);
}

export function sparqlAuthorityIri(value) {
  const text = String(value || "");
  if (!AUTHORITY_RE.test(text)) {
    throw new Error(`refusing to emit an unsafe authority IRI: ${text}`);
  }
  return `<${text}>`;
}

export function sparqlAnyIri(value) {
  const text = String(value || "");
  if (!ANY_IRI_RE.test(text)) {
    throw new Error(`refusing to emit an unsafe IRI: ${text}`);
  }
  return `<${text}>`;
}

export function sparqlLiteral(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;
}

export function sparqlInt(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`expected a non-negative integer, got ${value}`);
  }
  return String(number);
}

export function roleFilter(roleIris) {
  if (!roleIris || roleIris.length === 0) return "FILTER(false)";
  return `FILTER(?role IN (${roleIris.map(sparqlIri).join(", ")}))`;
}

// Dataset scope for queries that bind ?work. No authority leaves the query
// unchanged; one or more authorities restrict it to works with an identifier
// from any of them. sparqlAuthorityIri validates the IRIs returned by scopes.rq.
export function datasetFilter(authorities) {
  const iris = (Array.isArray(authorities) ? authorities : authorities ? [authorities] : [])
    .filter(Boolean);
  if (!iris.length) return "";
  if (iris.length === 1) {
    return (
      "?work fiaf:hasIdentifier ?scopeIdentifier . " +
      `?scopeIdentifier fiaf:hasIdentifierAuthority ${sparqlAuthorityIri(iris[0])} .`
    );
  }
  return (
    "?work fiaf:hasIdentifier ?scopeIdentifier . " +
    "?scopeIdentifier fiaf:hasIdentifierAuthority ?scopeAuthority . " +
    `VALUES ?scopeAuthority { ${iris.map(sparqlAuthorityIri).join(" ")} }`
  );
}

// Structured filter clauses for the catalogue. Callers pass selected facet
// values and free text; IRIs and literals are escaped here, never assembled by
// the view. An empty result leaves the query unfiltered.
export function catalogueFilter(options = {}) {
  const parts = [];
  const title = String(options.title || "").trim();
  // Treat punctuation/spacing as separators, keeping Unicode letters, marks
  // and numbers. Substring checks retain partial-word search without needing
  // a text index or normalizing every title on the endpoint. Every term uses
  // the same binding so terms cannot match across different title variants.
  const titleTerms = [...new Set(title.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [])];
  if (titleTerms.length) {
    parts.push(
      "?work (rdfs:label|fiaf:hasTitle/fiaf:hasTitleValue) ?catalogueTitleMatch ."
    );
    for (const term of titleTerms) {
      parts.push(
        `FILTER(CONTAINS(LCASE(STR(?catalogueTitleMatch)), LCASE(${sparqlLiteral(term)})))`
      );
    }
  }
  const identifier = String(options.identifier || "").trim();
  if (identifier) {
    parts.push(
      "?work fiaf:hasIdentifier/fiaf:hasIdentifierValue ?catalogueIdentifierMatch ."
    );
    parts.push(
      `FILTER(CONTAINS(LCASE(STR(?catalogueIdentifierMatch)), LCASE(${sparqlLiteral(identifier)})))`
    );
  }
  const name = String(options.name || "").trim();
  if (name) {
    // Match agent labels first, as find.rq does: joining every credit before
    // filtering the label is much slower on a large dataset.
    parts.push(
      "?work fiaf:hasEvent/fiaf:hasActivity/fiaf:hasAgent ?catalogueNameAgent ."
    );
    parts.push("{\n    SELECT DISTINCT ?catalogueNameAgent\n    WHERE {");
    parts.push(
      "      ?catalogueNameAgent a ?catalogueNameType ;\n" +
        "                         rdfs:label ?catalogueNameMatch ."
    );
    parts.push(
      "      FILTER(?catalogueNameType IN (fiaf:Person, fiaf:Organisation, fiaf:Agent))"
    );
    parts.push(
      `      FILTER(CONTAINS(LCASE(STR(?catalogueNameMatch)), LCASE(${sparqlLiteral(name)})))`
    );
    parts.push("    }\n  }");
  }
  if (options.country) {
    parts.push(`?work fiaf:hasCountry ${sparqlIri(options.country)} .`);
  }
  if (options.form) {
    parts.push(`?work fiaf:hasForm ${sparqlIri(options.form)} .`);
  }
  if (options.genre) {
    parts.push(`?work fiaf:hasGenre ${sparqlIri(options.genre)} .`);
  }
  if (options.decade) {
    const prefix = String(options.decade).slice(0, 3);
    parts.push("?work fiaf:hasEvent ?catalogueEvent .");
    parts.push(
      "?catalogueEvent a fiaf:ProductionEvent ; fiaf:hasDate ?catalogueDate ."
    );
    parts.push(
      `FILTER(STRSTARTS(STR(?catalogueDate), ${sparqlLiteral(prefix)}))`
    );
  }
  if (options.format) {
    parts.push(
      "?work fiaf:hasManifestation ?catalogueFormatManifestation .\n" +
      "  ?catalogueFormatManifestation fiaf:hasItem ?catalogueFormatItem .\n" +
      "  { ?catalogueFormatItem fiaf:hasFormat ?catalogueRawFormat }\n" +
      "  UNION { ?catalogueFormatManifestation fiaf:hasFormat ?catalogueRawFormat }\n" +
      "  OPTIONAL { ?catalogueRawFormat a ?catalogueFormatType . FILTER(isBlank(?catalogueRawFormat)) }\n" +
      "  FILTER(!isBlank(?catalogueRawFormat) || BOUND(?catalogueFormatType))\n" +
      `  FILTER(IF(isBlank(?catalogueRawFormat), ?catalogueFormatType, ?catalogueRawFormat) = ${sparqlIri(options.format)})`
    );
  }
  if (options.institution) {
    parts.push(
      "?work fiaf:hasManifestation/fiaf:hasItem/fiaf:hasHoldingInstitution " +
        `${sparqlIri(options.institution)} .`
    );
  }
  if (options.agent) {
    parts.push(
      "?work fiaf:hasEvent/fiaf:hasActivity/fiaf:hasAgent " +
        `${sparqlIri(options.agent)} .`
    );
  }
  return parts.join("\n  ");
}

// Dataset scope for the name branch of find.rq: keep only names credited on a
// work in any selected dataset. ?id is the name variable in that query.
export function findAgentScopeFilter(authorities) {
  const scope = datasetFilter(authorities);
  if (!scope) return "";
  return (
    "?work a ?workType . " +
    scope +
    " ?work fiaf:hasEvent ?scopeEvent . " +
    "?scopeEvent fiaf:hasActivity ?scopeActivity . " +
    "?scopeActivity fiaf:hasAgent ?id ."
  );
}

export function iriList(iris) {
  if (!iris || iris.length === 0) return sparqlIri("https://dev.fiafcore.org/__none__");
  return iris.map(sparqlIri).join(" ");
}

// Full SELECT for the catalogue's SPARQL mode: the same query the faceted view
// runs, with its filters and dataset scope already composed.
export function catalogueQuery(options = {}) {
  const filter = options.filter || catalogueFilter(options);
  const scope = options.scope || "";
  const order = options.order || "?title ?work";
  const body = [scope, filter].filter(Boolean).join("\n  ");
  return `PREFIX fiaf: <https://dev.fiafcore.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?work (SAMPLE(?candidateTitle) AS ?title) (MIN(?rawYear) AS ?year)
WHERE {
  VALUES ?workType { fiaf:MonographicWork fiaf:Work }
  ?work a ?workType .
  ${body ? `${body}\n  ` : ""}OPTIONAL { ?work rdfs:label ?workLabel }
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
ORDER BY ${order}
LIMIT 500`;
}

// Lex only the structure needed by the expert editor. Comments, strings and
// IRI references are opaque; keywords inside them are never query modifiers.
function queryTokens(source) {
  const tokens = [];
  let index = 0;
  let depth = 0;
  while (index < source.length) {
    const start = index;
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "#") {
      while (index < source.length && !/[\r\n]/.test(source[index])) index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = source.startsWith(char.repeat(3), index) ? char.repeat(3) : char;
      index += quote.length;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "\\") { index += 2; continue; }
        if (source.startsWith(quote, index)) {
          index += quote.length;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) throw new Error("Unterminated SPARQL string.");
      tokens.push({ value: "<string>", start, end: index, depth });
      continue;
    }
    const iri = char === "<" && /^<[^<>"{}|^`\\\x00-\x20]*>/.exec(source.slice(index));
    if (iri) {
      index += iri[0].length;
      tokens.push({ value: "<iri>", start, end: index, depth });
      continue;
    }
    if ("{([".includes(char)) {
      tokens.push({ value: char, start, end: ++index, depth });
      depth += 1;
      continue;
    }
    if ("})]".includes(char)) {
      depth = Math.max(0, depth - 1);
      tokens.push({ value: char, start, end: ++index, depth });
      continue;
    }
    const word = /^[^\s{}()[\];,.<>=!+/*"'#]+/.exec(source.slice(index));
    index += word ? word[0].length : 1;
    tokens.push({ value: source.slice(start, index), start, end: index, depth });
  }
  return tokens;
}

function queryForm(tokens) {
  let index = 0;
  while (index < tokens.length) {
    const keyword = tokens[index].value.toUpperCase();
    if (keyword === "PREFIX") index += 3;
    else if (keyword === "BASE") index += 2;
    else return keyword;
  }
  return "";
}

// Add or replace only the outer solution limit, preserving comments and OFFSET.
export function withQueryLimit(text, maxRows, replace = false) {
  const source = String(text || "").trim();
  const value = sparqlInt(maxRows);
  const tokens = queryTokens(source);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.depth === 0 && token.value.toUpperCase() === "LIMIT" && /^\d+$/.test(next.value)) {
      if (!replace) return source;
      return source.slice(0, next.start) + value + source.slice(next.end);
    }
  }
  return `${source}\nLIMIT ${value}`;
}

// Expert-mode queries get common prefixes unless actually declared in code.
export function withPrefixes(text) {
  const query = String(text || "");
  const tokens = queryTokens(query);
  const declared = new Set();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index].depth === 0 && tokens[index].value.toUpperCase() === "PREFIX") {
      declared.add(tokens[index + 1].value);
    }
  }
  const declarations = [];
  if (!declared.has("fiaf:")) {
    declarations.push("PREFIX fiaf: <https://dev.fiafcore.org/>");
  }
  if (!declared.has("rdfs:")) {
    declarations.push("PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>");
  }
  if (!declared.has("rdf:")) {
    declarations.push("PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>");
  }
  if (!declared.has("xsd:")) {
    declarations.push("PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>");
  }
  return declarations.length ? `${declarations.join("\n")}\n\n${query}` : query;
}

function substitute(text, substitutions) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!(key in substitutions)) {
      throw new Error(`query placeholder ${match} has no value`);
    }
    return String(substitutions[key]);
  });
}

async function loadQuery(name) {
  if (queryText.has(name)) return queryText.get(name);
  const response = await fetch(`queries/${name}.rq`, { cache: "no-store" });
  if (!response.ok) throw new Error(`could not load queries/${name}.rq (${response.status})`);
  const text = await response.text();
  queryText.set(name, text);
  return text;
}

// POST one SPARQL string and return the parsed JSON payload. Shared by the
// bundled query files and expert-mode text so timeouts, rate limits and the
// busy indicator behave identically.
function abortError() {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function maxConcurrent() {
  return Math.max(1, Math.floor(limit("maxConcurrentRequests", 3)) || 3);
}

// Browser-side concurrency limit. Queries wait here instead of all hitting the
// public endpoint at once; a slot is released when the whole request (including
// retries) finishes.
function acquireSlot(signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(abortError());
      return;
    }
    const entry = { resolve, reject, signal, onAbort: null };
    entry.onAbort = () => {
      const index = queryQueue.indexOf(entry);
      if (index >= 0) queryQueue.splice(index, 1);
      reject(abortError());
    };
    if (signal) signal.addEventListener("abort", entry.onAbort, { once: true });
    queryQueue.push(entry);
    drainQueue();
  });
}

function releaseSlotEntry(entry) {
  if (entry.onAbort && entry.signal) {
    entry.signal.removeEventListener("abort", entry.onAbort);
  }
}

function drainQueue() {
  while (activeQueries < maxConcurrent() && queryQueue.length) {
    const entry = queryQueue.shift();
    if (entry.signal && entry.signal.aborted) {
      releaseSlotEntry(entry);
      entry.reject(abortError());
      continue;
    }
    releaseSlotEntry(entry);
    activeQueries += 1;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      activeQueries = Math.max(0, activeQueries - 1);
      drainQueue();
    });
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(abortError());
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelayMs(response, attempt) {
  const header = response.headers.get("Retry-After");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(60000, Math.max(0, seconds * 1000));
    }
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      return Math.min(60000, Math.max(0, date - Date.now()));
    }
  }
  const base = Math.max(250, limit("retryBaseMs", 1000));
  const exponential = base * 2 ** (attempt - 1);
  return Math.min(30000, exponential + Math.random() * 400);
}

// Emit a message every second while waiting, so the header and the expert
// status line show a live countdown instead of looking frozen.
async function waitForRetry(ms, signal, onStatus, attempt, attempts) {
  const end = performance.now() + ms;
  while (true) {
    const remaining = Math.max(0, end - performance.now());
    if (remaining <= 0) break;
    onStatus({
      kind: "retry",
      attempt,
      attempts,
      waitMs: remaining,
      message:
        `Endpoint rate-limiting — retrying in ${Math.ceil(remaining / 1000)}s ` +
        `(attempt ${Math.min(attempt + 1, attempts)} of ${attempts})…`
    });
    await sleep(Math.min(1000, remaining), signal);
  }
}

// After a final rate-limit response, keep a short global cooldown. A manual
// Retry then waits for the rate-limit window instead of immediately hitting the
// endpoint again and failing in the same way.
async function waitForCooldown(signal, onStatus) {
  while (true) {
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) break;
    onStatus({
      kind: "cooldown",
      waitMs: remaining,
      message:
        `Endpoint cooling down — waiting ${Math.ceil(remaining / 1000)}s…`
    });
    await sleep(Math.min(1000, remaining), signal);
  }
}

async function executeQuery(query, label, signal, options = {}) {
  const cfg = getConfig();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  const onStatus = (status) => {
    for (const listener of queryStatusListeners) {
      try {
        listener(status);
      } catch (_) {
        // A UI listener must never break the query.
      }
    }
    if (typeof options.onStatus === "function") {
      try {
        options.onStatus(status);
      } catch (_) {
        // Ignore status-handler failures.
      }
    }
  };
  const timeoutMs = limit("requestTimeoutMs", 90000);
  const attempts = Math.max(1, Math.floor(limit("requestRetries", 2)) + 1);
  activeRequests += 1;
  setBusy(activeRequests > 0);
  let release = null;
  try {
    if (activeQueries >= maxConcurrent()) {
      onStatus({
        kind: "queued",
        message: "Waiting for other queries to finish…"
      });
    }
    release = await acquireSlot(controller.signal);
    await waitForCooldown(controller.signal, onStatus);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let timedOut = false;
      const attemptTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        onStatus({
          kind: "attempt",
          attempt,
          attempts,
          message:
            attempt === 1
              ? "Running query…"
              : `Running query (attempt ${attempt} of ${attempts})…`
        });
        const response = await fetch(cfg.endpoint, {
          method: "POST",
          // A form-encoded POST with only safelisted headers is a "simple"
          // cross-origin request, so the browser sends no CORS preflight.
          // application/sparql-query would cost an extra OPTIONS round trip
          // per query, because the endpoint sets no Access-Control-Max-Age.
          headers: {
            Accept: "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
          },
          body: `query=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        const body = await response.text();
        if (response.ok) {
          try {
            const payload = JSON.parse(body);
            if (payload && typeof payload === "object") payloadChars.set(payload, body.length);
            return payload;
          } catch (error) {
            throw new Error(`${label}: response was not SPARQL JSON. ${body.slice(0, 200)}`);
          }
        }
        // QLever also uses 429 for exhausted query time budgets. Those are
        // expensive queries, not burst limits: retrying repeats the same work.
        let endpointException = "";
        try {
          endpointException = String(JSON.parse(body).exception || "");
        } catch (_) {
          // Proxies may return a non-JSON error body.
        }
        const queryTimeout =
          (response.status === 429 || response.status === 503) &&
          /timed out|time limit exceeded/i.test(endpointException);
        if (response.status === 502 || response.status === 504 || queryTimeout) {
          const error = new Error(
            `${label}: the endpoint could not finish this query ` +
              `(${response.status}). It may be too large for the public ` +
              "endpoint — try a smaller LIMIT or a narrower pattern."
          );
          error.code = "HEAVY_QUERY";
          error.status = response.status;
          throw error;
        }
        if (response.status === 429 || response.status === 503) {
          const waitMs = retryDelayMs(response, attempt);
          cooldownUntil = Math.max(cooldownUntil, Date.now() + waitMs);
          if (attempt < attempts) {
            await waitForRetry(waitMs, controller.signal, onStatus, attempt, attempts);
            continue;
          }
          const retry = response.headers.get("Retry-After");
          const error = new Error(
            `${label}: the FIAF endpoint is still rate-limiting this session ` +
              `after ${attempts} ${attempts === 1 ? "attempt" : "attempts"}.` +
              (retry
                ? ` Retry after ${retry} seconds.`
                : " Try again in a moment.")
          );
          error.code = "RATE_LIMITED";
          error.status = response.status;
          throw error;
        }
        throw new Error(
          `${label}: QLever answered ${response.status}. ${body.slice(0, 400)}`
        );
      } catch (error) {
        if (error.name === "AbortError") {
          if (signal && signal.aborted) throw error;
          if (timedOut) {
            throw new Error(
              `${label}: query timed out after ${timeoutMs} ms`
            );
          }
          throw error;
        }
        throw error;
      } finally {
        clearTimeout(attemptTimer);
      }
    }
    throw new Error(`${label}: the query did not complete.`);
  } finally {
    if (release) release();
    activeRequests = Math.max(0, activeRequests - 1);
    setBusy(activeRequests > 0);
    onStatus({ kind: "done" });
    if (signal) signal.removeEventListener("abort", abort);
  }
}

// Only bundled read-only queries use this cache; expert queries always run live.
// The complete query includes scope, filters and pagination in the cache key.
function rememberResult(key, payload, generation) {
  const ttl = limit("queryCacheTtlMs", 60000);
  const entries = limit("queryCacheEntries", 32);
  const budget = limit("queryCacheChars", 2000000);
  if (generation !== cacheGeneration || !ttl || !entries || !budget) return;
  const chars = key.length + (payloadChars.get(payload) ?? JSON.stringify(payload).length);
  if (chars > budget) return;
  const previous = queryResults.get(key);
  if (previous) resultCacheChars -= previous.chars;
  queryResults.delete(key);
  queryResults.set(key, { payload, chars, expires: Date.now() + ttl });
  resultCacheChars += chars;
  while (queryResults.size > entries || resultCacheChars > budget) {
    const oldest = queryResults.keys().next().value;
    resultCacheChars -= queryResults.get(oldest).chars;
    queryResults.delete(oldest);
  }
}

function bundledQuery(query, name, options) {
  const { signal } = options;
  if (signal && signal.aborted) return Promise.reject(abortError());
  if (options.cache === false) return executeQuery(query, name, signal, options);
  const key = JSON.stringify([getConfig().endpoint, query]);
  const cached = queryResults.get(key);
  if (cached) {
    if (cached.expires > Date.now()) {
      queryResults.delete(key);
      queryResults.set(key, cached);
      return Promise.resolve(cached.payload);
    }
    resultCacheChars -= cached.chars;
    queryResults.delete(key);
  }
  let entry = pendingQueries.get(key);
  if (!entry) {
    const controller = new AbortController();
    const generation = cacheGeneration;
    entry = { controller, listeners: new Set(), promise: null };
    pendingQueries.set(key, entry);
    entry.promise = Promise.resolve().then(() => executeQuery(query, name, controller.signal, {
      onStatus(status) {
        for (const listener of entry.listeners) {
          try { listener(status); } catch (_) { /* Keep other subscribers running. */ }
        }
      }
    })).then((payload) => {
      if (!controller.signal.aborted) rememberResult(key, payload, generation);
      return payload;
    }).finally(() => {
      if (pendingQueries.get(key) === entry) pendingQueries.delete(key);
    });
  }
  // Each caller owns its cancellation. Abort the shared request only when its
  // last subscriber leaves, including when the request is still queued.
  return new Promise((resolve, reject) => {
    const listener = typeof options.onStatus === "function" ? options.onStatus : () => {};
    // Wrap callbacks so two callers using the same function remain independent.
    const subscription = (status) => listener(status);
    entry.listeners.add(subscription);
    const cleanup = () => {
      entry.listeners.delete(subscription);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      if (!entry.listeners.size) {
        if (pendingQueries.get(key) === entry) pendingQueries.delete(key);
        entry.controller.abort();
      }
      reject(abortError());
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    entry.promise.then((payload) => {
      cleanup();
      if (signal && signal.aborted) reject(abortError());
      else resolve(payload);
    }, (error) => {
      cleanup();
      reject(error);
    });
  });
}

// Run queries/NAME.rq with {{PLACEHOLDER}} substitutions. An optional caller
// signal cancels superseded UI requests without changing the timeout behaviour.
export function runQuery(name, substitutions = {}, options = {}) {
  return loadQuery(name).then((text) => {
    const query = substitute(text, substitutions);
    return bundledQuery(query, name, options).then((payload) => {
      const vars = (payload.head && payload.head.vars) || [];
      return ((payload.results && payload.results.bindings) || []).map((row) => {
        const out = {};
        for (const variable of vars) {
          const term = row[variable];
          out[variable] = term ? term.value : undefined;
          if (term && term.datatype) out[`${variable}$type`] = term.datatype;
        }
        return out;
      });
    });
  });
}

// Run user-authored SPARQL. Only SELECT and ASK are accepted because the result
// table renders SPARQL JSON; CONSTRUCT/DESCRIBE would return RDF instead.
export async function runRawQuery(text, options = {}) {
  const source = String(text || "").trim();
  if (!source) throw new Error("Enter a SPARQL query first.");
  const form = queryForm(queryTokens(source));
  if (form !== "SELECT" && form !== "ASK") {
    throw new Error("Only SELECT and ASK queries are supported.");
  }
  let query = withPrefixes(source);
  // Protect the public endpoint and the browser from an unfiltered SELECT.
  // An explicit LIMIT in the query always wins.
  if (form === "SELECT") {
    query = withQueryLimit(query, limit("expertRows", 2000));
  }
  const started = performance.now();
  const payload = await executeQuery(
    query,
    "SPARQL query",
    options.signal,
    options
  );
  const elapsedMs = Math.max(0, Math.round(performance.now() - started));
  const vars = (payload.head && payload.head.vars) || [];
  const rows = ((payload.results && payload.results.bindings) || []).map((row) => {
    const out = {};
    for (const variable of vars) {
      const term = row[variable];
      out[variable] = term
        ? {
            value: term.value,
            type: term.type,
            datatype: term.datatype,
            lang: term["xml:lang"]
          }
        : null;
    }
    return out;
  });
  return {
    vars,
    rows,
    elapsedMs,
    boolean: typeof payload.boolean === "boolean" ? payload.boolean : undefined
  };
}

// Small hook so the header can show a spinner without importing the UI module.
const busyListeners = new Set();
export function onBusy(listener) {
  busyListeners.add(listener);
}
function setBusy(busy) {
  for (const listener of busyListeners) listener(busy);
}

// Retry/queue notifications for the header and the expert query status line.
export function onQueryStatus(listener) {
  queryStatusListeners.add(listener);
}

export function clearQueryCache() {
  queryText.clear();
  queryResults.clear();
  resultCacheChars = 0;
  cacheGeneration += 1;
  // Existing callers may finish, but new calls must not reuse old requests.
  pendingQueries.clear();
}
