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
