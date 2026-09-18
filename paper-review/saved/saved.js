const CATEGORIES = [
  { id: "cs.AR", className: "cat-cs-ar" },
  { id: "cs.DC", className: "cat-cs-dc" },
  { id: "cs.NI", className: "cat-cs-ni" },
  { id: "cs.PL", className: "cat-cs-pl" },
  { id: "cs.OS", className: "cat-cs-os" },
];

const ALL_COLLECTION_ID = "all";
const DEFAULT_COLLECTION_ID = "default";
const DEFAULT_COLLECTION_NAME = "默认收藏夹";

const els = {
  statusText: document.querySelector("#statusText"),
  searchInput: document.querySelector("#searchInput"),
  savedCount: document.querySelector("#savedCount"),
  savedScope: document.querySelector("#savedScope"),
  collectionTabs: document.querySelector("#collectionTabs"),
  collectionForm: document.querySelector("#collectionForm"),
  newCollectionInput: document.querySelector("#newCollectionInput"),
  paperList: document.querySelector("#paperList"),
  emptyState: document.querySelector("#emptyState"),
};

const storage = {
  saved: "paper-review:saved",
  savedPapers: "paper-review:saved-papers",
  collections: "paper-review:collections",
};

const state = {
  query: "",
  selectedCollectionId: ALL_COLLECTION_ID,
  saved: loadSet(storage.saved),
  savedPapers: loadSavedPapers(),
  collections: loadCollections(),
};

migrateSavedSetToCollections();

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

function loadCollections() {
  try {
    return normalizeCollections(JSON.parse(localStorage.getItem(storage.collections) || "{}"));
  } catch {
    return createDefaultCollections();
  }
}

function createDefaultCollections() {
  return {
    collections: [{ id: DEFAULT_COLLECTION_ID, name: DEFAULT_COLLECTION_NAME }],
    paperCollections: {},
  };
}

function normalizeCollections(data) {
  const normalized = createDefaultCollections();
  const sourceCollections = Array.isArray(data.collections) ? data.collections : [];

  sourceCollections.forEach((collection) => {
    const id = String(collection.id || "").trim();
    const name = String(collection.name || "").trim();
    if (!id || !name || normalized.collections.some((item) => item.id === id)) return;
    normalized.collections.push({ id, name });
  });

  const validIds = new Set(normalized.collections.map((collection) => collection.id));
  const sourcePaperCollections =
    data.paperCollections && typeof data.paperCollections === "object" ? data.paperCollections : {};

  Object.entries(sourcePaperCollections).forEach(([paperId, collectionIds]) => {
    const ids = [...new Set(Array.isArray(collectionIds) ? collectionIds : [])].filter((id) =>
      validIds.has(id)
    );
    if (ids.length) normalized.paperCollections[paperId] = ids;
  });

  return normalized;
}

function saveCollections() {
  localStorage.setItem(storage.collections, JSON.stringify(state.collections));
}

function migrateSavedSetToCollections() {
  let changed = false;

  state.saved.forEach((paperId) => {
    if (getPaperCollectionIds(paperId).length) return;
    state.collections.paperCollections[paperId] = [DEFAULT_COLLECTION_ID];
    changed = true;
  });

  if (changed) saveCollections();
  syncSavedSet();
}

function getPaperCollectionIds(paperId) {
  const validIds = new Set(state.collections.collections.map((collection) => collection.id));
  return [...new Set(state.collections.paperCollections[paperId] || [])].filter((id) => validIds.has(id));
}

function isPaperSaved(paperId) {
  return getPaperCollectionIds(paperId).length > 0;
}

function syncSavedSet() {
  state.saved = new Set(
    Object.entries(state.collections.paperCollections)
      .filter(([, collectionIds]) => Array.isArray(collectionIds) && collectionIds.length > 0)
      .map(([paperId]) => paperId)
  );
  saveSet(storage.saved, state.saved);
}

