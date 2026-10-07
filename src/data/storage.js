const STORAGE_PREFIX = "schulorganizer_";
const storageIssues = [];

function recordStorageIssue(message) {
    storageIssues.push(message);
}

export function reportStorageIssue(message) {
    recordStorageIssue(message);
}

export function getStorageIssues() {
    return storageIssues.splice(0);
}

function getKey(key) {
    return `${STORAGE_PREFIX}${key}`;
}

export function set(key, value) {
    try {
        localStorage.setItem(
            getKey(key),
            JSON.stringify(value)
        );

        return true;
    } catch (error) {
        console.error(
            "[Schulorganizer] Fehler beim Speichern:",
            error
        );
        recordStorageIssue("Speichern im Browserspeicher fehlgeschlagen.");

        return false;
    }
}

export function get(key, fallback = null) {
    try {
        const stored = localStorage.getItem(
            getKey(key)
        );

        if (stored === null) {
            return fallback;
        }

        return JSON.parse(stored);
    } catch (error) {
        console.error(
            "[Schulorganizer] Fehler beim Laden:",
            error
        );
        recordStorageIssue("Gespeicherte Inhalte konnten nicht gelesen werden.");

        return fallback;
    }
}

export function remove(key) {
    try {
        localStorage.removeItem(
            getKey(key)
        );

        return true;
    } catch (error) {
        console.error(
            "[Schulorganizer] Fehler beim Löschen:",
            error
        );

        return false;
    }
}

export function exists(key) {
    try {
        return localStorage.getItem(getKey(key)) !== null;
    } catch (error) {
        console.error("[Schulorganizer] Speicherzugriff fehlgeschlagen:", error);
        recordStorageIssue("Der Browserspeicher ist nicht verfügbar.");
        return false;
    }
}

export function clear() {
    try {
        const keys = [];

        for (
            let i = 0;
            i < localStorage.length;
            i++
        ) {
            const key = localStorage.key(i);

            if (key?.startsWith(STORAGE_PREFIX)) {
                keys.push(key);
            }
        }

        keys.forEach(key => {
            localStorage.removeItem(key);
        });

        return true;
    } catch (error) {
        console.error(
            "[Schulorganizer] Fehler beim Leeren des Speichers:",
            error
        );

        return false;
    }
}