import { loadData, saveData } from "../save.js";

const STORAGE_KEY = "notes";

let notes = loadData(STORAGE_KEY, []);

export function getNotes() {
    return notes;
}

export function addNote(
    title,
    content,
    subject = ""
) {
    const note = {
        id: crypto.randomUUID(),
        title,
        content,
        subject,
        createdAt: Date.now()
    };

    notes.push(note);
    try {
        saveData(STORAGE_KEY, notes);
    } catch (error) {
        notes.pop();
        throw error;
    }

    return note;
}

export function updateNote(id, changes) {
    const note = notes.find(
        item => item.id === id
    );

    if (!note) {
        return null;
    }

    const previous = { ...note };
    Object.assign(note, changes);
    try {
        saveData(STORAGE_KEY, notes);
    } catch (error) {
        Object.assign(note, previous);
        throw error;
    }

    return note;
}

export function deleteNote(id) {
    const previousNotes = notes;
    notes = notes.filter(
        item => item.id !== id
    );

    try {
        saveData(STORAGE_KEY, notes);
    } catch (error) {
        notes = previousNotes;
        throw error;
    }
}