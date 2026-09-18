const DEFAULT_COLLECTION_ID = "default";
const DEFAULT_COLLECTION_NAME = "默认收藏夹";

const els = {
  statusText: document.querySelector("#statusText"),
  reloadButton: document.querySelector("#reloadButton"),
  kindSelect: document.querySelector("#kindSelect"),
  venueSelect: document.querySelector("#venueSelect"),
  yearSelect: document.querySelector("#yearSelect"),
  trackSelect: document.querySelector("#trackSelect"),
  searchInput: document.querySelector("#searchInput"),
  totalCount: document.querySelector("#totalCount"),
  visibleCount: document.querySelector("#visibleCount"),
  conferenceCount: document.querySelector("#conferenceCount"),
  journalCount: document.querySelector("#journalCount"),
  libraryNote: document.querySelector("#libraryNote"),
  paperList: document.querySelector("#paperList"),
  emptyState: document.querySelector("#emptyState"),
};

const storage = {
  saved: "paper-review:saved",
  savedPapers: "paper-review:saved-papers",
  collections: "paper-review:collections",
};

const state = {
  records: [],
  meta: {},
  sources: { conferences: [], journals: [] },
  kind: "all",
  venue: "all",
  year: "all",
  track: "all",
  query: "",
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

function addPaperToCollection(paper, collectionId) {
  const collectionIds = new Set(getPaperCollectionIds(paper.id));
  collectionIds.add(collectionId);
  state.collections.paperCollections[paper.id] = [...collectionIds];
  state.savedPapers[paper.id] = {
    paper,
    savedAt: state.savedPapers[paper.id]?.savedAt || new Date().toISOString(),
  };
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

function normalize(value) {
  return String(value || "").toLowerCase();
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

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date) + " BJT"
  );
}

async function loadLibrary() {
  els.statusText.textContent = "加载中";
  const response = await fetch(`../data/library/index.json?ts=${Date.now()}`);
  if (!response.ok) throw new Error("Cannot load paper library");
  const data = await response.json();
  state.records = Array.isArray(data.records) ? data.records : [];
  state.meta = data.meta || {};
  state.sources = data.sources || { conferences: [], journals: [] };
  hydrateSavedPapers();
  renderFilterOptions();
  els.statusText.textContent = "已同步";
  render();
}

function hydrateSavedPapers() {
  let changed = false;
  state.records.forEach((paper) => {
    if (isPaperSaved(paper.id) && !state.savedPapers[paper.id]) {
      state.savedPapers[paper.id] = {
        paper,
        savedAt: new Date().toISOString(),
      };
      changed = true;
    }
  });
  if (changed) saveSavedPapers();
}

function availableRecordsForOptions() {
  return state.records.filter((record) => {
    if (state.kind !== "all" && record.kind !== state.kind) return false;
    if (state.venue !== "all" && record.venue !== state.venue) return false;
    if (state.year !== "all" && String(record.year) !== state.year) return false;
    return true;
  });
}

function setOptions(select, values, allLabel, currentValue) {
  const uniqueValues = [...new Set(values.filter(Boolean))].sort((a, b) =>
    String(b).localeCompare(String(a), "zh-CN", { numeric: true })
  );

  select.textContent = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = allLabel;
  select.append(all);

  uniqueValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });

  select.value = uniqueValues.includes(currentValue) ? currentValue : "all";
  return select.value;
}

function renderFilterOptions() {
  const recordsByKind = state.kind === "all" ? state.records : state.records.filter((record) => record.kind === state.kind);
  const venueLabels = new Map(recordsByKind.map((record) => [record.venue, record.venueName || record.venue]));

  els.venueSelect.textContent = "";
  const allVenue = document.createElement("option");
  allVenue.value = "all";
  allVenue.textContent = "全部";
  els.venueSelect.append(allVenue);
  [...venueLabels.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "zh-CN"))
    .forEach(([id, label]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = label;
      els.venueSelect.append(option);
    });
  if (!venueLabels.has(state.venue)) state.venue = "all";
  els.venueSelect.value = state.venue;

  const recordsForYear = recordsByKind.filter((record) => state.venue === "all" || record.venue === state.venue);
  state.year = setOptions(els.yearSelect, recordsForYear.map((record) => String(record.year)), "全部年份", state.year);

  const recordsForTrack = availableRecordsForOptions();
  state.track = setOptions(
    els.trackSelect,
    recordsForTrack.map((record) => (record.kind === "conference" ? record.track : record.month)),
    "全部 track / 月份",
    state.track
  );
}

