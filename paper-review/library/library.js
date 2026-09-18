const DEFAULT_COLLECTION_ID = "default";
const DEFAULT_COLLECTION_NAME = "默认收藏夹";
const ALL_TRACKS = "all";
const UNTRACKED_LABEL = "未标注 Track";

const els = {
  statusText: document.querySelector("#statusText"),
  reloadButton: document.querySelector("#reloadButton"),
  searchInput: document.querySelector("#searchInput"),
  segmentButtons: [...document.querySelectorAll(".segment-button")],
  venueNav: document.querySelector("#venueNav"),
  totalCount: document.querySelector("#totalCount"),
  venueCount: document.querySelector("#venueCount"),
  yearCount: document.querySelector("#yearCount"),
  trackCount: document.querySelector("#trackCount"),
  libraryNote: document.querySelector("#libraryNote"),
  overviewSection: document.querySelector("#overviewSection"),
  venueGrid: document.querySelector("#venueGrid"),
  detailSection: document.querySelector("#detailSection"),
  detailEyebrow: document.querySelector("#detailEyebrow"),
  detailTitle: document.querySelector("#detailTitle"),
  detailMeta: document.querySelector("#detailMeta"),
  yearPills: document.querySelector("#yearPills"),
  trackSummary: document.querySelector("#trackSummary"),
  paperList: document.querySelector("#paperList"),
  emptyState: document.querySelector("#emptyState"),
  visibleCount: document.querySelector("#visibleCount"),
  backButton: document.querySelector("#backButton"),
  clearRouteButton: document.querySelector("#clearRouteButton"),
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
  venue: "",
  year: "",
  track: ALL_TRACKS,
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

function displayTrack(record) {
  return record.track || UNTRACKED_LABEL;
}

function sourceFullName(source) {
  return source.fullName || source.journalName || source.name || source.shortName || source.id;
}

function allSources() {
  const conferences = state.sources.conferences || [];
  return [
    ...conferences.map((source, index) => ({ ...source, kind: "conference", order: index })),
    ...(state.sources.journals || []).map((source, index) => ({
      ...source,
      kind: "journal",
      order: conferences.length + index,
    })),
  ];
}

function sourceById(id) {
  return allSources().find((source) => source.id === id) || null;
}

function sourceLabel(source) {
  if (!source) return "";
  return source.shortName || source.name || source.id;
}

function routeFromHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  state.venue = params.get("venue") || "";
  state.year = params.get("year") || "";
  state.track = params.get("track") || ALL_TRACKS;
}

