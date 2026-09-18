const CATEGORIES = [
  { id: "cs.AR", label: "Architecture", className: "cat-cs-ar" },
  { id: "cs.DC", label: "Distributed Computing", className: "cat-cs-dc" },
  { id: "cs.NI", label: "Networking", className: "cat-cs-ni" },
  { id: "cs.PL", label: "Programming Languages", className: "cat-cs-pl" },
  { id: "cs.OS", label: "Operating Systems", className: "cat-cs-os" },
];

const els = {
  statusText: document.querySelector("#statusText"),
  reloadButton: document.querySelector("#reloadButton"),
  dateSelect: document.querySelector("#dateSelect"),
  searchInput: document.querySelector("#searchInput"),
  typeSelect: document.querySelector("#typeSelect"),
  categoryFilters: document.querySelector("#categoryFilters"),
  totalCount: document.querySelector("#totalCount"),
  visibleCount: document.querySelector("#visibleCount"),
  generatedAt: document.querySelector("#generatedAt"),
  paperList: document.querySelector("#paperList"),
  emptyState: document.querySelector("#emptyState"),
};

const storage = {
  saved: "paper-review:saved",
  savedPapers: "paper-review:saved-papers",
};

const state = {
  papers: [],
  meta: {},
  archive: [],
  selectedPath: "data/papers.json",
  activeCategories: new Set(CATEGORIES.map((category) => category.id)),
  query: "",
  announceType: "all",
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

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date) + " BJT"
  );
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

function normalize(value) {
  return String(value || "").toLowerCase();
}

function categoryClass(categoryId) {
  return CATEGORIES.find((category) => category.id === categoryId)?.className || "cat-other";
}

function createCategoryFilters() {
  els.categoryFilters.textContent = "";
  CATEGORIES.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-button ${category.className}`;
    button.setAttribute("aria-pressed", "true");
    button.dataset.category = category.id;

    const name = document.createElement("span");
    name.className = "category-name";
    name.textContent = category.id;

    const label = document.createElement("span");
    label.className = "category-label";
    label.textContent = category.label;

    button.append(name, label);
    button.addEventListener("click", () => {
      if (state.activeCategories.has(category.id)) {
        state.activeCategories.delete(category.id);
      } else {
        state.activeCategories.add(category.id);
      }
      button.setAttribute("aria-pressed", String(state.activeCategories.has(category.id)));
      render();
    });

    els.categoryFilters.append(button);
  });
}

async function loadArchiveIndex() {
  try {
    const response = await fetch(`data/archive-index.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error("archive index unavailable");
    const data = await response.json();
    state.archive = Array.isArray(data.snapshots) ? data.snapshots : [];
  } catch {
    state.archive = [];
  }

  renderDateOptions();
}

function renderDateOptions() {
  els.dateSelect.textContent = "";

  const latest = document.createElement("option");
  latest.value = "data/papers.json";
  latest.textContent = "最新";
  els.dateSelect.append(latest);

  state.archive.forEach((snapshot) => {
    const option = document.createElement("option");
    option.value = snapshot.path;
    option.textContent = `${snapshot.date} (${snapshot.count})`;
    els.dateSelect.append(option);
  });

  els.dateSelect.value = state.selectedPath;
}

async function loadPapers(path = state.selectedPath) {
  state.selectedPath = path;
  els.statusText.textContent = "加载中";

  const response = await fetch(`${path}?ts=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Cannot load ${path}`);
  }

  const data = await response.json();
  state.papers = Array.isArray(data.papers) ? data.papers : [];
  state.meta = data.meta || {};
  hydrateSavedPapers();
  els.statusText.textContent = "已同步";
  render();
}

function hydrateSavedPapers() {
  let changed = false;
  state.papers.forEach((paper) => {
    if (state.saved.has(paper.id) && !state.savedPapers[paper.id]) {
      state.savedPapers[paper.id] = {
        paper,
        savedAt: new Date().toISOString(),
      };
      changed = true;
    }
  });
  if (changed) saveSavedPapers();
}

function getFilteredPapers() {
  const query = normalize(state.query);

  return state.papers.filter((paper) => {
    const paperCategories = Array.isArray(paper.categories) ? paper.categories : [];
    const categoryMatch = paperCategories.some((category) => state.activeCategories.has(category));
    if (!categoryMatch) return false;
    if (state.announceType !== "all" && paper.announceType !== state.announceType) return false;

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
  });
}

function render() {
  const visible = getFilteredPapers();

  els.totalCount.textContent = String(state.papers.length);
  els.visibleCount.textContent = String(visible.length);
  els.generatedAt.textContent = formatDateTime(state.meta.generatedAt);

  els.paperList.textContent = "";
  visible.forEach((paper) => els.paperList.append(createPaperCard(paper)));

  els.emptyState.hidden = visible.length !== 0;
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
  actions.append(
    createToggleButton("收藏", "已收藏", state.saved.has(paper.id), () => toggleSaved(paper))
  );

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

function createToggleButton(inactiveLabel, activeLabel, pressed, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button";
  button.setAttribute("aria-pressed", String(pressed));
  button.textContent = pressed ? activeLabel : inactiveLabel;
  button.addEventListener("click", onClick);
  return button;
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

function toggleSaved(paper) {
  if (state.saved.has(paper.id)) {
    state.saved.delete(paper.id);
    delete state.savedPapers[paper.id];
  } else {
    state.saved.add(paper.id);
    state.savedPapers[paper.id] = {
      paper,
      savedAt: new Date().toISOString(),
    };
  }
  saveSet(storage.saved, state.saved);
  saveSavedPapers();
  render();
}

function wireEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  els.typeSelect.addEventListener("change", (event) => {
    state.announceType = event.target.value;
    render();
  });

  els.dateSelect.addEventListener("change", async (event) => {
    try {
      await loadPapers(event.target.value);
    } catch (error) {
      els.statusText.textContent = "加载失败";
      console.error(error);
    }
  });

  els.reloadButton.addEventListener("click", async () => {
    try {
      await loadArchiveIndex();
      await loadPapers(state.selectedPath);
    } catch (error) {
      els.statusText.textContent = "加载失败";
      console.error(error);
    }
  });
}

async function init() {
  createCategoryFilters();
  wireEvents();

  try {
    await loadArchiveIndex();
    await loadPapers();
  } catch (error) {
    els.statusText.textContent = "加载失败";
    console.error(error);
    render();
  }
}

init();
