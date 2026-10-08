import { upload } from "@vercel/blob/client";

const API_ROOT = "/api";
const sharedData = {
    presentations: [],
    files: []
};
let refreshPromise;

export function getUploadContentType(file, fallbackType = "") {
    if (file.type && file.type !== "application/octet-stream") return file.type;
    if (/\.png$/i.test(file.name ?? "")) return "image/png";
    return file.type || fallbackType || "application/octet-stream";
}

async function request(path, options = {}) {
    let response;
    try {
        response = await fetch(`${API_ROOT}${path}`, {
            cache: "no-store",
            ...options
        });
    } catch (requestError) {
        throw new Error(
            `Die Vercel-API ist nicht erreichbar. Bitte prüfe den Bereitstellungsstatus. (${requestError.message})`
        );
    }
    if (!response.ok) {
        let message = `Serveranfrage fehlgeschlagen (${response.status}).`;
        try {
            const result = await response.json();
            if (typeof result.error === "string") message = result.error;
        } catch {
            if (response.status === 404 || response.headers.get("content-type")?.includes("text/html")) {
                message = "Die Vercel-API wurde nicht gefunden. Prüfe, ob die API-Funktionen mit der Website bereitgestellt wurden.";
            }
        }
        throw new Error(message);
    }
    if (response.status === 204) return null;
    if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Die Vercel-API hat keine gültige JSON-Antwort geliefert.");
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
    const id = crypto.randomUUID();
    const contentType = getUploadContentType(file);
    const blob = await upload(`${id}-${file.name}`, file, {
        access: "public",
        contentType,
        handleUploadUrl: `${API_ROOT}/files/upload-token`,
        multipart: file.size > 5 * 1024 * 1024,
        onUploadProgress: metadata.onUploadProgress
    });
    const result = await request("/files", jsonRequest("POST", {
        id,
        name: file.name,
        type: metadata.type ?? "",
        subject: metadata.subject ?? "",
        mimeType: contentType || blob.contentType || "application/octet-stream",
        size: file.size,
        url: blob.url,
        createdAt: Date.now()
    }));
    mutateCollection("files", result);
    return result;
}

export async function migrateLegacyFile(file, content) {
    let blobUrl = "";
    if (content instanceof Blob) {
        const contentType = getUploadContentType(
            { name: file.name, type: content.type },
            file.mimeType
        );
        const blob = await upload(`${file.id}-${file.name}`, content, {
            access: "public",
            contentType,
            handleUploadUrl: `${API_ROOT}/files/upload-token`,
            multipart: content.size > 5 * 1024 * 1024
        });
        blobUrl = blob.url;
    }
    const result = await request("/migration/files", jsonRequest("POST", {
        id: file.id,
        name: file.name ?? "datei",
        type: file.type ?? "",
        subject: file.subject ?? "",
        url: file.url ?? "",
        blobUrl,
        mimeType: content instanceof Blob
            ? getUploadContentType({ name: file.name, type: content.type }, file.mimeType)
            : getUploadContentType({ name: file.name, type: file.mimeType }, file.mimeType),
        size: content?.size ?? file.size ?? 0,
        createdAt: file.createdAt ?? Date.now()
    }));
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
            `Die Datei konnte nicht aus Vercel Blob geladen werden. (${requestError.message})`
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
    let stopped = false;
    let unavailable = false;
    const refresh = async () => {
        if (stopped) return;
        try {
            await refreshSharedData();
            if (unavailable) unavailable = false;
            onUpdate();
        } catch (syncError) {
            console.error("[Schulorganizer] Gemeinsame Daten konnten nicht aktualisiert werden:", syncError);
            if (!unavailable) {
                unavailable = true;
                onUnavailable(syncError);
            }
        }
    };
    const interval = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
        stopped = true;
        window.clearInterval(interval);
        window.removeEventListener("focus", refresh);
        document.removeEventListener("visibilitychange", refresh);
    };
}