function setRoute({ venue = "", year = "", track = ALL_TRACKS }) {
  const params = new URLSearchParams();
  if (venue) params.set("venue", venue);
  if (year) params.set("year", year);
  if (track && track !== ALL_TRACKS) params.set("track", track);
  const nextHash = params.toString();

  state.venue = venue;
  state.year = year;
  state.track = track || ALL_TRACKS;

  if (window.location.hash.replace(/^#/, "") !== nextHash) {
    window.location.hash = nextHash;
  } else {
    render();
  }
}

async function loadLibrary() {
  els.statusText.textContent = "加载中";
  const response = await fetch(`../data/library/index.json?ts=${Date.now()}`);
  if (!response.ok) throw new Error("Cannot load paper library");
  const data = await response.json();
  state.records = normalizeRecords(Array.isArray(data.records) ? data.records : []);
  state.meta = data.meta || {};
  state.sources = data.sources || { conferences: [], journals: [] };
  hydrateSavedPapers();
  routeFromHash();
  els.statusText.textContent = formatDateTime(state.meta.generatedAt);
  render();
}

function normalizeRecords(records) {
  return records.map((record) => ({
    ...record,
    year: record.year ? Number(record.year) : "",
    track: record.track || UNTRACKED_LABEL,
  }));
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

function recordMatchesKind(record) {
  return state.kind === "all" || record.kind === state.kind;
}

function recordMatchesQuery(record) {
  const query = normalize(state.query);
  if (!query) return true;
  const haystack = normalize(
    [
      record.title,
      record.venue,
      record.venueName,
      record.journalName,
      displayTrack(record),
      record.month,
      record.doi,
      record.dblpKey,
      ...(Array.isArray(record.authors) ? record.authors : []),
    ].join(" ")
  );
  return haystack.includes(query);
}

function filteredRecords() {
  return state.records.filter((record) => recordMatchesKind(record) && recordMatchesQuery(record));
}

function recordsForVenue(venue = state.venue) {
  return filteredRecords().filter((record) => record.venue === venue);
}

function recordsForCurrentYear() {
  return recordsForVenue().filter((record) => String(record.year) === state.year);
}

function recordsForCurrentTrack() {
  const base = recordsForCurrentYear();
  if (state.track === ALL_TRACKS) return base;
  return base.filter((record) => displayTrack(record) === state.track);
}

function venueStats() {
  const records = filteredRecords();
  const byVenue = new Map();

  allSources().forEach((source) => {
    if (state.kind !== "all" && source.kind !== state.kind) return;
    byVenue.set(source.id, {
      source,
      records: [],
      years: new Map(),
      tracks: new Map(),
    });
  });

  records.forEach((record) => {
    if (!byVenue.has(record.venue)) {
      byVenue.set(record.venue, {
        source: {
          id: record.venue,
          name: record.venueName || record.venue,
          kind: record.kind,
          area: record.area || "",
        },
        records: [],
        years: new Map(),
        tracks: new Map(),
      });
    }
    const bucket = byVenue.get(record.venue);
    bucket.records.push(record);
    const year = String(record.year || "");
    if (year) bucket.years.set(year, (bucket.years.get(year) || 0) + 1);
    const track = displayTrack(record);
    bucket.tracks.set(track, (bucket.tracks.get(track) || 0) + 1);
  });

  return [...byVenue.values()].sort((a, b) => {
    const orderA = Number.isFinite(a.source.order) ? a.source.order : 9999;
    const orderB = Number.isFinite(b.source.order) ? b.source.order : 9999;
    if (orderA !== orderB) return orderA - orderB;
    return sourceLabel(a.source).localeCompare(sourceLabel(b.source), "zh-CN", { numeric: true });
  });
}

function availableYears(records) {
  return [...new Set(records.map((record) => String(record.year)).filter(Boolean))].sort((a, b) =>
    b.localeCompare(a, "zh-CN", { numeric: true })
  );
}

function trackGroups(records) {
  const groups = new Map();
  records.forEach((record) => {
    const track = displayTrack(record);
    if (!groups.has(track)) groups.set(track, []);
    groups.get(track).push(record);
  });
  return [...groups.entries()]
    .map(([track, records]) => ({ track, records: sortPapers(records) }))
    .sort((a, b) => b.records.length - a.records.length || a.track.localeCompare(b.track, "zh-CN"));
}

function sortPapers(records) {
  return [...records].sort((a, b) => {
    const dateCompare = String(b.published || "").localeCompare(String(a.published || ""));
    if (dateCompare !== 0) return dateCompare;
    return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
  });
}

function updateMetrics() {
  const records = filteredRecords();
  const venues = new Set(records.map((record) => record.venue));
  const periods = new Set(records.map((record) => (record.kind === "journal" ? record.month : record.year)).filter(Boolean));
  const tracks = new Set(records.map((record) => displayTrack(record)));

  els.totalCount.textContent = String(records.length);
  els.venueCount.textContent = String(venues.size);
  els.yearCount.textContent = String(periods.size);
  els.trackCount.textContent = String(tracks.size);
  els.statusText.textContent = formatDateTime(state.meta.generatedAt);
}

function render() {
  updateMetrics();
  renderKindButtons();
  renderVenueNav();

  els.libraryNote.hidden = state.records.length !== 0;
  if (!state.records.length) {
    els.libraryNote.textContent = "论文库数据尚未回填。可以在 GitHub Actions 手动运行 Update Paper Library data 并选择 backfill=true。";
  }

  const source = sourceById(state.venue);
  if (!state.venue || (source && state.kind !== "all" && source.kind !== state.kind)) {
    state.venue = "";
    state.year = "";
    state.track = ALL_TRACKS;
    renderOverview();
    return;
  }

  renderDetail();
}

function renderKindButtons() {
  els.segmentButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.kind === state.kind));
  });
}

function renderVenueNav() {
  els.venueNav.textContent = "";

  const groups = groupBy(
    venueStats(),
    (item) => (item.source.kind === "journal" ? "期刊" : "会议")
  );

  ["会议", "期刊"].forEach((label) => {
    const items = groups.get(label) || [];
    if (!items.length) return;

    const group = document.createElement("div");
    group.className = "venue-nav-group";

    const heading = document.createElement("div");
    heading.className = "venue-nav-heading";
    heading.textContent = label;
    group.append(heading);

    const list = document.createElement("div");
    list.className = "venue-nav-list";
    items.forEach((item) => list.append(createVenueNavButton(item)));
    group.append(list);
    els.venueNav.append(group);
  });
}

