import "./style.css";

import {
    getTasks,
    addTask,
    updateTask,
    toggleTask,
    deleteTask
} from "./features/tasks.js";

import {
    getPresentations,
    addPresentation,
    updatePresentation,
    deletePresentation
} from "./features/presentations.js";

import {
    getNotes,
    addNote,
    updateNote,
    deleteNote
} from "./features/notes.js";

import {
    getFiles,
    addFile,
    updateFile,
    deleteFile
} from "./features/files.js";
import {
    readFile,
    removeStoredFile,
    storeFile
} from "./data/fileStorage.js";

import {
    getSubjects,
    addSubject,
    deleteSubject
} from "./features/subjects.js";

import {
    openModal,
    closeModal,
    createForm,
    createField,
    createSelect
} from "./components/modal.js";

import {
    navigateTo
} from "./components/navigation.js";

import {
    success,
    error
} from "./components/notifications.js";
import { getStorageIssues } from "./save.js";


const addButton = document.querySelector("#addButton");

const taskCount = document.querySelector("#taskCount");
const presentationCount = document.querySelector("#presentationCount");
const noteCount = document.querySelector("#noteCount");
const fileCount = document.querySelector("#fileCount");

const recentTasks = document.querySelector("#recentTasks");
const taskList = document.querySelector("#taskList");
const presentationList =
    document.querySelector("#presentationList");
const noteList = document.querySelector("#noteList");
const fileList = document.querySelector("#fileList");
const subjectList = document.querySelector("#subjectList");
const subjectCount = document.querySelector("#subjectCount");
const subjectFilters = {
    tasks: document.querySelector("#taskSubjectFilter"),
    presentations: document.querySelector("#presentationSubjectFilter"),
    notes: document.querySelector("#noteSubjectFilter"),
    files: document.querySelector("#fileSubjectFilter")
};
const dashboardCards =
    document.querySelectorAll("[data-dashboard-page]");
const addMenu = document.querySelector("#addMenu");
let activePreviewUrls = [];
let filePreviewUrls = [];
let selectionPreviewUrls = [];


/*
|--------------------------------------------------------------------------
| Utilities
|--------------------------------------------------------------------------
*/

function createElement(tag, className = "", text = "") {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text) {
        element.textContent = text;
    }

    return element;
}


function formatDate(date) {
    if (!date) {
        return "Kein Termin";
    }

    const parsed = new Date(`${date}T00:00:00`);

    if (Number.isNaN(parsed.getTime())) {
        return date;
    }

    return new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(parsed);
}


function formatCreatedDate(timestamp) {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
        return "";
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(date);
}


function createActionButton(text, className = "") {
    const button = createElement(
        "button",
        `item-action ${className}`,
        text
    );

    button.type = "button";

    return button;
}


function createItemActions({
    onEdit,
    onDelete
}) {
    const actions = createElement(
        "div",
        "item-actions"
    );

    const editButton = createActionButton(
        "Bearbeiten"
    );

    editButton.addEventListener(
        "click",
        () => runAction(onEdit)
    );

    const deleteButton = createActionButton(
        "Löschen",
        "danger-action"
    );

    deleteButton.addEventListener(
        "click",
        () => runAction(onDelete)
    );

    actions.append(
        editButton,
        deleteButton
    );

    return actions;
}


function showEmptyState(
    container,
    title,
    description = "",
    actionText = "",
    onAction = null
) {
    container.replaceChildren();

    const empty = createElement("div", "empty-state");
    empty.appendChild(createElement("h4", "", title));

    if (description) {
        empty.appendChild(createElement("p", "", description));
    }

    if (actionText && onAction) {
        const action = createElement("button", "primary-button", actionText);
        action.type = "button";
        action.addEventListener("click", () => runAction(onAction));
        empty.appendChild(action);
    }

    container.appendChild(empty);
}

async function runAction(action) {
    try {
        await action?.();
    } catch (actionError) {
        console.error("[Schulorganizer] Aktion fehlgeschlagen:", actionError);
        try {
            renderAll();
        } catch (renderError) {
            console.error("[Schulorganizer] Ansicht konnte nicht aktualisiert werden:", renderError);
        }
        error("Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut.");
    }
}


function getSubjectOptions() {
    return [
        {
            value: "",
            label: "Kein Fach"
        },
        ...getSubjects().map(subject => ({
            value: subject.name,
            label: subject.name
        }))
    ];
}

function getSelectedSubject(page) {
    return subjectFilters[page]?.value ?? "";
}

function renderSubjectFilters() {
    for (const [page, select] of Object.entries(subjectFilters)) {
        if (!select) {
            continue;
        }

        const currentValue = select.value;
        select.replaceChildren();

        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = "Alle Fächer";
        select.appendChild(allOption);

        getSubjects().forEach(subject => {
            const option = document.createElement("option");
            option.value = subject.name;
            option.textContent = subject.name;
            select.appendChild(option);
        });

        select.value = [...select.options].some(
            option => option.value === currentValue
        ) ? currentValue : "";

        select.onchange = () => {
            if (page === "tasks") renderTasks();
            if (page === "presentations") renderPresentations();
            if (page === "notes") renderNotes();
            if (page === "files") renderFiles();
        };
    }
}


function confirmDelete(message) {
    return window.confirm(message);
}

function isSafeFileUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}


/*
|--------------------------------------------------------------------------
| Dashboard
|--------------------------------------------------------------------------
*/

function renderDashboard() {
    const tasks = getTasks();
    const presentations = getPresentations();
    const notes = getNotes();
    const files = getFiles();

    const openTasks = tasks.filter(
        task => !task.completed
    );

    taskCount.textContent = openTasks.length;
    presentationCount.textContent =
        presentations.length;
    noteCount.textContent = notes.length;
    fileCount.textContent = files.length;
    subjectCount.textContent = getSubjects().length;

    renderRecentTasks();
}


