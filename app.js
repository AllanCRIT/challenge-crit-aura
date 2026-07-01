/* =========================================================
   CRIT CHALLENGE — app.js
   Lecture du fichier Excel, calcul des classements, rendu UI.
   Aucune intervention technique nécessaire pour mettre à jour
   les données : il suffit de modifier data/data.xlsx.
   ========================================================= */

(() => {
  "use strict";

  // ---------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------
  const CONFIG = {
    dataPath: "data/data.xlsx",
    refreshIntervalMs: 30000,
    // Pondération utilisée uniquement pour le "score global" affiché
    // dans le tableau de bord (les 3 classements restent indépendants
    // et utilisent directement le compteur brut de chaque catégorie).
    weights: { nouveauxClients: 10, clientsMouvementes: 5, mandats: 15 },
    metrics: [
      { key: "nouveauxClients", label: "Nouveaux clients", short: "NC" },
      { key: "clientsMouvementes", label: "Clients mouvementés", short: "CM" },
      { key: "mandats", label: "Mandats signés", short: "MS" },
    ],
  };

  const state = {
    rawRows: [],       // lignes brutes de la feuille "Classement"
    boosters: [],       // lignes brutes de la feuille "Boosters"
    dates: [],           // liste triée des dates disponibles (desc)
    filters: { search: "", secteur: "", departement: "", date: "", tri: "score", affichage: "10" },
    views: { nouveauxClients: "podium", clientsMouvementes: "podium", mandats: "podium" },
    lastFetchOk: false,
  };

  // ---------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function fmtDate(d) {
    if (!(d instanceof Date) || isNaN(d)) return "—";
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  function fmtDateTime(d) {
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) +
      " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  function toDateOnly(d) {
    if (!(d instanceof Date)) d = new Date(d);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function excelDateToJs(val) {
    if (val instanceof Date) return val;
    if (typeof val === "number") {
      // Date série Excel -> JS Date (SheetJS le fait normalement via cellDates, sécurité ici)
      const utc = XLSX.SSF ? XLSX.SSF.parse_date_code(val) : null;
      if (utc) return new Date(utc.y, utc.m - 1, utc.d);
    }
    const parsed = new Date(val);
    return isNaN(parsed) ? null : parsed;
  }
  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  const ICONS = {
    zap: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>',
    star: '<path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.2 21 12 17.77 5.8 21 7 14.14l-5-4.87 7.1-1.01L12 2z"/>',
    "trending-up": '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
    default: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>',
  };
  function iconSvg(name, extraAttrs = "") {
    const path = ICONS[name] || ICONS.default;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extraAttrs}>${path}</svg>`;
  }

  // ---------------------------------------------------------
  // Chargement des données (fetch réseau ou fichier local)
  // ---------------------------------------------------------
  async function loadFromArrayBuffer(buf) {
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const classementSheet = wb.Sheets["Classement"] || wb.Sheets[wb.SheetNames[0]];
    const boostersSheet = wb.Sheets["Boosters"];

    const rawRows = XLSX.utils.sheet_to_json(classementSheet, { defval: "" });
    const boosters = boostersSheet ? XLSX.utils.sheet_to_json(boostersSheet, { defval: "" }) : [];

    state.rawRows = rawRows.map((r) => ({
      date: toDateOnly(excelDateToJs(r.Date)),
      agence: String(r.Agence || "").trim(),
      secteur: String(r.Secteur || "").trim(),
      departement: String(r.Departement || r["Département"] || "").trim(),
      nouveauxClients: Number(r.NouveauxClients) || 0,
      clientsMouvementes: Number(r.ClientsMouvementes) || 0,
      mandats: Number(r.Mandats) || 0,
    })).filter((r) => r.agence && r.date);

    state.boosters = boosters.map((b) => ({
      nom: String(b.Nom || "").trim(),
      description: String(b.Description || "").trim(),
      debut: excelDateToJs(b.DateDebut),
      fin: excelDateToJs(b.DateFin),
      multiplicateur: Number(b.Multiplicateur) || 1,
      couleur: String(b.Couleur || "#D50032").trim(),
      icone: String(b.Icone || "zap").trim(),
    })).filter((b) => b.nom);

    const uniqueDates = Array.from(new Set(state.rawRows.map((r) => r.date.getTime())))
      .sort((a, b) => b - a)
      .map((t) => new Date(t));
    state.dates = uniqueDates;

    state.lastFetchOk = true;
  }

  async function fetchData() {
    const url = CONFIG.dataPath + "?t=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buf = await res.arrayBuffer();
    await loadFromArrayBuffer(buf);
  }

  function setLiveStatus(ok, message) {
    const dot = $("#live-dot");
    const text = $("#live-text");
    dot.classList.toggle("is-error", !ok);
    text.textContent = message;
  }

  async function refreshData(isFirstLoad = false) {
    try {
      await fetchData();
      setLiveStatus(true, "Données synchronisées");
      populateDynamicFilterOptions();
      renderAll();
    } catch (err) {
      console.error("Erreur de chargement des données :", err);
      if (isFirstLoad) {
        setLiveStatus(false, "Impossible de charger data/data.xlsx — ouvrez le fichier localement");
      } else {
        setLiveStatus(false, "Synchronisation impossible (dernière version conservée)");
      }
    }
  }

  // ---------------------------------------------------------
  // Chargement local (input file) — utile en ouverture directe
  // du fichier index.html (protocole file://) sans serveur.
  // ---------------------------------------------------------
  $("#btn-load-local").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    try {
      await loadFromArrayBuffer(buf);
      setLiveStatus(true, "Fichier local chargé : " + file.name);
      populateDynamicFilterOptions();
      renderAll();
    } catch (err) {
      console.error(err);
      setLiveStatus(false, "Fichier illisible");
    }
  });

  // ---------------------------------------------------------
  // Calcul des classements
  // ---------------------------------------------------------
  function getReferenceDates() {
    const chosen = state.filters.date ? new Date(state.filters.date) : null;
    let current, previous;
    if (chosen) {
      current = state.dates.find((d) => d.getTime() === toDateOnly(chosen).getTime()) || state.dates[0];
    } else {
      current = state.dates[0];
    }
    const idx = state.dates.findIndex((d) => d.getTime() === current.getTime());
    previous = state.dates[idx + 1] || null;
    return { current, previous };
  }

  function rowsForDate(date) {
    if (!date) return [];
    return state.rawRows.filter((r) => r.date.getTime() === date.getTime());
  }

  function applyBaseFilters(rows) {
    const { search, secteur, departement } = state.filters;
    return rows.filter((r) => {
      if (search && !r.agence.toLowerCase().includes(search.toLowerCase())) return false;
      if (secteur && r.secteur !== secteur) return false;
      if (departement && r.departement !== departement) return false;
      return true;
    });
  }

  function buildRanking(metricKey) {
    const { current, previous } = getReferenceDates();
    if (!current) return { rows: [], current: null, previous: null };

    const currentRows = applyBaseFilters(rowsForDate(current));
    const previousRows = rowsForDate(previous);
    const prevByAgence = new Map(previousRows.map((r) => [r.agence, r]));

    // classement global (non filtré) pour connaitre la position "objective"
    const allCurrentSorted = [...rowsForDate(current)].sort((a, b) => b[metricKey] - a[metricKey]);
    const allPreviousSorted = [...previousRows].sort((a, b) => b[metricKey] - a[metricKey]);
    const prevRankByAgence = new Map(allPreviousSorted.map((r, i) => [r.agence, i + 1]));
    const currentRankByAgence = new Map(allCurrentSorted.map((r, i) => [r.agence, i + 1]));

    let ranked = currentRows.map((r) => {
      const prev = prevByAgence.get(r.agence);
      const prevValue = prev ? prev[metricKey] : null;
      const delta = prevValue === null ? null : r[metricKey] - prevValue;
      const rankNow = currentRankByAgence.get(r.agence) || null;
      const rankBefore = prevRankByAgence.get(r.agence) || null;
      const rankDelta = rankNow && rankBefore ? rankBefore - rankNow : null; // positif = a progressé
      return { ...r, metricKey, score: r[metricKey], delta, rankNow, rankDelta };
    });

    // tri
    switch (state.filters.tri) {
      case "alpha":
        ranked.sort((a, b) => a.agence.localeCompare(b.agence, "fr"));
        break;
      case "progression":
        ranked.sort((a, b) => (b.rankDelta ?? -999) - (a.rankDelta ?? -999));
        break;
      case "updated":
        ranked.sort((a, b) => b.date - a.date || b.score - a.score);
        break;
      default:
        ranked.sort((a, b) => b.score - a.score);
    }

    // position d'affichage = rang objectif (non affecté par le tri manuel), sauf tri alpha où on garde le vrai rang
    ranked = ranked.map((r) => ({ ...r, displayRank: r.rankNow }));

    return { rows: ranked, current, previous };
  }

  function maxScoreForMetric(metricKey) {
    const { current } = getReferenceDates();
    const rows = rowsForDate(current);
    return rows.reduce((m, r) => Math.max(m, r[metricKey]), 0) || 1;
  }

  // ---------------------------------------------------------
  // Rendu — Statistiques générales
  // ---------------------------------------------------------
  function renderStats() {
    const { current } = getReferenceDates();
    const rows = rowsForDate(current);
    const grid = $("#stats-grid");

    if (!rows.length) {
      grid.innerHTML = "";
      return;
    }

    const totalAgencies = rows.length;
    const totalNC = rows.reduce((s, r) => s + r.nouveauxClients, 0);
    const totalCM = rows.reduce((s, r) => s + r.clientsMouvementes, 0);
    const totalMandats = rows.reduce((s, r) => s + r.mandats, 0);
    const totalPoints = rows.reduce((s, r) =>
      s + r.nouveauxClients * CONFIG.weights.nouveauxClients +
          r.clientsMouvementes * CONFIG.weights.clientsMouvementes +
          r.mandats * CONFIG.weights.mandats, 0);

    const leader = [...rows].sort((a, b) => {
      const pa = a.nouveauxClients * CONFIG.weights.nouveauxClients + a.clientsMouvementes * CONFIG.weights.clientsMouvementes + a.mandats * CONFIG.weights.mandats;
      const pb = b.nouveauxClients * CONFIG.weights.nouveauxClients + b.clientsMouvementes * CONFIG.weights.clientsMouvementes + b.mandats * CONFIG.weights.mandats;
      return pb - pa;
    })[0];

    const { previous } = getReferenceDates();
    let avgProgression = "—";
    if (previous) {
      const prevRows = rowsForDate(previous);
      const prevByAgence = new Map(prevRows.map((r) => [r.agence, r]));
      let sumDelta = 0, n = 0;
      rows.forEach((r) => {
        const p = prevByAgence.get(r.agence);
        if (p) {
          sumDelta += (r.nouveauxClients + r.clientsMouvementes + r.mandats) - (p.nouveauxClients + p.clientsMouvementes + p.mandats);
          n++;
        }
      });
      if (n) avgProgression = (sumDelta / n >= 0 ? "+" : "") + (sumDelta / n).toFixed(1);
    }

    const cards = [
      { icon: "zap", color: "#D50032", value: totalPoints.toLocaleString("fr-FR"), label: "Points totaux" },
      { icon: "agencies", color: "#333F48", value: totalAgencies, label: "Agences participantes" },
      { icon: "nc", color: "#FF6A14", value: totalNC, label: "Nouveaux clients" },
      { icon: "cm", color: "#63666A", value: totalCM, label: "Clients mouvementés" },
      { icon: "mandats", color: "#D50032", value: totalMandats, label: "Mandats signés" },
      { icon: "trending-up", color: "#333F48", value: avgProgression, label: "Progression moyenne" },
    ];

    const svgFor = {
      zap: ICONS.zap,
      agencies: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/>',
      nc: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>',
      cm: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
      mandats: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/>',
      "trending-up": ICONS["trending-up"],
    };

    grid.innerHTML = cards.map((c) => `
      <div class="stat-card">
        <div class="stat-icon" style="background:${c.color}1A; color:${c.color};">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgFor[c.icon]}</svg>
        </div>
        <div class="stat-value">${c.value}</div>
        <div class="stat-label">${c.label}</div>
      </div>
    `).join("") + (leader ? `
      <div class="stat-card">
        <div class="stat-icon" style="background:#D4AF3722; color:#B8912B;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.2 21 12 17.77 5.8 21 7 14.14l-5-4.87 7.1-1.01L12 2z"/></svg>
        </div>
        <div class="stat-value" style="font-size:17px;">${escapeHtml(leader.agence)}</div>
        <div class="stat-label">Agence leader</div>
      </div>` : "");

    $("#hero-agencies").textContent = totalAgencies + " agences";
    if (current) $("#hero-updated").textContent = "Dernière mise à jour : " + fmtDate(current);
  }

  // ---------------------------------------------------------
  // Rendu — Booster
  // ---------------------------------------------------------
  let confettiFiredFor = null;
  let countdownTimer = null;

  function getActiveBooster() {
    const now = new Date();
    return state.boosters.find((b) => b.debut && b.fin && now >= b.debut && now <= b.fin) || null;
  }

  function renderBooster() {
    const wrap = $("#booster-wrap");
    const active = getActiveBooster();
    if (countdownTimer) clearInterval(countdownTimer);

    if (!active) {
      wrap.innerHTML = `
        <div class="booster-none">
          ${iconSvg("zap")}
          <span>Aucun booster actif pour le moment. Les prochains boosters s'afficheront automatiquement ici.</span>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="booster-card" style="background:linear-gradient(120deg, ${active.couleur}, ${shade(active.couleur, -18)});">
        <div class="booster-left">
          <div class="booster-icon">${iconSvg(active.icone)}</div>
          <div>
            <div class="booster-name">${escapeHtml(active.nom)} <span class="booster-mult">x${active.multiplicateur}</span></div>
            <div class="booster-desc">${escapeHtml(active.description)}</div>
          </div>
        </div>
        <div class="booster-right">
          <div class="countdown" id="booster-countdown"></div>
        </div>
      </div>`;

    updateCountdown(active.fin);
    countdownTimer = setInterval(() => updateCountdown(active.fin), 1000);

    if (confettiFiredFor !== active.nom) {
      confettiFiredFor = active.nom;
      fireConfetti();
    }
  }

  function updateCountdown(endDate) {
    const el = $("#booster-countdown");
    if (!el) return;
    const diff = Math.max(0, endDate - new Date());
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.innerHTML = [
      [d, "j"], [h, "h"], [m, "m"], [s, "s"],
    ].map(([v, l]) => `<div class="countdown-cell"><div class="countdown-num">${String(v).padStart(2, "0")}</div><div class="countdown-label">${l}</div></div>`).join("");
  }

  function shade(hex, percent) {
    try {
      const n = parseInt(hex.replace("#", ""), 16);
      let r = (n >> 16) + Math.round(2.55 * percent);
      let g = ((n >> 8) & 0xff) + Math.round(2.55 * percent);
      let b = (n & 0xff) + Math.round(2.55 * percent);
      r = Math.min(255, Math.max(0, r));
      g = Math.min(255, Math.max(0, g));
      b = Math.min(255, Math.max(0, b));
      return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
    } catch { return hex; }
  }

  function fireConfetti() {
    const layer = $("#confetti-layer");
    const colors = ["#D50032", "#FF6A14", "#333F48", "#D4AF37"];
    for (let i = 0; i < 80; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "vw";
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = 2200 + Math.random() * 1800 + "ms";
      piece.style.animationDelay = Math.random() * 400 + "ms";
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), 4600);
    }
  }

  // ---------------------------------------------------------
  // Rendu — Podiums & Tableaux
  // ---------------------------------------------------------
  function evolPill(rankDelta) {
    if (rankDelta === null || rankDelta === undefined) {
      return `<span class="evol-pill evol-flat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"/></svg>Nouveau</span>`;
    }
    if (rankDelta > 0) {
      return `<span class="evol-pill evol-up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>+${rankDelta}</span>`;
    }
    if (rankDelta < 0) {
      return `<span class="evol-pill evol-down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>${rankDelta}</span>`;
    }
    return `<span class="evol-pill evol-flat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"/></svg>=</span>`;
  }

  function renderPodium(metricKey, rows) {
    const el = $(`[data-podium-for="${metricKey}"]`);
    const top3 = rows.slice(0, 3);
    if (!top3.length) {
      el.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">${iconSvg("zap")}<div>Aucune agence ne correspond aux filtres actuels.</div></div>`;
      return;
    }
    // ordre d'affichage attendu par le CSS (rank 2,1,3 dans le DOM via 'order')
    el.innerHTML = top3.map((r, i) => `
      <div class="podium-card" data-rank="${i + 1}">
        <div class="podium-medal">${i + 1}</div>
        <div class="podium-name">${escapeHtml(r.agence)}</div>
        <div class="podium-sector"><span class="sector-tag" data-sector="${escapeHtml(r.secteur)}">${escapeHtml(r.secteur || "—")}</span></div>
        <div class="podium-score">${r.score}</div>
        <div class="podium-evol">${evolPill(r.rankDelta)}</div>
      </div>
    `).join("");
  }

  function renderTable(metricKey, rows) {
    const el = $(`[data-table-for="${metricKey}"]`);
    const affichage = state.filters.affichage;
    const limit = affichage === "all" ? rows.length : parseInt(affichage, 10);
    const shown = rows.slice(0, limit);
    const max = maxScoreForMetric(metricKey);

    if (!shown.length) {
      el.innerHTML = `<div class="empty-state">${iconSvg("zap")}<div>Aucune agence ne correspond aux filtres actuels.</div></div>`;
      return;
    }

    el.innerHTML = `
      <table class="rank-table">
        <thead>
          <tr>
            <th>Pos.</th><th>Agence</th><th>Secteur</th><th>Score</th><th>Évolution</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((r, i) => `
            <tr style="animation-delay:${i * 25}ms;">
              <td class="td-pos">${r.displayRank ?? i + 1}</td>
              <td class="td-agence">
                ${escapeHtml(r.agence)}
                <span class="sub">${escapeHtml(r.departement || "")}</span>
                <div class="progress-bar"><div class="progress-bar-fill" style="width:${Math.round((r.score / max) * 100)}%;"></div></div>
              </td>
              <td class="td-secteur"><span class="sector-tag" data-sector="${escapeHtml(r.secteur)}">${escapeHtml(r.secteur || "—")}</span></td>
              <td class="td-score">${r.score}</td>
              <td>${evolPill(r.rankDelta)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>`;
  }

  function renderRankings() {
    CONFIG.metrics.forEach(({ key }) => {
      const { rows } = buildRanking(key);
      renderPodium(key, rows);
      renderTable(key, rows);
      const countEl = $(`[data-count-for="${key}"]`);
      if (countEl) countEl.textContent = `${rows.length} agence${rows.length > 1 ? "s" : ""} classée${rows.length > 1 ? "s" : ""}`;

      const podiumEl = $(`[data-podium-for="${key}"]`);
      const tableEl = $(`[data-table-for="${key}"]`);
      const isTable = state.views[key] === "table";
      podiumEl.style.display = isTable ? "none" : "grid";
      tableEl.style.display = isTable ? "block" : "none";
    });
  }

  // ---------------------------------------------------------
  // Filtres dynamiques (secteurs / départements / dates réels)
  // ---------------------------------------------------------
  function populateDynamicFilterOptions() {
    const depSel = $("#f-departement");
    const dateSel = $("#f-date");

    const departements = Array.from(new Set(state.rawRows.map((r) => r.departement).filter(Boolean))).sort();
    depSel.innerHTML = `<option value="">Tous les départements</option>` +
      departements.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");

    dateSel.innerHTML = `<option value="">Dernière date disponible</option>` +
      state.dates.map((d) => `<option value="${d.toISOString()}">${fmtDate(d)}</option>`).join("");
  }

  // ---------------------------------------------------------
  // Écouteurs des filtres
  // ---------------------------------------------------------
  function bindFilterEvents() {
    $("#f-search").addEventListener("input", (e) => { state.filters.search = e.target.value; renderRankings(); });
    $("#f-secteur").addEventListener("change", (e) => { state.filters.secteur = e.target.value; renderRankings(); });
    $("#f-departement").addEventListener("change", (e) => { state.filters.departement = e.target.value; renderRankings(); });
    $("#f-date").addEventListener("change", (e) => { state.filters.date = e.target.value; renderAll(); });
    $("#f-tri").addEventListener("change", (e) => { state.filters.tri = e.target.value; renderRankings(); });
    $("#f-affichage").addEventListener("change", (e) => { state.filters.affichage = e.target.value; renderRankings(); });
    $("#f-reset").addEventListener("click", () => {
      state.filters = { search: "", secteur: "", departement: "", date: "", tri: "score", affichage: "10" };
      $("#f-search").value = ""; $("#f-secteur").value = ""; $("#f-departement").value = "";
      $("#f-date").value = ""; $("#f-tri").value = "score"; $("#f-affichage").value = "10";
      renderAll();
    });

    $$(".view-toggle").forEach((toggle) => {
      const metric = toggle.dataset.viewFor;
      toggle.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-view]");
        if (!btn) return;
        state.views[metric] = btn.dataset.view;
        $$("button", toggle).forEach((b) => b.classList.toggle("is-active", b === btn));
        renderRankings();
      });
    });
  }

  // ---------------------------------------------------------
  // Plein écran
  // ---------------------------------------------------------
  $("#btn-fullscreen").addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  // ---------------------------------------------------------
  // Rendu global
  // ---------------------------------------------------------
  function renderAll() {
    renderStats();
    renderBooster();
    renderRankings();
  }

  // ---------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------
  function init() {
    bindFilterEvents();
    refreshData(true);
    setInterval(() => refreshData(false), CONFIG.refreshIntervalMs);
  }

  document.addEventListener("DOMContentLoaded", init);
})();