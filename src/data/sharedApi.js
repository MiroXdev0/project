const configuredApiRoot = import.meta.env.VITE_API_URL?.trim();
const API_ROOT = (configuredApiRoot || "/api").replace(/\/+$/, "");
const sharedData = {
    presentations: [],
    files: []
};
let eventSource;
let refreshTimer;
let refreshPromise;

async function request(path, options = {}) {
    let response;
    try {
        response = await fetch(`${API_ROOT}${path}`, {
            cache: "no-store",
            ...options
        });
    } catch (requestError) {
        throw new Error(
            `Der gemeinsame Dateiserver ist nicht erreichbar. Prüfe die VITE_API_URL-Einstellung auf Vercel und ob der Node-Server läuft. (${requestError.message})`
        );
    }
    if (!response.ok) {
        let message = `Serveranfrage fehlgeschlagen (${response.status}).`;
        try {
            const result = await response.json();
            if (typeof result.error === "string") message = result.error;
        } catch {
            if (response.status === 404 || response.headers.get("content-type")?.includes("text/html")) {
                message = "Der gemeinsame Datei-Server ist unter dieser Adresse nicht eingerichtet. Vercel stellt nur die Website bereit; verbinde sie mit dem laufenden Node-Backend.";
            }
        }
        throw new Error(message);
    }
    if (response.status === 204) return null;
    if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Der gemeinsame Datei-Server hat keine API-Antwort geliefert. Prüfe die VITE_API_URL-Einstellung und den Backend-Status.");
    }
    return response.json();
}

function mutateCollection(collectionName, item, id = item?.id) {
    const records = sharedData[collectionName].filter(record => record.id !== id);
    if (item) records.push(item);
    sharedData[collectionName] = records;
}

function jsonRequest(method, body) {
    return {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    };
}

export function getSharedPresentations() {
    return sharedData.presentations;
}

export function getSharedFiles() {
    return sharedData.files;
}

export function refreshSharedData() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = request("/state")
        .then(result => {
            if (!Array.isArray(result.presentations) || !Array.isArray(result.files)) {
                throw new Error("Der Server hat einen ungültigen Datenbestand geliefert.");
            }
            sharedData.presentations = result.presentations;
            sharedData.files = result.files;
            return result;
        })
        .finally(() => {
            refreshPromise = null;
        });
    return refreshPromise;
}

export async function createSharedPresentation(presentation) {
    const result = await request("/projects", jsonRequest("POST", presentation));
    mutateCollection("presentations", result);
    return result;
}

export async function updateSharedPresentation(id, changes) {
    const result = await request(
        `/projects/${encodeURIComponent(id)}`,
        jsonRequest("PUT", changes)
    );
    mutateCollection("presentations", result);
    return result;
}

export async function deleteSharedPresentation(id) {
    await request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    mutateCollection("presentations", null, id);
}

export async function uploadSharedFile(file, metadata) {
    const formData = new FormData();
    formData.set("file", file, file.name);
    formData.set("type", metadata.type ?? "");
    formData.set("subject", metadata.subject ?? "");
    const result = await request("/files", {
        method: "POST",
        body: formData
    });
    mutateCollection("files", result);
    return result;
}

export async function migrateLegacyFile(file, content) {
    const formData = new FormData();
    formData.set("id", file.id);
    formData.set("name", file.name ?? "datei");
    formData.set("type", file.type ?? "");
    formData.set("subject", file.subject ?? "");
    formData.set("url", file.url ?? "");
    formData.set("mimeType", file.mimeType ?? "");
    formData.set("size", String(file.size ?? ""));
    formData.set("createdAt", String(file.createdAt ?? ""));
    if (content instanceof Blob) {
        formData.set("file", content, file.name ?? "datei");
    }
    const result = await request("/migration/files", {
        method: "POST",
        body: formData
    });
    mutateCollection("files", result.file);
    return result;
}

export async function migrateLegacyPresentation(presentation) {
    const result = await request(
        "/migration/projects",
        jsonRequest("POST", presentation)
    );
    mutateCollection("presentations", result.project);
    return result;
}

export async function createSharedFileLink(file) {
    const result = await request("/file-links", jsonRequest("POST", file));
    mutateCollection("files", result);
    return result;
}

export async function updateSharedFile(id, changes) {
    const result = await request(
        `/files/${encodeURIComponent(id)}`,
        jsonRequest("PUT", changes)
    );
    mutateCollection("files", result);
    return result;
}

export async function deleteSharedFile(id) {
    await request(`/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    mutateCollection("files", null, id);
    sharedData.presentations = sharedData.presentations.map(presentation => ({
        ...presentation,
        fileIds: (presentation.fileIds ?? []).filter(fileId => fileId !== id)
    }));
}

export async function fetchSharedFile(id, { download = false } = {}) {
    const query = download ? "?download=1" : "";
    let response;
    try {
        response = await fetch(
            `${API_ROOT}/files/${encodeURIComponent(id)}/content${query}`,
            { cache: "no-store" }
        );
    } catch (requestError) {
        throw new Error(
            `Der gemeinsame Dateiserver ist nicht erreichbar. Prüfe VITE_API_URL und den Backend-Status. (${requestError.message})`
        );
    }
    if (!response.ok) {
        let message = `Datei konnte nicht vom Server geladen werden (${response.status}).`;
        try {
            const result = await response.json();
            if (typeof result.error === "string") message = result.error;
        } catch {
            // Keep the HTTP status message when the server did not return JSON.
        }
        throw new Error(message);
    }
    return response.blob();
}

export function startSharedSync(onUpdate, onUnavailable) {
    eventSource?.close();
    eventSource = new EventSource(`${API_ROOT}/events`);
    let hasConnected = false;
    eventSource.onopen = () => {
        hasConnected = true;
        refreshSharedData()
            .then(onUpdate)
            .catch(onUnavailable);
    };
    eventSource.addEventListener("update", () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(async () => {
            try {
                await refreshSharedData();
                onUpdate();
            } catch (syncError) {
                console.error("[Schulorganizer] Gemeinsame Daten konnten nicht aktualisiert werden:", syncError);
                onUnavailable(syncError);
            }
        }, 100);
    });
    eventSource.onerror = () => {
        if (hasConnected) {
            onUnavailable(new Error("Die Verbindung zu den gemeinsamen Daten wurde unterbrochen."));
        }
    };
    return () => {
        window.clearTimeout(refreshTimer);
        eventSource?.close();
        eventSource = null;
    };
}
