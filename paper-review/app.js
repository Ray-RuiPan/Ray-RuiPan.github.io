const CATEGORIES = [
  { id: "cs.AR", label: "Architecture" },
  { id: "cs.DC", label: "Distributed Computing" },
  { id: "cs.NI", label: "Networking" },
  { id: "cs.PL", label: "Programming Languages" },
  { id: "cs.OS", label: "Operating Systems" },
];

const els = {
  statusText: document.querySelector("#statusText"),
  reloadButton: document.querySelector("#reloadButton"),
  dateSelect: document.querySelector("#dateSelect"),
  searchInput: document.querySelector("#searchInput"),
  typeSelect: document.querySelector("#typeSelect"),
  categoryFilters: document.querySelector("#categoryFilters"),
  unreadOnly: document.querySelector("#unreadOnly"),
  savedOnly: document.querySelector("#savedOnly"),
  totalCount: document.querySelector("#totalCount"),
  visibleCount: document.querySelector("#visibleCount"),
  unreadCount: document.querySelector("#unreadCount"),
  generatedAt: document.querySelector("#generatedAt"),
  paperList: document.querySelector("#paperList"),
  emptyState: document.querySelector("#emptyState"),
};

const storage = {
  read: "paper-review:read",
  saved: "paper-review:saved",
};

const state = {
  papers: [],
  meta: {},
  archive: [],
  selectedPath: "data/papers.json",
  activeCategories: new Set(CATEGORIES.map((category) => category.id)),
  query: "",
  announceType: "all",
  unreadOnly: false,
  savedOnly: false,
  read: loadSet(storage.read),
  saved: loadSet(storage.saved),
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

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalize(value) {
  return String(value || "").toLowerCase();
}

function createCategoryFilters() {
  els.categoryFilters.textContent = "";
  CATEGORIES.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-button";
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
  els.statusText.textContent = "已同步";
  render();
}

function getFilteredPapers() {
  const query = normalize(state.query);

  return state.papers.filter((paper) => {
    const paperCategories = Array.isArray(paper.categories) ? paper.categories : [];
    const categoryMatch = paperCategories.some((category) => state.activeCategories.has(category));
    if (!categoryMatch) return false;

    if (state.unreadOnly && state.read.has(paper.id)) return false;
    if (state.savedOnly && !state.saved.has(paper.id)) return false;
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
  const unread = state.papers.filter((paper) => !state.read.has(paper.id)).length;

  els.totalCount.textContent = String(state.papers.length);
  els.visibleCount.textContent = String(visible.length);
  els.unreadCount.textContent = String(unread);
  els.generatedAt.textContent = formatDateTime(state.meta.generatedAt);

  els.paperList.textContent = "";
  visible.forEach((paper) => els.paperList.append(createPaperCard(paper)));

  els.emptyState.hidden = visible.length !== 0;
}

function createPaperCard(paper) {
  const card = document.createElement("article");
  card.className = "paper-card";
  if (state.read.has(paper.id)) card.classList.add("is-read");

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
    createToggleButton("未读", "已读", state.read.has(paper.id), () => toggleRead(paper.id)),
    createToggleButton("收藏", "已收藏", state.saved.has(paper.id), () => toggleSaved(paper.id))
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
    badge.className = category === paper.primaryCategory ? "badge primary" : "badge";
    badge.textContent = category;
    badges.append(badge);
  });

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = paper.summary || "";

  const links = document.createElement("div");
  links.className = "paper-links";
  links.append(createLink("Abstract", paper.absUrl), createLink("PDF", paper.pdfUrl));

  card.append(header, badges, summary, links);
  return card;
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

function toggleRead(id) {
  if (state.read.has(id)) {
    state.read.delete(id);
  } else {
    state.read.add(id);
  }
  saveSet(storage.read, state.read);
  render();
}

function toggleSaved(id) {
  if (state.saved.has(id)) {
    state.saved.delete(id);
  } else {
    state.saved.add(id);
  }
  saveSet(storage.saved, state.saved);
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

  els.unreadOnly.addEventListener("change", (event) => {
    state.unreadOnly = event.target.checked;
    render();
  });

  els.savedOnly.addEventListener("change", (event) => {
    state.savedOnly = event.target.checked;
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
