// View groups: the top navigation names the kind of data (works, people,
// holdings), and the views inside a group are the different ways of drawing
// it. A view can belong to more than one group (the world map is both the
// overview and the works "where"); the first group that lists it is its home,
// which is where an old single-view link such as #cloud lands.
//
// A view shared by two groups can take a "unit" ("works" or "items") so it
// shows only that group's side of the data: Breakdowns and Heatmaps list work
// panels under Works and item panels under Holdings.
//
// Hashes are "#group/view", or just "#group" when the group has one view.
// Pure: no DOM, so the routing can be tested on its own.

export const GROUPS = [
  {
    id: "overview",
    label: "Overview",
    views: [{ view: "worldmap", label: "World map" }]
  },
  {
    id: "works",
    label: "Works",
    views: [
      { view: "timeline", label: "Timeline" },
      { view: "worldmap", label: "Map" },
      { view: "breakdowns", label: "Breakdowns", unit: "works" },
      { view: "geography", label: "Heatmaps", unit: "works" }
    ]
  },
  {
    id: "people",
    label: "People",
    views: [
      { view: "cloud", label: "Name cloud" },
      { view: "roles", label: "Roles" },
      { view: "network", label: "Names & works" },
      { view: "co-credits", label: "Co-credits" }
    ]
  },
  {
    id: "holdings",
    label: "Holdings",
    views: [
      { view: "breakdowns", label: "Breakdowns", unit: "items" },
      { view: "geography", label: "Heatmaps", unit: "items" },
      { view: "length", label: "Kilometres" },
      { view: "preservation", label: "Preservation" }
    ]
  },
  {
    id: "catalogue",
    label: "Catalogue",
    views: [{ view: "catalogue", label: "Catalogue" }]
  },
  {
    id: "ontology",
    label: "Ontology",
    views: [{ view: "ontology", label: "Ontology" }]
  }
];

const always = () => true;

// The groups with at least one available view, each keeping only those views.
export function availableGroups(isAvailable = always) {
  return GROUPS
    .map((group) => ({ ...group, views: group.views.filter((entry) => isAvailable(entry.view)) }))
    .filter((group) => group.views.length);
}

function findGroup(id, isAvailable) {
  return availableGroups(isAvailable).find((group) => group.id === id) || null;
}

// The first available group that shows this view.
export function homeGroup(view, isAvailable = always) {
  const group = availableGroups(isAvailable).find((candidate) =>
    candidate.views.some((entry) => entry.view === view)
  );
  return group ? group.id : null;
}

export function groupHasView(groupId, view, isAvailable = always) {
  const group = findGroup(groupId, isAvailable);
  return Boolean(group && group.views.some((entry) => entry.view === view));
}

// The unit a view shows in a group, or null when it shows everything.
export function unitFor(groupId, view) {
  const group = GROUPS.find((candidate) => candidate.id === groupId);
  const entry = group && group.views.find((candidate) => candidate.view === view);
  return (entry && entry.unit) || null;
}

export function hashFor(groupId, view, isAvailable = always) {
  const group = findGroup(groupId, isAvailable);
  if (!group) return "";
  return group.views.length === 1 ? `#${group.id}` : `#${group.id}/${view}`;
}

// Hash to { group, view }, or null when it names nothing available. Accepts
// "#group/view", "#group" (its first view) and the old "#view" links.
export function parseHash(hash, isAvailable = always) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return null;
  const [first, second] = raw.split("/");
  const group = findGroup(first, isAvailable);
  if (group) {
    const entry = (second && group.views.find((candidate) => candidate.view === second)) || group.views[0];
    return { group: group.id, view: entry.view };
  }
  const home = homeGroup(first, isAvailable);
  return home ? { group: home, view: first } : null;
}
