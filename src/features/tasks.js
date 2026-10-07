import {
    loadData,
    saveData,
    reportStorageIssue
} from "../save.js";

const STORAGE_KEY = "tasks";

const storedTasks = loadData(STORAGE_KEY, []);
let tasks = storedTasks;

function persist() {
    saveData(STORAGE_KEY, tasks);
}

function normalizeTask(task) {
    return {
        id: task.id ?? crypto.randomUUID(),

        title: String(task.title ?? "").trim(),

        subject: String(task.subject ?? "").trim(),

        deadline: String(task.deadline ?? ""),

        priority:
            task.priority === "high" ||
            task.priority === "low"
                ? task.priority
                : "normal",

        completed: Boolean(task.completed),

        createdAt:
            typeof task.createdAt === "number"
                ? task.createdAt
                : Date.now(),

        updatedAt:
            typeof task.updatedAt === "number"
                ? task.updatedAt
                : Date.now()
    };
}

// Make old localStorage data compatible
const validStoredTasks = tasks.filter(
    task => task && typeof task === "object" && !Array.isArray(task)
);
if (validStoredTasks.length !== tasks.length) {
    reportStorageIssue("Einige fehlerhafte Aufgabendaten wurden übersprungen.");
}
tasks = validStoredTasks.map(normalizeTask);

if (JSON.stringify(tasks) !== JSON.stringify(storedTasks)) {
    try {
        persist();
    } catch (error) {
        console.error("[Schulorganizer] Aufgabenmigration fehlgeschlagen:", error);
    }
}


export function getTasks() {
    return [...tasks];
}


export function getTask(id) {
    return (
        tasks.find(task => task.id === id) ??
        null
    );
}


export function addTask({
    title,
    subject = "",
    deadline = "",
    priority = "normal"
}) {
    const cleanTitle = String(
        title ?? ""
    ).trim();

    if (!cleanTitle) {
        return null;
    }

    const task = normalizeTask({
        id: crypto.randomUUID(),

        title: cleanTitle,

        subject: String(
            subject ?? ""
        ).trim(),

        deadline: String(
            deadline ?? ""
        ),

        priority,

        completed: false,

        createdAt: Date.now(),

        updatedAt: Date.now()
    });

    tasks.push(task);
    try {
        persist();
    } catch (error) {
        tasks.pop();
        throw error;
    }

    return task;
}


export function updateTask(id, changes = {}) {
    const index = tasks.findIndex(
        task => task.id === id
    );

    if (index === -1) {
        return null;
    }

    const currentTask = tasks[index];

    const updatedTask = normalizeTask({
        ...currentTask,
        ...changes,

        id: currentTask.id,

        createdAt: currentTask.createdAt,

        updatedAt: Date.now()
    });

    tasks[index] = updatedTask;
    try {
        persist();
    } catch (error) {
        tasks[index] = currentTask;
        throw error;
    }

    return updatedTask;
}


export function toggleTask(id) {
    const task = getTask(id);

    if (!task) {
        return null;
    }

    return updateTask(id, {
        completed: !task.completed
    });
}


export function completeTask(id) {
    return updateTask(id, {
        completed: true
    });
}


export function reopenTask(id) {
    return updateTask(id, {
        completed: false
    });
}


export function deleteTask(id) {
    const exists = tasks.some(
        task => task.id === id
    );

    if (!exists) {
        return false;
    }

    const previousTasks = tasks;
    tasks = tasks.filter(
        task => task.id !== id
    );

    try {
        persist();
    } catch (error) {
        tasks = previousTasks;
        throw error;
    }

    return true;
}


export function clearTasks() {
    const previousTasks = tasks;
    tasks = [];

    try {
        persist();
    } catch (error) {
        tasks = previousTasks;
        throw error;
    }
}


export function getOpenTasks() {
    return tasks.filter(
        task => !task.completed
    );
}


export function getCompletedTasks() {
    return tasks.filter(
        task => task.completed
    );
}