function renderRecentTasks() {
    const tasks = getTasks()
        .filter(task => !task.completed)
        .sort((a, b) => {
            if (!a.deadline) {
                return 1;
            }

            if (!b.deadline) {
                return -1;
            }

            return a.deadline.localeCompare(
                b.deadline
            );
        })
        .slice(0, 5);

    if (tasks.length === 0) {
        const hasTasks = getTasks().length > 0;
        showEmptyState(
            recentTasks,
            hasTasks ? "Alles erledigt" : "Noch keine Aufgaben",
            hasTasks
                ? "Hier erscheinen deine nächsten offenen Aufgaben."
                : "Füge deine erste Aufgabe hinzu, damit du den Überblick behältst.",
            "Aufgabe hinzufügen",
            openTaskModal
        );

        return;
    }

    recentTasks.replaceChildren();

    tasks.forEach(task => {
        recentTasks.appendChild(
            createTaskElement(task)
        );
    });
}


/*
|--------------------------------------------------------------------------
| Tasks
|--------------------------------------------------------------------------
*/

function createTaskElement(task) {
    const item = createElement(
        "article",
        "list-item"
    );

    const main = createElement(
        "div",
        "item-main"
    );

    const checkbox = createElement(
        "input",
        "task-checkbox"
    );

    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute(
        "aria-label",
        `${task.title} erledigt`
    );

    checkbox.addEventListener(
        "change",
        () => runAction(() => {
            const updatedTask = toggleTask(task.id);
            if (!updatedTask) {
                throw new Error("Aufgabe nicht gefunden.");
            }

            renderAll();

            success(
                updatedTask.completed
                    ? "Aufgabe erledigt."
                    : "Aufgabe wieder geöffnet."
            );
        })
    );

    const content = createElement(
        "div",
        "item-content"
    );

    const title = createElement(
        "h4",
        "",
        task.title
    );

    if (task.completed) {
        title.classList.add(
            "completed-text"
        );
    }

    const meta = createElement(
        "div",
        "item-meta"
    );

    if (task.priority === "high" && !task.completed) {
        meta.appendChild(
            createElement("span", "item-tag priority-high", "Hohe Priorität")
        );
    }

    if (task.subject) {
        meta.appendChild(
            createElement(
                "span",
                "item-tag",
                task.subject
            )
        );
    }

    if (task.deadline) {
        const now = new Date();
        const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0")
        ].join("-");
        const isOverdue = !task.completed && task.deadline < today;
        meta.appendChild(
            createElement(
                "span",
                isOverdue ? "item-tag task-overdue" : "",
                isOverdue
                    ? `Überfällig: ${formatDate(task.deadline)}`
                    : `Fällig: ${formatDate(task.deadline)}`
            )
        );
    }

    content.append(
        title,
        meta
    );

    main.append(
        checkbox,
        content
    );

    const actions = createItemActions({
        onEdit: () => openTaskModal(task),

        onDelete: () => {
            if (!confirmDelete(
                `Möchtest du "${task.title}" wirklich löschen?`
            )) {
                return;
            }

            deleteTask(task.id);

            renderAll();

            success("Aufgabe gelöscht.");
        }
    });

    item.append(
        main,
        actions
    );

    return item;
}


function renderTasks() {
    const selectedSubject = getSelectedSubject("tasks");
    const tasks = getTasks().filter(
        task => !selectedSubject || task.subject === selectedSubject
    );

    if (tasks.length === 0) {
        showEmptyState(
            taskList,
            selectedSubject
                ? `Keine Aufgaben im Fach ${selectedSubject}`
                : "Noch keine Aufgaben",
            selectedSubject
                ? "Wähle ein anderes Fach oder setze den Filter zurück."
                : "Füge deine erste Aufgabe hinzu, damit du den Überblick behältst.",
            selectedSubject ? "Filter zurücksetzen" : "Aufgabe hinzufügen",
            selectedSubject
                ? () => {
                    subjectFilters.tasks.value = "";
                    renderTasks();
                }
                : openTaskModal
        );

        return;
    }

    taskList.replaceChildren();

    const sortedTasks = [...tasks].sort(
        (a, b) => {
            if (a.completed !== b.completed) {
                return a.completed
                    ? 1
                    : -1;
            }

            if (!a.deadline) {
                return 1;
            }

            if (!b.deadline) {
                return -1;
            }

            return a.deadline.localeCompare(
                b.deadline
            );
        }
    );

    sortedTasks.forEach(task => {
        taskList.appendChild(
            createTaskElement(task)
        );
    });
}


/*
|--------------------------------------------------------------------------
| Task modal
|--------------------------------------------------------------------------
*/

function openTaskModal(existingTask = null) {
    const isEditing = Boolean(existingTask);

    const form = createForm();

    const titleField = createField({
        label: "Titel",
        placeholder: "z. B. Mathe Hausaufgaben",
        value: existingTask?.title ?? "",
        name: "title",
        required: true,
        maxLength: 120
    });

    const subjectField = createSelect({
        label: "Fach",
        name: "subject",
        options: getSubjectOptions(),
        value: existingTask?.subject ?? ""
    });

    const deadlineField = createField({
        label: "Abgabetermin",
        type: "date",
        value: existingTask?.deadline ?? "",
        name: "deadline"
    });

    const priorityField = createSelect({
        label: "Priorität",
        name: "priority",
        options: [
            {
                value: "low",
                label: "Niedrig"
            },
            {
                value: "normal",
                label: "Normal"
            },
            {
                value: "high",
                label: "Hoch"
            }
        ],
        value: existingTask?.priority ?? "normal"
    });

    form.append(
        titleField,
        subjectField,
        deadlineField,
        priorityField
    );

    openModal({
        title: isEditing
            ? "Aufgabe bearbeiten"
            : "Neue Aufgabe",

        content: form,

        onSubmit: () => {
            const title =
                titleField.querySelector("input")
                    .value.trim();

            if (!title) {
                error(
                    "Bitte einen Titel eingeben."
                );

                return;
            }

            const subject =
                subjectField.querySelector("select")
                    .value;

            const deadline =
                deadlineField.querySelector("input")
                    .value;

            const priority =
                priorityField.querySelector("select")
                    .value;

            if (isEditing) {
                updateTask(
                    existingTask.id,
                    {
                        title,
                        subject,
                        deadline,
                        priority
                    }
                );

                success(
                    "Aufgabe aktualisiert."
                );
            } else {
                addTask({
                    title,
                    subject,
                    deadline,
                    priority
                });

                success(
                    "Aufgabe hinzugefügt."
                );
            }

            closeModal();
            renderAll();
        }
    });
}