function createVenueNavButton(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "venue-nav-button";
  button.setAttribute("aria-pressed", String(item.source.id === state.venue));
  button.addEventListener("click", () => {
    setRoute({ venue: item.source.id, year: "", track: ALL_TRACKS });
  });

  const name = document.createElement("span");
  name.className = "venue-nav-name";
  name.textContent = sourceLabel(item.source);

  const count = document.createElement("span");
  count.className = "venue-nav-count";
  count.textContent = String(item.records.length);

  button.append(name, count);
  return button;
}

function renderOverview() {
  els.overviewSection.hidden = false;
  els.detailSection.hidden = true;
  els.venueGrid.textContent = "";

  const items = venueStats();
  const withRecords = items.filter((item) => item.records.length).length;
  const hint = document.createElement("div");
  hint.className = "overview-hint-card";

  const title = document.createElement("h3");
  title.textContent = "左侧已列出全部会议和期刊";

  const body = document.createElement("p");
  body.textContent = `共 ${items.length} 个 venue，其中 ${withRecords} 个已有回填数据。选择一个会议或期刊后，再选择年份，并按官方 proceedings/issue 的 Track 查看论文。`;

  const note = document.createElement("p");
  note.textContent = `没有官方 Track 映射的记录会暂时显示为“${UNTRACKED_LABEL}”。`;

  hint.append(title, body, note);
  els.venueGrid.append(hint);
}

function createVenueCard(item) {
  const card = document.createElement("article");
  card.className = "venue-card";

  const top = document.createElement("div");
  top.className = "venue-card-top";

  const label = document.createElement("span");
  label.className = `badge ${item.source.kind === "journal" ? "source-badge" : "venue-badge"}`;
  label.textContent = item.source.kind === "journal" ? "期刊" : "会议";

  const count = document.createElement("span");
  count.className = "venue-card-count";
  count.textContent = `${item.records.length} 篇`;
  top.append(label, count);

  const title = document.createElement("h3");
  title.textContent = sourceLabel(item.source);

  const subtitle = document.createElement("p");
  subtitle.textContent = sourceFullName(item.source);

  const meta = document.createElement("div");
  meta.className = "venue-card-meta";
  meta.textContent = [item.source.area, `${item.years.size} 个年份`, `${item.tracks.size} 个 track`]
    .filter(Boolean)
    .join(" · ");

  const years = document.createElement("div");
  years.className = "year-chip-row";
  const yearEntries = [...item.years.entries()].sort((a, b) => b[0].localeCompare(a[0], "zh-CN", { numeric: true }));
  if (yearEntries.length) {
    yearEntries.slice(0, 8).forEach(([year, count]) => years.append(createYearChip(item.source.id, year, count)));
  } else {
    const empty = document.createElement("span");
    empty.className = "muted-pill";
    empty.textContent = "等待回填";
    years.append(empty);
  }

  card.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    const firstYear = yearEntries[0]?.[0] || "";
    setRoute({ venue: item.source.id, year: firstYear, track: ALL_TRACKS });
  });

  card.append(top, title, subtitle, meta, years);
  return card;
}

function createYearChip(venue, year, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "year-chip";
  button.textContent = `${year} (${count})`;
  button.addEventListener("click", () => setRoute({ venue, year, track: ALL_TRACKS }));
  return button;
}

function renderDetail() {
  const source = sourceById(state.venue);
  const venueRecords = recordsForVenue();
  const years = availableYears(venueRecords);
  if (state.year && !years.includes(state.year)) state.year = "";

  const yearRecords = recordsForCurrentYear();
  const visibleRecords = recordsForCurrentTrack();

  els.overviewSection.hidden = true;
  els.detailSection.hidden = false;
  els.detailEyebrow.textContent = source?.kind === "journal" ? "Journal" : "Conference";
  els.detailTitle.textContent = `${sourceLabel(source) || state.venue}${state.year ? ` ${state.year}` : ""}`;
  els.detailMeta.textContent = [
    sourceFullName(source || {}),
    source?.area,
    `${venueRecords.length} 篇`,
    `${years.length} 个年份`,
  ]
    .filter(Boolean)
    .join(" · ");

  renderYearPills(years);
  if (!state.year) {
    els.trackSummary.textContent = "";
    els.paperList.textContent = "";
    els.visibleCount.textContent = years.length ? "请选择年份" : "等待回填";
    els.emptyState.textContent = years.length ? "请选择上方年份后查看论文。" : "这个会议/期刊当前还没有回填数据。";
    els.emptyState.hidden = false;
    return;
  }

  renderTrackSummary(trackGroups(yearRecords));
  renderPaperGroups(trackGroups(visibleRecords));
  els.visibleCount.textContent = `${visibleRecords.length} 篇`;
  els.emptyState.textContent = "没有匹配的论文";
  els.emptyState.hidden = visibleRecords.length !== 0;
}

