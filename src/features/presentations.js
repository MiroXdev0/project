import { loadData, saveData } from "../save.js";

const STORAGE_KEY = "presentations";

let presentations = loadData(STORAGE_KEY, []);

export function getPresentations() {
    return presentations;
}

export function addPresentation(
    title,
    subject = "",
    date = "",
    description = "",
    details = {}
) {
    const presentation = {
        id: details.id ?? crypto.randomUUID(),
        title,
        subject,
        date,
        description,
        fileIds: details.fileIds ?? [],
        createdAt: Date.now()
    };

    presentations.push(presentation);
    try {
        saveData(STORAGE_KEY, presentations);
    } catch (error) {
        presentations.pop();
        throw error;
    }

    return presentation;
}

export function updatePresentation(id, changes) {
    const presentation = presentations.find(
        item => item.id === id
    );

    if (!presentation) {
        return null;
    }

    const previous = { ...presentation };
    Object.assign(presentation, changes);
    try {
        saveData(STORAGE_KEY, presentations);
    } catch (error) {
        Object.assign(presentation, previous);
        throw error;
    }

    return presentation;
}

export function deletePresentation(id) {
    const previousPresentations = presentations;
    presentations = presentations.filter(
        item => item.id !== id
    );

    try {
        saveData(STORAGE_KEY, presentations);
    } catch (error) {
        presentations = previousPresentations;
        throw error;
    }
}