/*
|--------------------------------------------------------------------------
| Presentations
|--------------------------------------------------------------------------
*/

function createPresentationElement(
    presentation
) {
    const item = createElement(
        "article",
        "list-item"
    );

    const content = createElement(
        "div",
        "item-content"
    );

    const title = createElement(
        "h4",
        "",
        presentation.title
    );

    const meta = createElement(
        "div",
        "item-meta"
    );

    if (presentation.subject) {
        meta.appendChild(
            createElement(
                "span",
                "item-tag",
                presentation.subject
            )
        );
    }

    if (presentation.date) {
        meta.appendChild(
            createElement(
                "span",
                "",
                `Termin: ${formatDate(
                    presentation.date
                )}`
            )
        );
    }

    content.append(
        title,
        meta
    );

    if (presentation.description) {
        const description =
            createElement(
                "p",
                "item-description",
                presentation.description
            );

        content.appendChild(
            description
        );
    }

    const actions = createItemActions({
        onEdit: () =>
            openPresentationModal(
                presentation
            ),

        onDelete: () => {
            if (!confirmDelete(
                `Möchtest du "${presentation.title}" wirklich löschen?`
            )) {
                return;
            }

            deletePresentation(
                presentation.id
            );

            renderAll();

            success(
                "Präsentation gelöscht."
            );
        }
    });

    item.append(
        content,
        actions
    );

    return item;
}


function renderPresentations() {
    const selectedSubject = getSelectedSubject("presentations");
    const presentations = getPresentations().filter(
        presentation =>
            !selectedSubject || presentation.subject === selectedSubject
    );

    if (presentations.length === 0) {
        showEmptyState(
            presentationList,
            selectedSubject
                ? `Keine Präsentationen im Fach ${selectedSubject}`
                : "Noch keine Präsentationen",
            "Plane Referate und behalte wichtige Termine im Blick.",
            selectedSubject ? "Filter zurücksetzen" : "Präsentation hinzufügen",
            selectedSubject
                ? () => {
                    subjectFilters.presentations.value = "";
                    renderPresentations();
                }
                : openPresentationModal
        );

        return;
    }

    presentationList.replaceChildren();

    [...presentations]
        .sort(
            (a, b) =>
                (a.date || "9999")
                    .localeCompare(
                        b.date || "9999"
                    )
        )
        .forEach(presentation => {
            presentationList.appendChild(
                createPresentationElement(
                    presentation
                )
            );
        });
}


function openPresentationModal(
    existingPresentation = null
) {
    const isEditing =
        Boolean(existingPresentation);

    const form = createForm();

    const titleField = createField({
        label: "Titel",
        placeholder:
            "z. B. Referat über die Französische Revolution",
        value:
            existingPresentation?.title ?? "",
        name: "title",
        required: true,
        maxLength: 160
    });

    const subjectField = createSelect({
        label: "Fach",
        name: "subject",
        options: getSubjectOptions(),
        value:
            existingPresentation?.subject ?? ""
    });

    const dateField = createField({
        label: "Präsentationstermin",
        type: "date",
        value:
            existingPresentation?.date ?? "",
        name: "date"
    });

    const descriptionField = createField({
        label: "Beschreibung",
        type: "textarea",
        placeholder:
            "Thema, wichtige Punkte oder Informationen...",
        value:
            existingPresentation?.description ?? "",
        name: "description",
        maxLength: 5000
    });

    form.append(
        titleField,
        subjectField,
        dateField,
        descriptionField
    );

    openModal({
        title: isEditing
            ? "Präsentation bearbeiten"
            : "Neue Präsentation",

        content: form,

        onSubmit: () => {
            const title =
                titleField.querySelector(
                    "input"
                ).value.trim();

            if (!title) {
                error(
                    "Bitte einen Titel eingeben."
                );

                return;
            }

            const subject =
                subjectField.querySelector(
                    "select"
                ).value;

            const date =
                dateField.querySelector(
                    "input"
                ).value;

            const description =
                descriptionField.querySelector(
                    "textarea"
                ).value.trim();

            if (isEditing) {
                updatePresentation(
                    existingPresentation.id,
                    {
                        title,
                        subject,
                        date,
                        description
                    }
                );

                success(
                    "Präsentation aktualisiert."
                );
            } else {
                addPresentation(
                    title,
                    subject,
                    date,
                    description
                );

                success(
                    "Präsentation hinzugefügt."
                );
            }

            closeModal();
            renderAll();
        }
    });
}


/*
|--------------------------------------------------------------------------
| Notes
|--------------------------------------------------------------------------
*/

function createNoteElement(note) {
    const item = createElement(
        "article",
        "list-item"
    );

    const content = createElement(
        "div",
        "item-content"
    );

    const title = createElement(
        "h4",
        "",
        note.title
    );

    const meta = createElement(
        "div",
        "item-meta"
    );

    if (note.subject) {
        meta.appendChild(
            createElement(
                "span",
                "item-tag",
                note.subject
            )
        );
    }

    if (note.createdAt) {
        meta.appendChild(
            createElement(
                "span",
                "",
                `Erstellt: ${formatCreatedDate(
                    note.createdAt
                )}`
            )
        );
    }

    content.append(
        title,
        meta
    );

    if (note.content) {
        const description =
            createElement(
                "p",
                "item-description",
                note.content
            );

        content.appendChild(
            description
        );
    }

    const actions = createItemActions({
        onEdit: () =>
            openNoteModal(note),

        onDelete: () => {
            if (!confirmDelete(
                `Möchtest du "${note.title}" wirklich löschen?`
            )) {
                return;
            }

            deleteNote(note.id);

            renderAll();

            success(
                "Notiz gelöscht."
            );
        }
    });

    item.append(
        content,
        actions
    );

    return item;
}