function getFilteredRecords() {
  const query = normalize(state.query);

  return state.records.filter((record) => {
    if (state.kind !== "all" && record.kind !== state.kind) return false;
    if (state.venue !== "all" && record.venue !== state.venue) return false;
    if (state.year !== "all" && String(record.year) !== state.year) return false;
    const trackValue = record.kind === "conference" ? record.track : record.month;
    if (state.track !== "all" && trackValue !== state.track) return false;

    if (!query) return true;
    const haystack = normalize(
      [
        record.title,
        record.venue,
        record.venueName,
        record.journalName,
        record.track,
        record.month,
        record.doi,
        record.dblpKey,
        ...(Array.isArray(record.authors) ? record.authors : []),
      ].join(" ")
    );
    return haystack.includes(query);
  });
}

function render() {
  const visible = getFilteredRecords();
  els.totalCount.textContent = String(state.records.length);
  els.visibleCount.textContent = String(visible.length);
  els.conferenceCount.textContent = String(state.meta.conferenceCount || 0);
  els.journalCount.textContent = String(state.meta.journalCount || 0);
  els.statusText.textContent = formatDateTime(state.meta.generatedAt);

  els.libraryNote.hidden = state.records.length !== 0;
  if (!state.records.length) {
    els.libraryNote.textContent = "论文库数据尚未回填。可以在 GitHub Actions 手动运行 Update Paper Library data 并选择 backfill=true。";
  }

  els.paperList.textContent = "";
  renderRecordGroups(visible);
  els.emptyState.hidden = visible.length !== 0 || state.records.length === 0;
}

function renderRecordGroups(records) {
  const groups = groupRecords(records);
  groups.forEach((group) => els.paperList.append(createRecordGroup(group)));
}

function groupRecords(records) {
  const groups = new Map();
  records.forEach((record) => {
    const key = recordGroupKey(record);
    if (!groups.has(key)) {
      groups.set(key, { key, label: recordGroupLabel(record), records: [] });
    }
    groups.get(key).records.push(record);
  });
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key, "zh-CN", { numeric: true }));
}

function recordGroupKey(record) {
  const dateKey = record.kind === "journal" ? record.month || record.published || "" : String(record.year || "");
  const groupValue = record.kind === "conference" ? record.track || "Uncategorized" : record.month || "";
  return [dateKey, record.venue || "", groupValue].join("|");
}

function recordGroupLabel(record) {
  const venue = record.venueName || record.venue || "";
  if (record.kind === "journal") {
    return `${venue} ${record.month || formatDate(record.published)}`;
  }
  return `${venue} ${record.year || ""} · ${record.track || "Uncategorized"}`;
}

function createRecordGroup(group) {
  const section = document.createElement("section");
  section.className = "record-group";

  const heading = document.createElement("div");
  heading.className = "record-group-heading";

  const title = document.createElement("h2");
  title.textContent = group.label;

  const count = document.createElement("span");
  count.textContent = `${group.records.length}`;

  heading.append(title, count);
  section.append(heading);
  group.records.forEach((paper) => section.append(createPaperCard(paper)));
  return section;
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
  meta.textContent = paperMetaText(paper);

  titleArea.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "paper-actions";
  actions.append(createCollectionPicker(paper));

  header.append(titleArea, actions);

  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(createBadge(paper.kind === "conference" ? "会议" : "期刊", "source-badge"));
  badges.append(createBadge(paper.venueName || paper.venue, "venue-badge"));
  if (paper.year) badges.append(createBadge(String(paper.year), "year-badge"));
  if (paper.kind === "conference" && paper.track) badges.append(createBadge(paper.track, "track-badge"));
  if (paper.kind === "journal" && paper.month) badges.append(createBadge(paper.month, "track-badge"));

  const links = document.createElement("div");
  links.className = "paper-links";
  if (paper.dblpUrl) links.append(createLink("DBLP", paper.dblpUrl));
  if (paper.doi) links.append(createLink("DOI", `https://doi.org/${paper.doi}`));
  if (paper.url && paper.url !== paper.dblpUrl) links.append(createLink("Publisher", paper.url));

  card.append(header, badges);
  if (paper.summary) card.append(createAbstract(paper.summary));
  if (links.childElementCount) card.append(links);
  return card;
}

