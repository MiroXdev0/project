import assert from "node:assert/strict";
import { test } from "node:test";

class MemoryStorage {
    values = new Map();

    getItem(key) {
        return this.values.get(key) ?? null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

globalThis.localStorage = new MemoryStorage();

test("local feature getters return snapshots and note identity stays stable", async () => {
    const tasks = await import("../src/features/tasks.js");
    const notes = await import("../src/features/notes.js");
    const subjects = await import("../src/features/subjects.js");

    const task = tasks.addTask({ title: "Mathe lernen" });
    assert.ok(task);
    task.title = "Rückgabewert geändert";
    tasks.getTasks().pop();
    tasks.getTask(task.id).title = "verändert";
    assert.equal(tasks.getTask(task.id).title, "Mathe lernen");

    const note = notes.addNote("Formeln", "Wichtige Formeln", "Mathematik");
    note.title = "Rückgabewert geändert";
    notes.getNotes()[0].title = "verändert";
    notes.updateNote(note.id, { id: "andere-id", createdAt: 0 });
    assert.equal(notes.getNotes()[0].id, note.id);
    assert.equal(notes.getNotes()[0].createdAt, note.createdAt);
    assert.equal(notes.getNotes()[0].title, "Formeln");
    assert.equal(notes.deleteNote("missing"), false);

    const subject = subjects.addSubject("Mathematik");
    subject.name = "Rückgabewert geändert";
    subjects.getSubjects()[0].name = "verändert";
    assert.equal(subjects.getSubjects()[0].name, "Mathematik");
    assert.equal(subjects.addSubject(" mathematik ")?.id, subject.id);
    assert.equal(subjects.deleteSubject("missing"), false);
});