function renderNotes() {
    const selectedSubject = getSelectedSubject("notes");
    const notes = getNotes().filter(
        note => !selectedSubject || note.subject === selectedSubject
    );

    if (notes.length === 0) {
        showEmptyState(
            noteList,
            selectedSubject
                ? `Keine Notizen im Fach ${selectedSubject}`
                : "Noch keine Notizen",
            "Halte wichtige Informationen an einem Ort fest.",
            selectedSubject ? "Filter zurücksetzen" : "Notiz hinzufügen",
            selectedSubject
                ? () => {
                    subjectFilters.notes.value = "";
                    renderNotes();
                }
                : openNoteModal
        );

        return;
    }

    noteList.replaceChildren();

    [...notes]
        .sort(
            (a, b) =>
                b.createdAt - a.createdAt
        )
        .forEach(note => {
            noteList.appendChild(
                createNoteElement(note)
            );
        });
}


function openNoteModal(
    existingNote = null
) {
    const isEditing =
        Boolean(existingNote);

    const form = createForm();

    const titleField = createField({
        label: "Titel",
        placeholder:
            "z. B. Wichtige Matheformeln",
        value:
            existingNote?.title ?? "",
        name: "title",
        required: true,
        maxLength: 160
    });

    const subjectField = createSelect({
        label: "Fach",
        name: "subject",
        options: getSubjectOptions(),
        value:
            existingNote?.subject ?? ""
    });

    const contentField = createField({
        label: "Notiz",
        type: "textarea",
        placeholder:
            "Schreibe deine Notiz hier...",
        value:
            existingNote?.content ?? "",
        name: "content",
        required: true,
        maxLength: 20000
    });

    form.append(
        titleField,
        subjectField,
        contentField
    );

    openModal({
        title: isEditing
            ? "Notiz bearbeiten"
            : "Neue Notiz",

        content: form,

        onSubmit: () => {
            const title =
                titleField.querySelector(
                    "input"
                ).value.trim();

            const content =
                contentField.querySelector(
                    "textarea"
                ).value.trim();

            if (!title || !content) {
                error(
                    "Titel und Notiz dürfen nicht leer sein."
                );

                return;
            }

            const subject =
                subjectField.querySelector(
                    "select"
                ).value;

            if (isEditing) {
                updateNote(
                    existingNote.id,
                    {
                        title,
                        content,
                        subject
                    }
                );

                success(
                    "Notiz aktualisiert."
                );
            } else {
                addNote(
                    title,
                    content,
                    subject
                );

                success(
                    "Notiz hinzugefügt."
                );
            }

            closeModal();
            renderAll();
        }
    });
}


/*
|--------------------------------------------------------------------------
| Files
|--------------------------------------------------------------------------
*/

function createFileElement(file) {
    const item = createElement(
        "article",
        "list-item file-item"
    );

    const preview = createFilePreview(file);
    const content = createElement(
        "div",
        "item-content"
    );

    const title = createElement(
        "h4",
        "",
        file.name
    );

    const meta = createElement(
        "div",
        "item-meta"
    );

    if (file.type) {
        meta.appendChild(
            createElement(
                "span",
                "item-tag",
                file.type
            )
        );
    }

    if (file.subject) {
        meta.appendChild(
            createElement(
                "span",
                "item-tag",
                file.subject
            )
        );
    }

    meta.appendChild(createElement("span", "", formatFileSize(file.size)));
    if (file.createdAt) {
        meta.appendChild(createElement(
            "span",
            "",
            `Hinzugefügt: ${formatCreatedDate(file.createdAt)}`
        ));
    }

    content.append(
        title,
        meta
    );

    const actions = createElement("div", "item-actions file-actions");
    const openButton = createActionButton("Öffnen");
    openButton.addEventListener("click", () => openStoredFile(file));
    const downloadButton = createActionButton("Herunterladen");
    downloadButton.addEventListener("click", () => downloadStoredFile(file));
    const editButton = createActionButton("Details");
    editButton.addEventListener("click", () => openFileModal(file));
    const deleteButton = createActionButton("Löschen", "danger-action");
    deleteButton.addEventListener("click", async () => {
        if (!confirmDelete(`Möchtest du "${file.name}" wirklich löschen?`)) {
            return;
        }

        try {
            const isLink = Boolean(file.url) && !file.size;
            const blob = isLink ? null : await readFile(file.id);
            if (!isLink) {
                await removeStoredFile(file.id);
            }
            try {
                deleteFile(file.id);
            } catch (metadataError) {
                if (!isLink && blob) await storeFile(file.id, blob);
                throw metadataError;
            }
            renderAll();
            success("Datei gelöscht.");
        } catch (deleteError) {
            console.error("[Schulorganizer] Datei konnte nicht gelöscht werden:", deleteError);
            error("Die Datei konnte nicht gelöscht werden. Bitte erneut versuchen.");
        }
    });
    actions.append(openButton, downloadButton, editButton, deleteButton);

    item.append(
        preview,
        content,
        actions
    );

    return item;
}

function inferMimeType(file) {
    if (file.mimeType) {
        return file.mimeType;
    }

    const knownTypes = {
        PDF: "application/pdf",
        Bild: "image/*",
        Video: "video/*",
        Dokument: "application/msword",
        Präsentation: "application/vnd.ms-powerpoint",
        Textdatei: "text/plain",
        Audio: "audio/*"
    };
    if (knownTypes[file.type]) {
        return knownTypes[file.type];
    }

    const extension = String(file.name ?? "").split(".").pop()?.toLowerCase();
    const mimeTypes = {
        pdf: "application/pdf",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        mp4: "video/mp4",
        mov: "video/quicktime",
        webm: "video/webm",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ppt: "application/vnd.ms-powerpoint",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        txt: "text/plain"
    };

    return mimeTypes[extension] ?? "application/octet-stream";
}

