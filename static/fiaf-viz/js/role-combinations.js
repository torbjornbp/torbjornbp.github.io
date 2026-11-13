// Role combinations for People › Roles: which roles the same name holds.
// Pure functions over role-pairs.rq (?roleSet ?names) and the most-roles
// queries, so they can be tested without a browser.

export const FIAF = "https://dev.fiafcore.org/";
export const OTHER = "__other";
// Roles drawn as their own arc; smaller ones share an Other arc.
export const CHORD_ROLES = 14;

// Role sets as sorted IRI arrays with their name counts. GROUP_CONCAT gives
// no order, so the same set can come back spelled two ways; those merge.
export function roleSets(rows) {
  const sets = new Map();
  for (const row of rows) {
    const names = Number(row.names) || 0;
    if (!row.roleSet || names <= 0) continue;
    const roles = [...new Set(String(row.roleSet).split("|").filter(Boolean))]
      .map((name) => FIAF + name)
      .sort();
    const key = roles.join("|");
    const entry = sets.get(key);
    if (entry) entry.names += names;
    else sets.set(key, { roles, names });
  }
  return [...sets.values()];
}

// The chord for the roles in `include`. Each name counts once in every pair
// of its included roles, so a name in three roles adds to three ribbons.
// Beyond `maxRoles`, the roles with fewest combining names merge into
// OTHER: its ribbons are names credited in that role and in any of the
// smaller roles.
export function roleChord(sets, include = () => true, maxRoles = CHORD_ROLES) {
  const named = new Map(); // names credited in the role at all
  const combining = new Map(); // ...and in at least one other included role
  let names = 0;
  let multi = 0;
  const kept = [];
  for (const set of sets) {
    const roles = set.roles.filter(include);
    if (!roles.length) continue;
    names += set.names;
    for (const role of roles) named.set(role, (named.get(role) || 0) + set.names);
    if (roles.length < 2) continue;
    multi += set.names;
    for (const role of roles) combining.set(role, (combining.get(role) || 0) + set.names);
    kept.push({ roles, names: set.names });
  }
  const ranked = [...combining.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([role]) => role);
  const merged = ranked.length > maxRoles;
  const shown = merged ? ranked.slice(0, maxRoles - 1) : ranked;
  const index = new Map(shown.map((role, position) => [role, position]));
  const list = merged ? [...shown, OTHER] : shown;
  const matrix = list.map(() => list.map(() => 0));
  const otherRoles = new Set();
  for (const set of kept) {
    const slots = new Set();
    for (const role of set.roles) {
      if (index.has(role)) slots.add(index.get(role));
      else {
        slots.add(list.length - 1);
        otherRoles.add(role);
      }
    }
    const positions = [...slots];
    for (let a = 0; a < positions.length; a += 1) {
      for (let b = a + 1; b < positions.length; b += 1) {
        matrix[positions[a]][positions[b]] += set.names;
        matrix[positions[b]][positions[a]] += set.names;
      }
    }
  }
  return {
    roles: list,
    matrix,
    names,
    multi,
    named: list.map((role) =>
      role === OTHER ? null : named.get(role) || 0
    ),
    combining: list.map((role) =>
      role === OTHER ? null : combining.get(role) || 0
    ),
    otherRoles: [...otherRoles].sort()
  };
}

const OTHER_COLOUR = "var(--role-other)";

// Fills for the chord's arcs, in arc order. Roles keep the colour the rest
// of the site gives them; roles outside the eight colours, which would all
// share one light grey, take turns through three darker neutral greys so
// that neighbouring arcs differ and each passes 3:1. OTHER keeps the light
// grey (the chart outlines it) as the remainder.
export function chordColours(roles, colorFor) {
  let neutral = 0;
  return roles.map((role) => {
    if (role === OTHER) return OTHER_COLOUR;
    const colour = colorFor(role);
    if (colour !== OTHER_COLOUR) return colour;
    neutral += 1;
    return `var(--role-neutral-${((neutral - 1) % 3) + 1})`;
  });
}

// The most-roles list: agents-most-roles.rq rows (?agent ?name ?roles) with
// agent-role-works.rq rows (?agent ?role ?works; ?role "" is any role).
export function mostRoles(listRows, workRows = []) {
  const works = new Map();
  for (const row of workRows) {
    if (!works.has(row.agent)) works.set(row.agent, { total: 0, byRole: [] });
    const entry = works.get(row.agent);
    const count = Number(row.works) || 0;
    if (!row.role) entry.total = count;
    else entry.byRole.push({ role: row.role, works: count });
  }
  const seen = new Set();
  const entries = [];
  for (const row of listRows) {
    if (!row.agent || seen.has(row.agent)) continue;
    seen.add(row.agent);
    const found = works.get(row.agent);
    entries.push({
      agent: row.agent,
      name: row.name || row.agent,
      roles: Number(row.roles) || 0,
      works: found ? found.total : null,
      byRole: found
        ? found.byRole.slice().sort((a, b) => b.works - a.works || a.role.localeCompare(b.role))
        : []
    });
  }
  return entries.sort(
    (a, b) =>
      b.roles - a.roles ||
      (b.works ?? 0) - (a.works ?? 0) ||
      a.name.localeCompare(b.name)
  );
}
