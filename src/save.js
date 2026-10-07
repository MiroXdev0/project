import {
    set,
    get,
    remove,
    exists,
    clear,
    getStorageIssues,
    reportStorageIssue
} from "./data/storage.js";

export function saveData(key, data) {
    if (!set(key, data)) {
        throw new Error("Die Daten konnten nicht im Browserspeicher gespeichert werden.");
    }

    return true;
}

export function loadData(key, fallback = []) {
    const data = get(key, fallback);

    if (
        Array.isArray(fallback) &&
        !Array.isArray(data)
    ) {
        console.error(
            `[Schulorganizer] Gespeicherte Daten für "${key}" haben ein ungültiges Format.`
        );
        reportStorageIssue("Einige gespeicherte Inhalte haben ein ungültiges Format.");
        return fallback;
    }

    if (Array.isArray(fallback)) {
        const validItems = data.filter(
            item => item && typeof item === "object" && !Array.isArray(item)
        );

        if (validItems.length !== data.length) {
            console.error(
                `[Schulorganizer] Ungültige Einträge in "${key}" wurden übersprungen.`
            );
            reportStorageIssue("Einige gespeicherte Einträge waren ungültig und wurden übersprungen.");
        }

        return validItems;
    }

    return data;
}

export function removeData(key) {
    return remove(key);
}

export function hasData(key) {
    return exists(key);
}

export function clearData() {
    return clear();
}

export { getStorageIssues, reportStorageIssue };