function formatFileSize(size) {
    if (!Number.isFinite(size) || size < 0) return "Dateigröße unbekannt";
    if (size === 0) return "0 B";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const previewObserver = new IntersectionObserver(entries => {
    entries.forEach(async entry => {
        if (!entry.isIntersecting) return;
        previewObserver.unobserve(entry.target);

        const id = entry.target.dataset.filePreview;
        try {
            const blob = await readFile(id);
            if (!entry.target.isConnected) return;
            if (!blob) {
                const filename = entry.target.alt.replace(/^Vorschau: /, "");
                entry.target.alt = `Vorschau nicht verfügbar: ${filename}`;
                entry.target.classList.add("preview-unavailable");
                return;
            }
            const previewBlob = await createThumbnail(blob);
            const url = URL.createObjectURL(previewBlob);
            filePreviewUrls.push(url);
            entry.target.src = url;
        } catch (previewError) {
            console.error("[Schulorganizer] Dateivorschau fehlgeschlagen:", previewError);
        }
    });
});

async function createThumbnail(blob) {
    if (!("createImageBitmap" in window)) {
        return blob;
    }

    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
        bitmap.close();
        return blob;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    return new Promise(resolve => {
        canvas.toBlob(thumbnail => resolve(thumbnail ?? blob), "image/jpeg", 0.78);
    });
}

function createFilePreview(file) {
    const type = inferMimeType(file);
    const preview = createElement("div", "file-preview");

    if (type.startsWith("image/")) {
        const image = createElement("img", "file-thumbnail");
        image.alt = `Vorschau: ${file.name}`;
        image.loading = "lazy";
        preview.appendChild(image);
        if (file.url && !file.size && isSafeFileUrl(file.url)) {
            image.src = file.url;
        } else {
            image.dataset.filePreview = file.id;
            previewObserver.observe(image);
        }
    } else {
        const icon = createElement(
            "span",
            "file-type-icon",
            type === "application/pdf"
                ? "PDF"
                : type.startsWith("video/")
                    ? "Video"
                    : type.includes("presentation") || /\.(ppt|pptx)$/i.test(file.name)
                        ? "PPT"
                        : type.includes("word") || /\.(doc|docx)$/i.test(file.name)
                            ? "DOC"
                            : "Datei"
        );
        icon.setAttribute("aria-hidden", "true");
        preview.appendChild(icon);
    }

    return preview;
}

async function openStoredFile(file) {
    if (file.url && !file.size) {
        if (!isSafeFileUrl(file.url)) {
            error("Dieser Datei-Link ist ungültig oder nicht sicher.");
            return;
        }
        window.open(file.url, "_blank", "noopener,noreferrer");
        return;
    }

    try {
        const blob = await readFile(file.id);
        if (!blob) throw new Error("Dateiinhalt fehlt.");
        const url = URL.createObjectURL(blob);
        activePreviewUrls.push(url);

        const type = inferMimeType(file);
        const viewer = createElement("div", "file-viewer");
        let focusTarget = null;

        if (type.startsWith("image/")) {
            const image = createElement("img", "file-viewer-image");
            image.src = url;
            image.alt = file.name;
            focusTarget = image;
            viewer.appendChild(image);
        } else if (type === "application/pdf") {
            const document = createElement("iframe", "file-viewer-document");
            document.src = url;
            document.title = file.name;
            focusTarget = document;
            viewer.appendChild(document);
        } else if (type.startsWith("video/")) {
            const video = createElement("video", "file-viewer-media");
            video.src = url;
            video.controls = true;
            video.playsInline = true;
            video.preload = "metadata";
            focusTarget = video;
            viewer.appendChild(video);
        } else if (type.startsWith("audio/")) {
            const audio = createElement("audio", "file-viewer-media");
            audio.src = url;
            audio.controls = true;
            audio.preload = "metadata";
            focusTarget = audio;
            viewer.appendChild(audio);
        } else if (
            type.startsWith("text/") ||
            type === "application/json" ||
            type === "application/xml"
        ) {
            if (blob.size > 2 * 1024 * 1024) {
                viewer.appendChild(createElement(
                    "p",
                    "file-viewer-message",
                    "Diese Textdatei ist zu groß für die integrierte Vorschau. Du kannst sie herunterladen."
                ));
            } else {
                const text = createElement("pre", "file-viewer-text", await blob.text());
                text.tabIndex = 0;
                focusTarget = text;
                viewer.appendChild(text);
            }
        } else {
            viewer.appendChild(createElement(
                "p",
                "file-viewer-message",
                "Für diesen Dateityp gibt es keine integrierte Vorschau. Du kannst die Datei herunterladen."
            ));
        }

        if (focusTarget) {
            focusTarget.setAttribute("data-initial-focus", "true");
            focusTarget.setAttribute("tabindex", "0");
        } else {
            viewer.tabIndex = -1;
            viewer.setAttribute("data-initial-focus", "true");
        }

        openModal({
            title: file.name,
            content: viewer,
            submitText: "Herunterladen",
            cancelText: "Schließen",
            onSubmit: async () => {
                await downloadStoredFile(file);
                closeModal();
            },
            onClose: () => {
                URL.revokeObjectURL(url);
                activePreviewUrls = activePreviewUrls.filter(item => item !== url);
            }
        });
    } catch (openError) {
        console.error("[Schulorganizer] Datei konnte nicht geöffnet werden:", openError);
        error("Diese Datei ist nicht verfügbar. Lade sie erneut hoch oder entferne den Eintrag.");
    }
}

async function downloadStoredFile(file) {
    try {
        if (file.url && !file.size) {
            if (!isSafeFileUrl(file.url)) {
                error("Dieser Datei-Link ist ungültig oder nicht sicher.");
                return;
            }
            const link = document.createElement("a");
            link.href = file.url;
            link.download = file.name;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.click();
            success("Datei-Link wurde geöffnet. Der Download startet je nach Dateityp im Browser.");
            return;
        }

        const blob = await readFile(file.id);
        if (!blob) throw new Error("Dateiinhalt fehlt.");
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (downloadError) {
        console.error("[Schulorganizer] Download fehlgeschlagen:", downloadError);
        error("Diese Datei ist nicht verfügbar. Lade sie erneut hoch oder entferne den Eintrag.");
    }
}


function renderFiles() {
    const selectedSubject = getSelectedSubject("files");
    const files = getFiles().filter(
        file => !selectedSubject || file.subject === selectedSubject
    );
    filePreviewUrls.forEach(URL.revokeObjectURL);
    filePreviewUrls = [];

    if (files.length === 0) {
        showEmptyState(
            fileList,
            selectedSubject
                ? `Keine Dateien im Fach ${selectedSubject}`
                : "Noch keine Dateien",
            "Lade Arbeitsblätter, Bilder oder andere Schuldateien hoch.",
            selectedSubject ? "Filter zurücksetzen" : "Datei hochladen",
            selectedSubject
                ? () => {
                    subjectFilters.files.value = "";
                    renderFiles();
                }
                : openFileModal
        );

        return;
    }

    fileList.replaceChildren();

    [...files]
        .sort(
            (a, b) =>
                b.createdAt - a.createdAt
        )
        .forEach(file => {
            fileList.appendChild(
                createFileElement(file)
            );
        });
}


function openFileModal(
    existingFile = null
) {
    const isEditing =
        Boolean(existingFile);

    const form = createForm();

    const subjectField = createSelect({
        label: "Fach",
        name: "subject",
        options: getSubjectOptions(),
        value:
            existingFile?.subject ?? ""
    });

    if (isEditing) {
        const nameField = createField({
            label: "Dateiname",
            value: existingFile.name,
            name: "name",
            required: true,
            maxLength: 255
        });
        const typeField = createSelect({
            label: "Dateityp",
            name: "type",
            options: [
                { value: "", label: "Nicht angegeben" },
                { value: "PDF", label: "PDF" },
                { value: "Dokument", label: "Dokument" },
                { value: "Präsentation", label: "Präsentation" },
                { value: "Bild", label: "Bild" },
                { value: "Video", label: "Video" },
                { value: "Sonstiges", label: "Sonstiges" }
            ],
            value: existingFile.type ?? ""
        });
        const urlField = createField({
            label: "Datei-Link",
            type: "url",
            placeholder: "https://…",
            value: existingFile.url ?? "",
            name: "url"
        });
        form.append(nameField, typeField, subjectField, urlField);
    } else {
        const helper = createElement(
            "p",
            "upload-help",
            "Wähle Fotos, Videos, PDFs oder andere Dateien von deinem Gerät aus."
        );
        const dropZone = createElement("div", "upload-drop-zone");
        const pickerButton = createElement(
            "button",
            "primary-button upload-picker",
            "Dateien auswählen"
        );
        pickerButton.type = "button";
        pickerButton.dataset.initialFocus = "true";
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.multiple = true;
        fileInput.accept = "image/*,video/*,audio/*,application/*,text/*";
        fileInput.tabIndex = -1;
        fileInput.setAttribute("aria-label", "Dateien vom Gerät auswählen");
        fileInput.className = "visually-hidden-file-input";
        const selectedList = createElement("ul", "selected-files");
        const status = createElement("p", "upload-status");
        status.setAttribute("role", "status");
        const selections = [];

        pickerButton.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", () => {
            selectionPreviewUrls.forEach(URL.revokeObjectURL);
            selectionPreviewUrls = [];
            const selectedFiles = Array.from(fileInput.files ?? []);
            fileInput.value = "";
            selections.splice(
                0,
                selections.length,
                ...selectedFiles.map(createSelection)
            );
            renderSelectedFiles(selectedList, selections);
        });

        dropZone.addEventListener("dragover", event => {
            event.preventDefault();
            dropZone.classList.add("dragging");
        });
        dropZone.addEventListener("dragleave", event => {
            if (!dropZone.contains(event.relatedTarget)) {
                dropZone.classList.remove("dragging");
            }
        });
        dropZone.addEventListener("drop", event => {
            event.preventDefault();
            dropZone.classList.remove("dragging");
            if (!event.dataTransfer?.files.length) return;

            const newFiles = Array.from(event.dataTransfer.files);
            selections.push(...newFiles.map(createSelection));
            renderSelectedFiles(selectedList, selections);
        });
        function createSelection(file) {
            return createFileSelection(file, selection => {
                if (selections.includes(selection)) {
                    selectionPreviewUrls.push(selection.previewUrl);
                    renderSelectedFiles(selectedList, selections);
                } else {
                    URL.revokeObjectURL(selection.previewUrl);
                }
            });
        }

        dropZone.setAttribute("role", "region");
        dropZone.setAttribute("aria-label", "Dateien zum Hochladen auswählen oder hier ablegen");
        selectedList.setAttribute("aria-label", "Ausgewählte Dateien");
        const dropHint = createElement("span", "upload-drop-hint", "oder Dateien hier ablegen");
        dropZone.append(pickerButton, fileInput);
        dropZone.appendChild(dropHint);
        form.append(helper, dropZone, selectedList, subjectField, status);

        openModal({
            title: "Dateien hochladen",
            content: form,
            submitText: "Hochladen",
            onClose: () => {
                selectionPreviewUrls.forEach(URL.revokeObjectURL);
                selectionPreviewUrls = [];
                selections.length = 0;
            },
            onSubmit: async () => {
                const selectedSubject = subjectField.querySelector("select").value;
                const pending = selections.filter(
                    item => item.status === "Ausgewählt" || item.status === "Fehlgeschlagen"
                );
                if (pending.length === 0) {
                    error("Bitte wähle zuerst mindestens eine Datei aus.");
                    return;
                }

                for (let index = 0; index < pending.length; index += 1) {
                    const selection = pending[index];
                    selection.status = "Wird gespeichert …";
                    status.textContent = `Datei ${index + 1} von ${pending.length} wird gespeichert.`;
                    renderSelectedFiles(selectedList, selections);

                    try {
                        const id = crypto.randomUUID();
                        await storeFile(id, selection.file);
                        try {
                            addFile(
                                selection.file.name,
                                getFileTypeLabel(selection.file),
                                selectedSubject,
                                "",
                                {
                                    id,
                                    mimeType: selection.file.type || inferMimeType({ name: selection.file.name }),
                                    size: selection.file.size
                                }
                            );
                            selection.status = "Hochgeladen";
                        } catch (metadataError) {
                            await removeStoredFile(id);
                            throw metadataError;
                        }
                    } catch (uploadError) {
                        console.error("[Schulorganizer] Datei-Upload fehlgeschlagen:", uploadError);
                        selection.status = "Fehlgeschlagen";
                    }

                    renderSelectedFiles(selectedList, selections);
                }

                const failed = selections.filter(item => item.status === "Fehlgeschlagen").length;
                if (failed > 0) {
                    status.textContent = `${failed} Datei(en) konnten nicht gespeichert werden.`;
                    error("Mindestens eine Datei konnte nicht gespeichert werden.");
                    renderAll();
                    return;
                }

                status.textContent = "Alle Dateien wurden gespeichert.";
                closeModal();
                renderAll();
                success(`${pending.length} Datei(en) hochgeladen.`);
            }
        });
        return;
    }

    openModal({
        title: "Datei bearbeiten",

        content: form,

        onSubmit: () => {
            const name = form.querySelector('input[name="name"]').value.trim();

            if (!name) {
                error(
                    "Bitte einen Dateinamen eingeben."
                );

                return;
            }

            const subject =
                subjectField.querySelector(
                    "select"
                ).value;
            const type = form.querySelector('select[name="type"]').value;
            const url = form.querySelector('input[name="url"]').value.trim();
            if (url && !isSafeFileUrl(url)) {
                error("Datei-Links müssen mit http:// oder https:// beginnen.");
                return;
            }

            updateFile(existingFile.id, { name, type, subject, url });
            success("Datei aktualisiert.");

            closeModal();
            renderAll();
        }
    });
}

