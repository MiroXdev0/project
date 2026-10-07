const DATABASE_NAME = "schulorganizer-files";
const DATABASE_VERSION = 1;
const STORE_NAME = "files";

let databasePromise;

function openDatabase() {
    if (!("indexedDB" in window)) {
        return Promise.reject(
            new Error("Dieser Browser unterstützt keine lokale Dateispeicherung.")
        );
    }

    if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(
                DATABASE_NAME,
                DATABASE_VERSION
            );

            request.onupgradeneeded = () => {
                const database = request.result;

                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                databasePromise = null;
                reject(request.error ?? new Error("Dateispeicher konnte nicht geöffnet werden."));
            };
        });
    }

    return databasePromise;
}

async function withStore(mode, operation) {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        let result;
        let settled = false;

        request.onsuccess = () => {
            result = request.result;
        };
        request.onerror = () => {
            settled = true;
            reject(request.error ?? new Error("Dateioperation fehlgeschlagen."));
        };
        transaction.oncomplete = () => {
            if (!settled) resolve(result);
        };
        transaction.onabort = () => {
            if (!settled) {
                settled = true;
                reject(transaction.error ?? new Error("Dateioperation wurde abgebrochen."));
            }
        };
    });
}

export function storeFile(id, blob) {
    return withStore("readwrite", store => store.put(blob, id));
}

export function readFile(id) {
    return withStore("readonly", store => store.get(id));
}

export function removeStoredFile(id) {
    return withStore("readwrite", store => store.delete(id));
}
