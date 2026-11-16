// Pure record models shared by drawer rendering and chart selection.
import { roleLabel } from "./labels.js";

export function agentHistory(rows, summary) {
  return {
    rows,
    works: Number(summary.find((row) => !row.role)?.works) || 0,
    roleTotals: summary.filter((row) => row.role).map((row) => ({
      role: row.role,
      works: Number(row.works) || 0
    })).sort((a, b) =>
      b.works - a.works || roleLabel(a.role).localeCompare(roleLabel(b.role))
    )
  };
}

export function workAgentModel(rows) {
  const agents = new Map();
  for (const row of rows) {
    if (!agents.has(row.agent)) {
      agents.set(row.agent, {
        agent: row.agent,
        name: row.name || row.agent,
        roles: new Set()
      });
    }
    if (row.role) agents.get(row.agent).roles.add(row.role);
  }
  const items = [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
  // Selection consumers require an array (and test its length), not a Set.
  return { agentIds: items.map((item) => item.agent), items, limited: rows.length >= 1000 };
}

// Items (credited names or works, each with a `roles` Set) grouped by role for
// the drawer's Overview lists. An item with several roles appears under each;
// one with none goes under a null role at the end.
//
// Roles follow `roleOrder` when given (a name's roles, busiest first); any
// others, and every role when no order is given, come smallest group first,
// the way film credits list the director before the cast. `compare` sorts the
// items inside a role.
export function groupByRole(items, { roleOrder = [], compare } = {}) {
  const groups = new Map();
  for (const item of items) {
    const roles = item.roles && item.roles.size ? [...item.roles] : [null];
    for (const role of roles) {
      if (!groups.has(role)) groups.set(role, []);
      groups.get(role).push(item);
    }
  }
  const rank = new Map(roleOrder.map((role, index) => [role, index]));
  const label = (role) => (role ? roleLabel(role) : "");
  return [...groups.entries()]
    .map(([role, members]) => ({
      role,
      items: compare ? [...members].sort(compare) : members
    }))
    .sort((a, b) => {
      if ((a.role === null) !== (b.role === null)) return a.role === null ? 1 : -1;
      const ra = rank.has(a.role) ? rank.get(a.role) : Infinity;
      const rb = rank.has(b.role) ? rank.get(b.role) : Infinity;
      if (ra !== rb) return ra - rb;
      return a.items.length - b.items.length || label(a.role).localeCompare(label(b.role));
    });
}