function openFileLinkModal() {
    const form = createForm();
    const nameField = createField({
        label: "Dateiname",
        placeholder: "z. B. Arbeitsblatt.pdf",
        name: "name",
        required: true,
        maxLength: 255
    });
    const typeField = createSelect({
        label: "Dateityp",
        name: "type",
        options: [
            { value: "", label: "Nicht angegeben" },
            { value: "PDF", label: "PDF" },
            { value: "Dokument", label: "Dokument" },
            { value: "Präsentation", label: "Präsentation" },
            { value: "Bild", label: "Bild" },
            { value: "Video", label: "Video" },
            { value: "Sonstiges", label: "Sonstiges" }
        ]
    });
    const subjectField = createSelect({
        label: "Fach",
        name: "subject",
        options: getSubjectOptions()
    });
    const urlField = createField({
        label: "Datei-Link",
        type: "url",
        placeholder: "https://…",
        name: "url",
        required: true
    });

    form.append(nameField, typeField, subjectField, urlField);
    openModal({
        title: "Datei-Link hinzufügen",
        content: form,
        submitText: "Link speichern",
        onSubmit: () => {
            const name = nameField.querySelector("input").value.trim();
            const url = urlField.querySelector("input").value.trim();
            if (!name || !url || !isSafeFileUrl(url)) {
                error("Bitte Dateiname und gültigen Datei-Link eingeben.");
                return;
            }

            addFile(
                name,
                typeField.querySelector("select").value,
                subjectField.querySelector("select").value,
                url
            );
            closeModal();
            renderAll();
            success("Datei-Link hinzugefügt.");
        }
    });
}

