import {
    loadData,
    saveData,
    reportStorageIssue
} from "../save.js";

const STORAGE_KEY = "subjects";

const storedSubjects = loadData(STORAGE_KEY, []);
const validSubjects = storedSubjects.filter(
    subject => typeof subject.name === "string" && subject.name.trim()
);
if (validSubjects.length !== storedSubjects.length) {
    reportStorageIssue("Einige fehlerhafte Fächer wurden übersprungen.");
}
let subjects = validSubjects.map(subject => ({
    ...subject,
    id: subject.id ?? crypto.randomUUID(),
    name: subject.name.trim(),
    createdAt: typeof subject.createdAt === "number"
        ? subject.createdAt
        : Date.now()
}));

export function getSubjects() {
    return subjects;
}

export function addSubject(name) {
    const trimmedName = name.trim();

    if (!trimmedName) {
        return null;
    }

    const existing = subjects.find(
        subject =>
            subject.name.toLowerCase() ===
            trimmedName.toLowerCase()
    );

    if (existing) {
        return existing;
    }

    const subject = {
        id: crypto.randomUUID(),
        name: trimmedName,
        createdAt: Date.now()
    };

    subjects.push(subject);
    try {
        saveData(STORAGE_KEY, subjects);
    } catch (error) {
        subjects.pop();
        throw error;
    }

    return subject;
}

export function deleteSubject(id) {
    const previousSubjects = subjects;
    subjects = subjects.filter(
        subject => subject.id !== id
    );

    try {
        saveData(STORAGE_KEY, subjects);
    } catch (error) {
        subjects = previousSubjects;
        throw error;
    }
}