import { loadData, saveData } from "../save.js";

const STORAGE_KEY = "files";

let files = loadData(STORAGE_KEY, []);

export function getFiles() {
    return files;
}

export function addFile(
    name,
    type = "",
    subject = "",
    url = "",
    details = {}
) {
    const file = {
        id: details.id ?? crypto.randomUUID(),
        name,
        type,
        subject,
        url,
        mimeType: details.mimeType ?? "",
        size: details.size ?? null,
        createdAt: Date.now()
    };

    files.push(file);

    try {
        saveData(STORAGE_KEY, files);
    } catch (error) {
        files = files.filter(item => item.id !== file.id);
        throw error;
    }

    return file;
}

export function updateFile(id, changes) {
    const file = files.find(
        item => item.id === id
    );

    if (!file) {
        return null;
    }

    const previous = { ...file };
    Object.assign(file, changes);

    try {
        saveData(STORAGE_KEY, files);
    } catch (error) {
        Object.assign(file, previous);
        throw error;
    }

    return file;
}

export function deleteFile(id) {
    const previousFiles = files;
    files = files.filter(
        item => item.id !== id
    );

    try {
        saveData(STORAGE_KEY, files);
    } catch (error) {
        files = previousFiles;
        throw error;
    }
}