function renderSelectedFiles(list, selections) {
    list.replaceChildren();
    selections.forEach(({ file, status, previewUrl }) => {
        const row = createElement("li", "selected-file-row");
        const summary = createElement("div", "selected-file-summary");
        if (inferMimeType(file).startsWith("image/") && previewUrl) {
            const image = createElement("img", "selected-file-thumbnail");
            image.src = previewUrl;
            image.alt = `Vorschau: ${file.name}`;
            image.loading = "lazy";
            summary.appendChild(image);
        } else if (inferMimeType(file).startsWith("image/")) {
            summary.appendChild(createElement("span", "selected-file-icon", "Bild"));
        }
        const details = createElement("span", "", `${file.name} · ${formatFileSize(file.size)}`);
        const state = createElement("span", "selected-file-status", status);
        summary.appendChild(details);
        row.append(summary, state);
        list.appendChild(row);
    });
}

function createFileSelection(file, onPreviewReady = () => {}) {
    const selection = { file, status: "Ausgewählt", previewUrl: "" };
    if (inferMimeType(file).startsWith("image/")) {
        createThumbnail(file).then(thumbnail => {
            selection.previewUrl = URL.createObjectURL(thumbnail);
            onPreviewReady(selection);
        }).catch(() => {
            selection.previewFailed = true;
            onPreviewReady(selection);
        });
    }
    return selection;
}

function getFileTypeLabel(file) {
    const mime = file.type || inferMimeType({ name: file.name });
    if (mime === "application/pdf") return "PDF";
    if (mime.startsWith("image/")) return "Bild";
    if (mime.startsWith("video/")) return "Video";
    if (mime.startsWith("audio/")) return "Audio";
    if (mime.includes("presentation")) return "Präsentation";
    if (mime.includes("word") || mime.includes("document")) return "Dokument";
    if (mime.startsWith("text/")) return "Textdatei";
    return "Sonstiges";
}


/*
|--------------------------------------------------------------------------
| Subjects
|--------------------------------------------------------------------------
*/