function renderYearPills(years) {
  els.yearPills.textContent = "";
  years.forEach((year) => {
    const count = recordsForVenue().filter((record) => String(record.year) === year).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "year-pill";
    button.setAttribute("aria-pressed", String(year === state.year));
    button.textContent = `${year} (${count})`;
    button.addEventListener("click", () => setRoute({ venue: state.venue, year, track: ALL_TRACKS }));
    els.yearPills.append(button);
  });
}

function renderTrackSummary(groups) {
  els.trackSummary.textContent = "";
  if (!groups.length) return;

  const allButton = createTrackButton("全部 track", groups.reduce((sum, group) => sum + group.records.length, 0), ALL_TRACKS);
  els.trackSummary.append(allButton);
  groups.forEach((group) => els.trackSummary.append(createTrackButton(group.track, group.records.length, group.track)));
}

function createTrackButton(label, count, track) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "track-row";
  button.setAttribute("aria-pressed", String(state.track === track));
  button.addEventListener("click", () => setRoute({ venue: state.venue, year: state.year, track }));

  const name = document.createElement("span");
  name.textContent = label;

  const number = document.createElement("strong");
  number.textContent = String(count);

  button.append(name, number);
  return button;
}

function renderPaperGroups(groups) {
  els.paperList.textContent = "";
  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "record-group";

    const heading = document.createElement("div");
    heading.className = "record-group-heading";

    const title = document.createElement("h2");
    title.textContent = group.track;

    const count = document.createElement("span");
    count.textContent = `${group.records.length}`;

    heading.append(title, count);
    section.append(heading);
    group.records.forEach((paper) => section.append(createPaperCard(paper)));
    els.paperList.append(section);
  });
}

function createPaperCard(paper) {
  const card = document.createElement("article");
  card.className = "paper-card";

  const header = document.createElement("div");
  header.className = "paper-header";

  const titleArea = document.createElement("div");
  const title = document.createElement("h3");
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
  if (paper.month) badges.append(createBadge(paper.month, "track-badge"));
  badges.append(createBadge(displayTrack(paper), "track-badge"));

  const links = document.createElement("div");
  links.className = "paper-links";
  if (paper.dblpUrl) links.append(createLink("DBLP", paper.dblpUrl));
  if (paper.doi) links.append(createLink("DOI", `https://doi.org/${paper.doi}`));
  if (!paper.doi && paper.url && paper.url !== paper.dblpUrl) links.append(createLink("Publisher", paper.url));

  card.append(header, badges);
  if (paper.summary) card.append(createAbstract(paper.summary));
  if (links.childElementCount) card.append(links);
  return card;
}

function paperMetaText(paper) {
  const authorText = (paper.authors || []).join(", ") || "作者未知";
  const venue = paper.venueName || paper.venue || "";
  if (paper.kind === "conference") {
    return `${venue} ${paper.year || ""} · ${displayTrack(paper)} · ${authorText}`;
  }
  const issue = [paper.volume && `Vol. ${paper.volume}`, paper.issue && `No. ${paper.issue}`]
    .filter(Boolean)
    .join(", ");
  return `${venue} ${paper.month || formatDate(paper.published)} · ${displayTrack(paper)}${issue ? ` · ${issue}` : ""} · ${authorText}`;
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

function groupBy(items, keyFn) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return groups;
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

  window.addEventListener("hashchange", () => {
    routeFromHash();
    render();
  });

  els.segmentButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.kind = button.dataset.kind || "all";
      const source = sourceById(state.venue);
      if (source && state.kind !== "all" && source.kind !== state.kind) {
        setRoute({});
      } else {
        render();
      }
    });
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

  els.backButton.addEventListener("click", () => setRoute({}));
  els.clearRouteButton.addEventListener("click", () => setRoute({}));
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