function cleanupOrphanSavedPapers() {
  Object.keys(state.savedPapers).forEach((paperId) => {
    if (!isPaperSaved(paperId)) delete state.savedPapers[paperId];
  });
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
      if (isPaperSaved(paper.id) && !state.savedPapers[paper.id]) {
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

function selectedCollection() {
  if (state.selectedCollectionId === ALL_COLLECTION_ID) return null;
  return state.collections.collections.find((collection) => collection.id === state.selectedCollectionId) || null;
}

function ensureSelectedCollection() {
  if (state.selectedCollectionId === ALL_COLLECTION_ID) return;
  if (!selectedCollection()) state.selectedCollectionId = ALL_COLLECTION_ID;
}

function getSavedList() {
  const query = normalize(state.query);
  const selectedId = state.selectedCollectionId;

  return Object.values(state.savedPapers)
    .map((record) => ({
      paper: record.paper,
      savedAt: record.savedAt || "",
    }))
    .filter(({ paper }) => paper && isPaperSaved(paper.id))
    .filter(({ paper }) => {
      if (selectedId === ALL_COLLECTION_ID) return true;
      return getPaperCollectionIds(paper.id).includes(selectedId);
    })
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

function countPapersInCollection(collectionId) {
  if (collectionId === ALL_COLLECTION_ID) return state.saved.size;
  return Object.keys(state.collections.paperCollections).filter((paperId) =>
    getPaperCollectionIds(paperId).includes(collectionId)
  ).length;
}

function render() {
  ensureSelectedCollection();
  renderCollectionTabs();

  const visible = getSavedList();
  const currentCollection = selectedCollection();
  els.savedCount.textContent = String(visible.length);
  els.savedScope.textContent = currentCollection ? currentCollection.name : "全部收藏";

  els.paperList.textContent = "";
  visible.forEach(({ paper }) => els.paperList.append(createPaperCard(paper)));
  els.emptyState.hidden = visible.length !== 0;
  els.statusText.textContent = "已同步";
}

function renderCollectionTabs() {
  els.collectionTabs.textContent = "";
  els.collectionTabs.append(createCollectionTab({ id: ALL_COLLECTION_ID, name: "全部" }));

  state.collections.collections.forEach((collection) => {
    els.collectionTabs.append(createCollectionTab(collection));
  });
}

function createCollectionTab(collection) {
  const item = document.createElement("div");
  item.className = "collection-tab-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "collection-tab";
  button.setAttribute("aria-pressed", String(state.selectedCollectionId === collection.id));
  button.textContent = `${collection.name} ${countPapersInCollection(collection.id)}`;
  button.addEventListener("click", () => {
    state.selectedCollectionId = collection.id;
    render();
  });
  item.append(button);

  if (collection.id !== ALL_COLLECTION_ID && collection.id !== DEFAULT_COLLECTION_ID) {
    item.classList.add("is-deletable");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "collection-delete";
    deleteButton.textContent = "×";
    deleteButton.title = `删除${collection.name}`;
    deleteButton.setAttribute("aria-label", `删除${collection.name}`);
    deleteButton.addEventListener("click", () => deleteCollection(collection.id));
    item.append(deleteButton);
  }

  return item;
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
  removeButton.textContent = state.selectedCollectionId === ALL_COLLECTION_ID ? "移除收藏" : "移出收藏夹";
  removeButton.addEventListener("click", () => {
    if (state.selectedCollectionId === ALL_COLLECTION_ID) {
      removePaperFromAllCollections(paper.id);
    } else {
      removePaperFromCollection(paper.id, state.selectedCollectionId);
    }
  });
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

function createCollection(name) {
  const trimmed = name.trim();
  if (!trimmed) return;

  const exists = state.collections.collections.some(
    (collection) => collection.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (exists) {
    els.statusText.textContent = "收藏夹已存在";
    return;
  }

  const id = `collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  state.collections.collections.push({ id, name: trimmed });
  state.selectedCollectionId = id;
  els.newCollectionInput.value = "";
  saveCollections();
  render();
}

function deleteCollection(collectionId) {
  const collection = state.collections.collections.find((item) => item.id === collectionId);
  if (!collection || collection.id === DEFAULT_COLLECTION_ID) return;

  if (!confirm(`删除收藏夹「${collection.name}」？其中的文章会从这个收藏夹移除。`)) return;

  state.collections.collections = state.collections.collections.filter((item) => item.id !== collectionId);
  Object.entries(state.collections.paperCollections).forEach(([paperId, collectionIds]) => {
    const remainingIds = collectionIds.filter((id) => id !== collectionId);
    if (remainingIds.length) {
      state.collections.paperCollections[paperId] = remainingIds;
    } else {
      delete state.collections.paperCollections[paperId];
    }
  });

  if (state.selectedCollectionId === collectionId) state.selectedCollectionId = ALL_COLLECTION_ID;
  cleanupOrphanSavedPapers();
  saveCollections();
  syncSavedSet();
  saveSavedPapers();
  render();
}

function removePaperFromCollection(paperId, collectionId) {
  const collectionIds = getPaperCollectionIds(paperId).filter((id) => id !== collectionId);

  if (collectionIds.length) {
    state.collections.paperCollections[paperId] = collectionIds;
  } else {
    delete state.collections.paperCollections[paperId];
    delete state.savedPapers[paperId];
  }

  saveCollections();
  syncSavedSet();
  saveSavedPapers();
  render();
}

function removePaperFromAllCollections(paperId) {
  delete state.collections.paperCollections[paperId];
  delete state.savedPapers[paperId];
  saveCollections();
  syncSavedSet();
  saveSavedPapers();
  render();
}

function wireEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  els.collectionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createCollection(els.newCollectionInput.value);
  });
}

async function init() {
  wireEvents();
  await hydrateFromLatestData();
  render();
}

init();
