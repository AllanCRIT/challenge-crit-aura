// CONFIGURATION STATE
let agenciesData = [];
let boostersData = [];

// ELEMENTS DOM
const searchInput = document.getElementById('search-agency');
const filterSecteur = document.getElementById('filter-secteur');
const filterCategory = document.getElementById('filter-category');
const filterSort = document.getElementById('filter-sort');
const filterLimit = document.getElementById('filter-limit');
const updateTimestamp = document.getElementById('update-timestamp');
const fullscreenBtn = document.getElementById('fullscreen-btn');

// INITIALISATION
document.addEventListener("DOMContentLoaded", () => {
    initApp();
    setupEventListeners();
});

function initApp() {
    loadAllData();
    setInterval(loadAllData, 30000);
}

// RECUPERATION DES DONNEES
async function loadAllData() {
    const cacheBuster = `?t=${new Date().getTime()}`;
    try {
        const [agenciesRes, boostersRes] = await Promise.all([
            fetch(`agences.csv${cacheBuster}`).then(r => {
                if (!r.ok) throw new Error("Fichier agences.csv introuvable");
                return r.text();
            }),
            fetch(`boosters.csv${cacheBuster}`).then(r => {
                if (!r.ok) throw new Error("Fichier boosters.csv introuvable");
                return r.text();
            })
        ]);
        
        agenciesData = parseCSV(agenciesRes);
        boostersData = parseCSV(boostersRes);
        
        processAndRender();
        const now = new Date();
        updateTimestamp.innerHTML = `<i class="fa-solid fa-check-double" style="color:#48BB78"></i> Mis à jour à ${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
    } catch (error) {
        console.error("Erreur de traitement des fichiers CSV :", error);
        updateTimestamp.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--crit-red)"></i> Erreur de chargement`;
    }
}

// PARSER CSV
function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
    if (lines.length === 0) return [];
    
    const separator = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(separator).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
    
    return lines.slice(1).map(line => {
        const values = line.split(separator).map(v => v.trim().replace(/^"|"$/g, ''));
        const obj = {};
        headers.forEach((header, i) => {
            let val = values[i];
            if (val !== undefined && val !== "" && !isNaN(val)) {
                obj[header] = Number(val);
            } else {
                obj[header] = val || "";
            }
        });
        return obj;
    });
}

// FILTRES
function processAndRender() {
    const searchVal = searchInput.value.toLowerCase().trim();
    const secteurVal = filterSecteur.value;

    let filteredAgencies = agenciesData.filter(item => {
        const matchSearch = item.nom ? item.nom.toLowerCase().includes(searchVal) : false;
        const matchSecteur = (secteurVal === "Tous") || (item.secteur === secteurVal);
        return matchSearch && matchSecteur;
    });

    renderGlobalStats(filteredAgencies);
    renderActiveBoosters();
    handleCategoryVisibility();

    renderSingleLeaderboard(filteredAgencies, 'nouveaux_clients', 'nc');
    renderSingleLeaderboard(filteredAgencies, 'clients_mouvementes', 'cm');
    renderSingleLeaderboard(filteredAgencies, 'mandats', 'mandats');
}

// STATISTIQUES GLOBALES
function renderGlobalStats(data) {
    if (data.length === 0) return;

    const totalPoints = data.reduce((acc, curr) => acc + (curr.points || 0), 0);
    const totalNC = data.reduce((acc, curr) => acc + (curr.nouveaux_clients || 0), 0);
    const totalCM = data.reduce((acc, curr) => acc + (curr.clients_mouvementes || 0), 0);
    const totalMandats = data.reduce((acc, curr) => acc + (curr.mandats || 0), 0);
    
    const leader = [...data].sort((a,b) => (b.points || 0) - (a.points || 0))[0];

    document.getElementById('stat-total-points').innerText = totalPoints.toLocaleString();
    document.getElementById('stat-total-agencies').innerText = data.length;
    document.getElementById('stat-total-nc').innerText = totalNC.toLocaleString();
    document.getElementById('stat-total-cm').innerText = totalCM.toLocaleString();
    document.getElementById('stat-total-mandats').innerText = totalMandats.toLocaleString();
    document.getElementById('stat-leader-name').innerText = leader ? leader.nom : "Aucun";
}

// BOOSTERS
function renderActiveBoosters() {
    const container = document.getElementById('boosters-container');
    container.innerHTML = "";
    const now = new Date();

    boostersData.forEach(booster => {
        const start = new Date(booster.date_debut);
        const end = new Date(booster.date_fin);

        if (now >= start && now <= end) {
            const banner = document.createElement('div');
            banner.className = 'booster-banner';
            banner.style.background = `linear-gradient(135deg, ${booster.couleur || 'var(--crit-orange)'} 0%, var(--crit-dark) 100%)`;
            
            const diffMs = end - now;
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            const diffDays = Math.floor(diffHours / 24);
            const remainingText = diffDays > 0 ? `${diffDays}j restant(s)` : `${diffHours}h restante(s)`;

            banner.innerHTML = `
                <div class="booster-left">
                    <div class="booster-icon">${booster.icone || '🔥'}</div>
                    <div class="booster-title">
                        <h4>${booster.nom} - ACTIF (Mult. x${booster.multiplicateur})</h4>
                        <p>${booster.description}</p>
                    </div>
                </div>
                <div class="booster-right">
                    <span class="countdown-label">FIN DU RUSH DANS :</span>
                    <div class="countdown-timer">${remainingText}</div>
                </div>
            `;
            container.appendChild(banner);
        }
    });
}