function createSubjectElement(subject) {
    const card = createElement(
        "article",
        "subject-card"
    );

    const name = createElement(
        "h4",
        "",
        subject.name
    );

    const taskAmount =
        getTasks().filter(
            task =>
                task.subject === subject.name
        ).length;

    const presentationAmount =
        getPresentations().filter(
            presentation =>
                presentation.subject ===
                subject.name
        ).length;

    const noteAmount =
        getNotes().filter(
            note =>
                note.subject === subject.name
        ).length;
    const fileAmount = getFiles().filter(
        file => file.subject === subject.name
    ).length;

    const info = createElement(
        "p",
        "",
        `${taskAmount} Aufgaben · ${presentationAmount} Präsentationen · ${noteAmount} Notizen · ${fileAmount} Dateien`
    );

    const deleteButton =
        createActionButton(
            "Löschen",
            "danger-action"
        );

    deleteButton.addEventListener(
        "click",
        () => {
            if (!confirmDelete(
                `Möchtest du das Fach "${subject.name}" wirklich löschen?`
            )) {
                return;
            }

            runAction(() => {
                deleteSubject(subject.id);
                renderAll();
                success("Fach gelöscht.");
            });
        }
    );

    card.append(
        name,
        info,
        deleteButton
    );

    return card;
}


function renderSubjects() {
    const subjects = getSubjects();

    if (subjects.length === 0) {
        showEmptyState(
            subjectList,
            "Noch keine Fächer",
            "Lege Fächer an, um Aufgaben, Notizen und Dateien zuzuordnen.",
            "Fach hinzufügen",
            openSubjectModal
        );

        return;
    }

    subjectList.replaceChildren();

    subjects.forEach(subject => {
        subjectList.appendChild(
            createSubjectElement(
                subject
            )
        );
    });
}


function openSubjectModal() {
    const form = createForm();

    const nameField = createField({
        label: "Fachname",
        placeholder:
            "z. B. Mathematik",
        name: "name",
        required: true,
        maxLength: 60
    });

    form.appendChild(
        nameField
    );

    openModal({
        title: "Neues Fach",

        content: form,

        onSubmit: () => {
            const name =
                nameField.querySelector(
                    "input"
                ).value.trim();

            if (!name) {
                error(
                    "Bitte einen Fachnamen eingeben."
                );

                return;
            }

            const existing =
                getSubjects().find(
                    subject =>
                        subject.name
                            .toLowerCase() ===
                        name.toLowerCase()
                );

            if (existing) {
                error(
                    "Dieses Fach existiert bereits."
                );

                return;
            }

            addSubject(name);

            closeModal();

            renderAll();

            success(
                "Fach hinzugefügt."
            );
        }
    });
}


/*
|--------------------------------------------------------------------------
| Add button
|--------------------------------------------------------------------------
*/

function closeAddMenu() {
    addMenu.hidden = true;
    addButton.setAttribute("aria-expanded", "false");
}

addButton.addEventListener("click", () => {
    addMenu.hidden = !addMenu.hidden;
    addButton.setAttribute("aria-expanded", String(!addMenu.hidden));
    if (!addMenu.hidden) {
        addMenu.querySelector("[role='menuitem']")?.focus();
    }
});

addMenu.querySelectorAll("[data-add-type]").forEach(button => {
    button.addEventListener("click", () => {
        const actions = {
            tasks: openTaskModal,
            presentations: openPresentationModal,
            notes: openNoteModal,
            files: openFileModal,
            fileLink: openFileLinkModal,
            subjects: openSubjectModal
        };
        closeAddMenu();
        actions[button.dataset.addType]?.();
    });
});

document.addEventListener("click", event => {
    if (!addButton.contains(event.target) && !addMenu.contains(event.target)) {
        closeAddMenu();
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !addMenu.hidden) {
        closeAddMenu();
        addButton.focus();
        return;
    }

    if (
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        !addMenu.hidden
    ) {
        const items = [...addMenu.querySelectorAll("[role='menuitem']")];
        const currentIndex = items.indexOf(document.activeElement);
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (currentIndex + offset + items.length) % items.length;
        event.preventDefault();
        items[nextIndex]?.focus();
    }
});

dashboardCards.forEach(card => {
    card.addEventListener("click", () => {
        navigateTo(card.dataset.dashboardPage);
    });
});

window.addEventListener("beforeunload", () => {
    activePreviewUrls.forEach(URL.revokeObjectURL);
    filePreviewUrls.forEach(URL.revokeObjectURL);
    selectionPreviewUrls.forEach(URL.revokeObjectURL);
});


/*
|--------------------------------------------------------------------------
| Page changes
|--------------------------------------------------------------------------
*/

window.addEventListener(
    "pagechange",
    event => {
        const page =
            event.detail?.page;

        if (page === "dashboard") {
            renderDashboard();
        }

        if (page === "tasks") {
            renderTasks();
        }

        if (page === "presentations") {
            renderPresentations();
        }

        if (page === "notes") {
            renderNotes();
        }

        if (page === "files") {
            renderFiles();
        }

        if (page === "subjects") {
            renderSubjects();
        }
    }
);


/*
|--------------------------------------------------------------------------
| Re-render everything
|--------------------------------------------------------------------------
*/

function renderAll() {
    renderSubjectFilters();
    renderDashboard();
    renderTasks();
    renderPresentations();
    renderNotes();
    renderFiles();
    renderSubjects();
}


/*
|--------------------------------------------------------------------------
| Initial application state
|--------------------------------------------------------------------------
*/

renderAll();
const savedPage = window.location.hash.slice(1);
navigateTo(
    ["dashboard", "tasks", "presentations", "notes", "files", "subjects"].includes(savedPage)
        ? savedPage
        : "dashboard",
    { replaceHistory: true }
);

if (getStorageIssues().length > 0) {
    error("Einige Inhalte konnten nicht geladen oder gespeichert werden. Prüfe die Browser-Speichereinstellungen.");
}