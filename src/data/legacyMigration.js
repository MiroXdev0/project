import {
    getSharedFiles,
    getSharedPresentations,
    migrateLegacyFile,
    migrateLegacyPresentation
} from "./sharedApi.js";

const migrationKey = "schulorganizer_shared_migration_v1";
const migratedRecordsKey = "schulorganizer_shared_migration_records_v1";
const legacyDatabaseName = "schulorganizer-files";
const legacyStoreName = "files";

function readLegacyList(key) {
    const stored = localStorage.getItem(`schulorganizer_${key}`);
    if (stored === null) return [];

    const value = JSON.parse(stored);
    if (!Array.isArray(value)) {
        throw new Error(`Die lokal gespeicherte Liste „${key}“ hat ein ungültiges Format.`);
    }
    return value.filter(item => item && typeof item === "object" && !Array.isArray(item));
}

function readLegacyFiles(fileIds) {
    if (fileIds.length === 0) return Promise.resolve(new Map());
    if (!("indexedDB" in window)) {
        return Promise.reject(new Error("Der frühere lokale Dateispeicher ist in diesem Browser nicht verfügbar."));
    }

    return new Promise((resolve, reject) => {
        const opening = indexedDB.open(legacyDatabaseName);
        opening.onerror = () => reject(opening.error ?? new Error("Der frühere Dateispeicher konnte nicht geöffnet werden."));
        opening.onsuccess = () => {
            const database = opening.result;
            if (!database.objectStoreNames.contains(legacyStoreName)) {
                database.close();
                resolve(new Map());
                return;
            }

            const transaction = database.transaction(legacyStoreName, "readonly");
            const store = transaction.objectStore(legacyStoreName);
            const contents = new Map();
            fileIds.forEach(id => {
                const read = store.get(id);
                read.onsuccess = () => {
                    if (read.result instanceof Blob) contents.set(id, read.result);
                };
            });
            transaction.oncomplete = () => {
                database.close();
                resolve(contents);
            };
            transaction.onerror = () => {
                database.close();
                reject(transaction.error ?? new Error("Alte Dateiinhalte konnten nicht gelesen werden."));
            };
            transaction.onabort = () => {
                database.close();
                reject(transaction.error ?? new Error("Das Lesen alter Dateien wurde abgebrochen."));
            };
        };
    });
}

export async function migrateLegacySharedData() {
    const legacyFiles = readLegacyList("files");
    const legacyPresentations = readLegacyList("presentations");
    if (legacyFiles.length === 0 && legacyPresentations.length === 0) {
        localStorage.setItem(migrationKey, "complete");
        return { files: 0, presentations: 0 };
    }

    const storedRecords = localStorage.getItem(migratedRecordsKey);
    const migratedRecords = storedRecords
        ? JSON.parse(storedRecords)
        : { files: [], presentations: [] };
    if (!Array.isArray(migratedRecords.files) || !Array.isArray(migratedRecords.presentations)) {
        throw new Error("Der lokale Fortschritt für die Dateiübernahme ist beschädigt.");
    }
    const migratedFileIds = new Set(migratedRecords.files);
    const migratedPresentationIds = new Set(migratedRecords.presentations);
    const serverFiles = new Map(getSharedFiles().map(file => [file.id, file]));
    const serverPresentations = new Map(
        getSharedPresentations().map(presentation => [presentation.id, presentation])
    );

    const contents = await readLegacyFiles(
        legacyFiles
            .filter(file => {
                const serverFile = serverFiles.get(file.id);
                return !file.url && !serverFile?.hasContent;
            })
            .filter(file => typeof file.id === "string")
            .map(file => file.id)
    );
    let importedFiles = 0;
    let importedPresentations = 0;

    for (const file of legacyFiles) {
        if (typeof file.id !== "string" || !file.id || typeof file.name !== "string") {
            throw new Error("Eine frühere Datei hat keine gültige ID oder keinen Dateinamen.");
        }
        const serverFile = serverFiles.get(file.id);
        if (migratedFileIds.has(file.id) && !serverFile) continue;
        if (serverFile?.hasContent || (serverFile && file.url)) {
            migratedFileIds.add(file.id);
            continue;
        }
        const content = contents.get(file.id);
        if (!file.url && !content) {
            throw new Error(`Der Originalinhalt von „${file.name}“ ist im früheren Gerätespeicher nicht verfügbar. Die Datei wurde nicht als übernommen markiert.`);
        }
        const result = await migrateLegacyFile(file, content);
        if (result.migrated || result.repaired) importedFiles += 1;
        migratedFileIds.add(file.id);
        localStorage.setItem(migratedRecordsKey, JSON.stringify({
            files: [...migratedFileIds],
            presentations: [...migratedPresentationIds]
        }));
    }
    for (const presentation of legacyPresentations) {
        if (typeof presentation.id !== "string" || !presentation.id ||
            typeof presentation.title !== "string" || !presentation.title.trim()) {
            throw new Error("Ein früheres Projekt hat keine gültige ID oder keinen Titel.");
        }
        const legacyFileIds = Array.isArray(presentation.fileIds)
            ? presentation.fileIds.filter(fileId => typeof fileId === "string")
            : [];
        const serverPresentation = serverPresentations.get(presentation.id);
        if (migratedPresentationIds.has(presentation.id) && !serverPresentation) continue;
        const attachedFileIds = new Set(serverPresentation?.fileIds ?? []);
        const missingFileIds = legacyFileIds.filter(
            fileId => !attachedFileIds.has(fileId)
        );
        if (serverPresentation && missingFileIds.length === 0) {
            migratedPresentationIds.add(presentation.id);
            continue;
        }
        const result = await migrateLegacyPresentation(presentation);
        if (result.migrated || result.repaired) importedPresentations += 1;
        migratedPresentationIds.add(presentation.id);
        localStorage.setItem(migratedRecordsKey, JSON.stringify({
            files: [...migratedFileIds],
            presentations: [...migratedPresentationIds]
        }));
    }

    localStorage.setItem(migratedRecordsKey, JSON.stringify({
        files: [...migratedFileIds],
        presentations: [...migratedPresentationIds]
    }));
    localStorage.setItem(migrationKey, "complete");
    return { files: importedFiles, presentations: importedPresentations };
}