// VISIBILITE
function handleCategoryVisibility() {
    const view = filterCategory.value;
    document.getElementById('box-nc').style.display = (view === "Tous" || view === "nc") ? "flex" : "none";
    document.getElementById('box-cm').style.display = (view === "Tous" || view === "cm") ? "flex" : "none";
    document.getElementById('box-mandats').style.display = (view === "Tous" || view === "mandats") ? "flex" : "none";

    const wrapper = document.getElementById('leaderboards-wrapper');
    if (view !== "Tous") {
        wrapper.style.gridTemplateColumns = "1fr";
    } else {
        wrapper.style.gridTemplateColumns = "repeat(auto-fit, minmax(450px, 1fr))";
    }
}

// GENERATEUR DE CLASSEMENT ET PODIUM
function renderSingleLeaderboard(data, keyMetric, elementSuffix) {
    let list = [...data];

    // Tri dynamique
    const sortCriteria = filterSort.value;
    if (sortCriteria === "score") {
        list.sort((a, b) => (b[keyMetric] || 0) - (a[keyMetric] || 0));
    } else if (sortCriteria === "alpha") {
        list.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
    } else if (sortCriteria === "progression") {
        list.sort((a, b) => (b.evolution || 0) - (a.evolution || 0));
    }

    // --- LE PODIUM (Prend toujours les 3 premiers du classement trié) ---
    const containerPodium = document.getElementById(`podium-${elementSuffix}`);
    containerPodium.innerHTML = "";

    if (list.length > 0) {
        const positions = [
            { index: 1, class: 'second', num: '2' }, 
            { index: 0, class: 'first', num: '1' },  
            { index: 2, class: 'third', num: '3' }   
        ];

        positions.forEach(pos => {
            const item = list[pos.index];
            const step = document.createElement('div');
            step.className = `podium-step ${pos.class}`;

            if (!item) {
                step.style.opacity = "0"; // Équilibre si moins de 3 agences au total
            } else {
                const name = item.nom || item.Nom || "Inconnu";
                step.innerHTML = `
                    ${pos.class === 'first' ? '<div class="podium-crown"><i class="fa-solid fa-crown"></i></div>' : ''}
                    <div class="podium-avatar">${pos.num}</div>
                    <div class="podium-pillar">
                        <span class="podium-name" title="${name}">${name}</span>
                        <span class="podium-score">${(item[keyMetric] || 0).toLocaleString()}</span>
                    </div>
                `;
            }
            containerPodium.appendChild(step);
        });
    }

    // --- LA TABLE BASSE ---
    const limitVal = filterLimit.value;
    if (limitVal !== "complet") {
        list = list.slice(0, Number(limitVal));
    }

    const tbody = document.getElementById(`table-${elementSuffix}`);
    tbody.innerHTML = "";

    list.forEach((agency, index) => {
        const rank = index + 1;
        let evolIcon = `<span class="evol-stable"><i class="fa-solid fa-minus"></i></span>`;
        if ((agency.evolution || 0) > 0) {
            evolIcon = `<span class="evol-up"><i class="fa-solid fa-caret-up"></i> +${agency.evolution}</span>`;
        } else if ((agency.evolution || 0) < 0) {
            evolIcon = `<span class="evol-down"><i class="fa-solid fa-caret-down"></i> ${agency.evolution}</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="rank-badge">${rank}</span></td>
            <td>
                <span class="agency-title">${agency.nom || 'Sans nom'}</span>
                <span class="agency-sector">${agency.secteur || ''} ${agency.departement ? `(${agency.departement})` : ''}</span>
            </td>
            <td class="score-cell">${(agency[keyMetric] || 0).toLocaleString()}</td>
            <td class="evolution-cell">${evolIcon}</td>
        `;
        tbody.appendChild(tr);
    });
}

// LISTENERS
function setupEventListeners() {
    searchInput.addEventListener('input', processAndRender);
    filterSecteur.addEventListener('change', processAndRender);
    filterCategory.addEventListener('change', processAndRender);
    filterSort.addEventListener('change', processAndRender);
    filterLimit.addEventListener('change', processAndRender);

    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                alert(`Erreur d'activation du mode plein écran : ${err.message}`);
            });
            fullscreenBtn.innerHTML = `<i class="fa-solid fa-compress"></i> Quitter`;
        } else {
            document.exitFullscreen();
            fullscreenBtn.innerHTML = `<i class="fa-solid fa-expand"></i> Plein écran`;
        }
    });
}