function paperMetaText(paper) {
  const authorText = (paper.authors || []).join(", ") || "作者未知";
  const venue = paper.venueName || paper.venue || "";
  if (paper.kind === "conference") {
    return `${venue} ${paper.year || ""} · ${paper.track || "Uncategorized"} · ${authorText}`;
  }
  const issue = [paper.volume && `Vol. ${paper.volume}`, paper.issue && `No. ${paper.issue}`]
    .filter(Boolean)
    .join(", ");
  return `${venue} ${paper.month || formatDate(paper.published)}${issue ? ` · ${issue}` : ""} · ${authorText}`;
}

function createBadge(label, className) {
  const badge = document.createElement("span");
  badge.className = `badge ${className}`;
  badge.textContent = label;
  return badge;
}

function createAbstract(summaryText) {
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

function createCollectionPicker(paper) {
  const selectedIds = new Set(getPaperCollectionIds(paper.id));
  const saved = selectedIds.size > 0;

  const picker = document.createElement("details");
  picker.className = "favorite-picker";

  const summary = document.createElement("summary");
  summary.className = "star-button";
  summary.textContent = saved ? "★" : "☆";
  summary.title = saved ? "调整收藏夹" : "选择收藏夹";
  summary.setAttribute("aria-label", saved ? "调整收藏夹" : "选择收藏夹");
  summary.setAttribute("aria-pressed", String(saved));

  const menu = document.createElement("div");
  menu.className = "collection-menu";

  state.collections.collections.forEach((collection) => {
    const row = document.createElement("label");
    row.className = "collection-choice";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIds.has(collection.id);
    checkbox.addEventListener("change", (event) => {
      if (event.target.checked) {
        addPaperToCollection(paper, collection.id);
      } else {
        removePaperFromCollection(paper.id, collection.id);
      }
    });

    const name = document.createElement("span");
    name.textContent = collection.name;

    row.append(checkbox, name);
    menu.append(row);
  });

  const manageLink = document.createElement("a");
  manageLink.className = "collection-manage-link";
  manageLink.href = "../saved/";
  manageLink.textContent = "管理收藏夹";
  menu.append(manageLink);

  picker.append(summary, menu);
  return picker;
}

function closeOpenCollectionPickers(exceptPicker = null) {
  document.querySelectorAll(".favorite-picker[open]").forEach((picker) => {
    if (picker !== exceptPicker) picker.removeAttribute("open");
  });
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

function wireEvents() {
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      closeOpenCollectionPickers();
      return;
    }
    const picker = event.target.closest(".favorite-picker");
    closeOpenCollectionPickers(picker);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeOpenCollectionPickers();
  });

  els.kindSelect.addEventListener("change", (event) => {
    state.kind = event.target.value;
    state.venue = "all";
    state.year = "all";
    state.track = "all";
    renderFilterOptions();
    render();
  });

  els.venueSelect.addEventListener("change", (event) => {
    state.venue = event.target.value;
    state.year = "all";
    state.track = "all";
    renderFilterOptions();
    render();
  });

  els.yearSelect.addEventListener("change", (event) => {
    state.year = event.target.value;
    state.track = "all";
    renderFilterOptions();
    render();
  });

  els.trackSelect.addEventListener("change", (event) => {
    state.track = event.target.value;
    render();
  });

  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  els.reloadButton.addEventListener("click", async () => {
    try {
      await loadLibrary();
    } catch (error) {
      els.statusText.textContent = "加载失败";
      console.error(error);
    }
  });
}

async function init() {
  wireEvents();
  try {
    await loadLibrary();
  } catch (error) {
    els.statusText.textContent = "加载失败";
    console.error(error);
    render();
  }
}

init();
