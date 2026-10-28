// Módulo "search" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { focusObjectById, rotatedEntityAliases, searchBar, searchInput, viewer } from "../viewer-authenticated.js";
import { normalizeSearchText } from "./materials.js";
import { getAllObjectIds } from "./scene-objects.js";
import { modelIsolateController } from "./treeview-section.js";

export const searchButton = document.getElementById("btnSearchId");
export const closeSearchBarButton = document.getElementById("closeSearchBar");
export const searchToggleButton = document.getElementById("btnSearchToggle");
export const searchFeedback = document.getElementById("searchFeedback");
export let searchResultsList = document.getElementById("searchResultsList");

export function setSearchStatus(message, isError = false) {
    if (!searchFeedback) {
        return;
    }

    searchFeedback.textContent = message;
    searchFeedback.dataset.state = isError ? "error" : "success";
}

export function clearSearchResults() {
    if (!searchResultsList) {
        return;
    }

    searchResultsList.innerHTML = "";
    searchResultsList.hidden = true;
}

export function ensureSearchResultsList() {
    if (!searchBar || searchResultsList) {
        return;
    }

    searchResultsList = document.createElement("ul");
    searchResultsList.id = "searchResultsList";
    searchResultsList.className = "search-results-list";
    searchResultsList.hidden = true;
    searchBar.appendChild(searchResultsList);
}

export function findObjectsByName(query) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
        return [];
    }

    const activeObjectIds = new Set(getAllObjectIds());
    const metaObjects = viewer.metaScene?.metaObjects || {};
    const matches = [];

    for (const objectId of activeObjectIds) {
        const aliasEntry = rotatedEntityAliases.get(objectId);
        const metaObject = aliasEntry ? metaObjects[aliasEntry.sourceId] : metaObjects[objectId];
        if (!metaObject) {
            continue;
        }

        const normalizedName = normalizeSearchText(metaObject.name || "");
        if (!normalizedName.includes(normalizedQuery)) {
            continue;
        }

        matches.push({
            id: objectId,
            name: metaObject.name || "Sem nome",
            ifcModelId: metaObject?.metaModel?.id || "IFC não identificado"
        });
    }

    return matches.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id, "pt-BR"));
}

export function renderSearchResults(matches) {
    ensureSearchResultsList();

    if (!searchResultsList) {
        return;
    }

    searchResultsList.innerHTML = "";
    searchResultsList.hidden = !matches.length;

    matches.forEach((match) => {
        const listItem = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result-item";
        button.innerHTML = `
            <span class="search-result-id">${match.id}</span>
            <span class="search-result-name">${match.name}</span>
            <span class="search-result-ifc">${match.ifcModelId}</span>
        `;

        button.addEventListener("click", () => {
            const found = focusObjectById(match.id);
            if (found) {
                setSearchStatus(`Peça ${match.id} (${match.ifcModelId}) isolada com destaque.`);
            }
        });

        listItem.appendChild(button);
        searchResultsList.appendChild(listItem);
    });
}

export function openSearchBar() {
    if (!searchBar) {
        return;
    }

    searchBar.hidden = false;

    if (searchToggleButton) {
        searchToggleButton.classList.add("active");
        searchToggleButton.setAttribute("aria-pressed", "true");
    }

    if (searchInput) {
        searchInput.focus();
        searchInput.select?.();
    }
}

export function closeSearchBar() {
    if (!searchBar) {
        return;
    }

    searchBar.hidden = true;

    if (searchToggleButton) {
        searchToggleButton.classList.remove("active");
        searchToggleButton.setAttribute("aria-pressed", "false");
    }
}

export function toggleSearchBar(forceOpen) {
    if (!searchBar) {
        return;
    }

    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : searchBar.hidden;

    if (shouldOpen) {
        openSearchBar();
        return;
    }

    closeSearchBar();
}

export function setupSearchControls() {
    if (!searchInput || !searchButton) {
        return;
    }

    if (searchToggleButton && searchBar) {
        searchToggleButton.addEventListener("click", () => toggleSearchBar());
    }

    closeSearchBarButton?.addEventListener("click", () => toggleSearchBar(false));

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && searchBar && !searchBar.hidden) {
            toggleSearchBar(false);
        }
    });

    const runSearch = () => {
        const rawId = searchInput.value.trim();

        if (!rawId) {
            clearSearchResults();
            setSearchStatus("Digite o ID ou o nome da peça para buscar.", true);
            return;
        }

        if (!modelIsolateController || !getAllObjectIds().length) {
            clearSearchResults();
            setSearchStatus("Carregue um modelo antes de buscar uma peça.", true);
            return;
        }

        const found = focusObjectById(rawId);

        if (found) {
            clearSearchResults();
            setSearchStatus(`Peça ${rawId} isolada com destaque.`);
        } else {
            const matchesByName = findObjectsByName(rawId);

            if (!matchesByName.length) {
                clearSearchResults();
                setSearchStatus(`Nenhuma peça com ID ou nome "${rawId}" foi encontrada nos modelos carregados.`, true);
                return;
            }

            if (matchesByName.length === 1) {
                const [singleMatch] = matchesByName;
                focusObjectById(singleMatch.id);
                clearSearchResults();
                setSearchStatus(`1 peça encontrada por nome: ${singleMatch.id} (${singleMatch.ifcModelId}).`);
                return;
            }

            const ifcModels = [...new Set(matchesByName.map((item) => item.ifcModelId))];
            renderSearchResults(matchesByName);
            setSearchStatus(
                `${matchesByName.length} peças encontradas por nome em ${ifcModels.length} IFC(s): ${ifcModels.join(", ")}. Selecione uma peça na lista abaixo.`
            );
        }
    };

    searchButton.addEventListener("click", runSearch);
    searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            runSearch();
        }
    });
}
