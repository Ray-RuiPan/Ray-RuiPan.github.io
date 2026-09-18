const CATEGORIES = [
  { id: "cs.AR", className: "cat-cs-ar" },
  { id: "cs.DC", className: "cat-cs-dc" },
  { id: "cs.NI", className: "cat-cs-ni" },
  { id: "cs.PL", className: "cat-cs-pl" },
  { id: "cs.OS", className: "cat-cs-os" },
];

const els = {
  statusText: document.querySelector("#statusText"),
  searchInput: document.querySelector("#searchInput"),
  savedCount: document.querySelector("#savedCount"),
  paperList: document.querySelector("#paperList"),
  emptyState: document.querySelector("#emptyState"),
};

const storage = {
  saved: "paper-review:saved",
  savedPapers: "paper-review:saved-papers",
};

const state = {
  query: "",
  saved: loadSet(storage.saved),
  savedPapers: loadSavedPapers(),
};

function loadSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

function saveSet(key, value) {
  localStorage.setItem(key, JSON.stringify([...value]));
}

function loadSavedPapers() {
  try {
    return JSON.parse(localStorage.getItem(storage.savedPapers) || "{}");
  } catch {
    return {};
  }
}

function saveSavedPapers() {
  localStorage.setItem(storage.savedPapers, JSON.stringify(state.savedPapers));
}

function normalize(value) {
  return String(value || "").toLowerCase();
}

function categoryClass(categoryId) {
  return CATEGORIES.find((category) => category.id === categoryId)?.className || "cat-other";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function hydrateFromLatestData() {
  if (!state.saved.size) return;

  try {
    const response = await fetch(`../data/papers.json?ts=${Date.now()}`);
    if (!response.ok) return;
    const data = await response.json();
    const papers = Array.isArray(data.papers) ? data.papers : [];
    let changed = false;

    papers.forEach((paper) => {
      if (state.saved.has(paper.id) && !state.savedPapers[paper.id]) {
        state.savedPapers[paper.id] = {
          paper,
          savedAt: new Date().toISOString(),
        };
        changed = true;
      }
    });

    if (changed) saveSavedPapers();
  } catch {
    // Local saved records are still usable if the latest data fetch fails.
  }
}

function getSavedList() {
  const query = normalize(state.query);
  return Object.values(state.savedPapers)
    .map((record) => ({
      paper: record.paper,
      savedAt: record.savedAt || "",
    }))
    .filter(({ paper }) => state.saved.has(paper.id))
    .filter(({ paper }) => {
      if (!query) return true;
      const haystack = normalize(
        [
          paper.title,
          paper.id,
          paper.summary,
          paper.primaryCategory,
          ...(Array.isArray(paper.authors) ? paper.authors : []),
        ].join(" ")
      );
      return haystack.includes(query);
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function render() {
  const visible = getSavedList();
  els.savedCount.textContent = String(state.saved.size);
  els.paperList.textContent = "";
  visible.forEach(({ paper }) => els.paperList.append(createPaperCard(paper)));
  els.emptyState.hidden = visible.length !== 0;
  els.statusText.textContent = "已同步";
}

function createPaperCard(paper) {
  const card = document.createElement("article");
  card.className = "paper-card";

  const header = document.createElement("div");
  header.className = "paper-header";

  const titleArea = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "paper-title";
  title.textContent = paper.title || paper.id;

  const meta = document.createElement("div");
  meta.className = "paper-meta";
  const authorText = (paper.authors || []).join(", ") || "作者未知";
  meta.textContent = `${formatDate(paper.published)} · ${authorText}`;

  titleArea.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "paper-actions";
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "text-button";
  removeButton.textContent = "移除收藏";
  removeButton.addEventListener("click", () => removeSaved(paper.id));
  actions.append(removeButton);

  header.append(titleArea, actions);

  const badges = document.createElement("div");
  badges.className = "badges";
  if (paper.announceType) {
    const badge = document.createElement("span");
    badge.className = "badge update";
    badge.textContent = paper.announceType;
    badges.append(badge);
  }
  (paper.categories || []).forEach((category) => {
    const badge = document.createElement("span");
    badge.className = `badge category-badge ${categoryClass(category)}`;
    badge.textContent = category;
    badges.append(badge);
  });

  const abstract = createAbstract(paper.summary);

  const links = document.createElement("div");
  links.className = "paper-links";
  links.append(createLink("Abstract", paper.absUrl), createLink("PDF", paper.pdfUrl));

  card.append(header, badges);
  if (abstract) card.append(abstract);
  card.append(links);
  return card;
}

function createAbstract(summaryText) {
  if (!summaryText) return null;

  const details = document.createElement("details");
  details.className = "abstract-block";

  const summary = document.createElement("summary");
  summary.textContent = "摘要";

  const content = document.createElement("p");
  content.className = "summary";
  content.textContent = summaryText;

  details.append(summary, content);
  return details;
}

function createLink(label, href) {
  const link = document.createElement("a");
  link.href = href || "#";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  if (!href) link.setAttribute("aria-disabled", "true");
  return link;
}

function removeSaved(id) {
  state.saved.delete(id);
  delete state.savedPapers[id];
  saveSet(storage.saved, state.saved);
  saveSavedPapers();
  render();
}

function wireEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
}

async function init() {
  wireEvents();
  await hydrateFromLatestData();
  render();
}

init();
