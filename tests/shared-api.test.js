import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import catchAllFunction, { config as catchAllConfig } from "../api/[...path].js";
import {
    deleteSharedFile,
    getUploadContentType,
    refreshSharedData,
    startSharedSync
} from "../src/data/sharedApi.js";
import { createApiHandler } from "../src/serverless/handler.js";

test("Vercel catch-all API route keeps request bodies unparsed", () => {
    assert.equal(typeof catchAllFunction, "function");
    assert.equal(catchAllConfig.api.bodyParser, false);
});

test("Vercel file-id route is explicit and DELETE uses /api/files/:id", async () => {
    const { default: fileFunction, config: fileConfig } = await import("../api/files/[id].js");
    assert.equal(typeof fileFunction, "function");
    assert.equal(fileConfig.api.bodyParser, false);
});

test("Vercel file-content route is explicit and keeps request bodies unparsed", async () => {
    const { default: contentFunction, config: contentConfig } = await import("../api/files/[id]/content.js");
    assert.equal(typeof contentFunction, "function");
    assert.equal(contentConfig.api.bodyParser, false);
});

test("DELETE uses /api/files/:id", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl;
    let requestedMethod;
    globalThis.fetch = async (url, options) => {
        requestedUrl = url;
        requestedMethod = options.method;
        return new Response(null, { status: 204 });
    };
    try {
        await deleteSharedFile("math-file");
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.equal(requestedUrl, "/api/files/math-file");
    assert.equal(requestedMethod, "DELETE");
});

test("PNG uploads retain an image MIME type when the browser omits it", () => {
    assert.equal(getUploadContentType({ name: "photo.png", type: "" }), "image/png");
    assert.equal(getUploadContentType({ name: "photo.PNG", type: "application/octet-stream" }), "image/png");
    assert.equal(getUploadContentType({ name: "photo.png", type: "image/png" }), "image/png");
    assert.equal(getUploadContentType({ name: "archive.exe", type: "" }), "application/octet-stream");
});

test("shared sync only rerenders when shared records change", async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    let apiState = {
        presentations: [{ id: "project-1", fileIds: ["file-b", "file-a"] }],
        files: [{ id: "file-a", name: "bild.png" }]
    };
    let intervalCallback;
    let updates = 0;
    globalThis.fetch = async () => new Response(JSON.stringify(apiState), {
        headers: { "Content-Type": "application/json" }
    });
    globalThis.document = {
        visibilityState: "visible",
        addEventListener() {},
        removeEventListener() {}
    };
    globalThis.window = {
        setInterval(callback) {
            intervalCallback = callback;
            return 1;
        },
        clearInterval() {},
        addEventListener() {},
        removeEventListener() {}
    };

    try {
        await refreshSharedData();
        const stop = startSharedSync(() => {
            updates += 1;
        }, () => {});

        try {
            await intervalCallback();
            assert.equal(updates, 0);

            apiState = {
                presentations: [{ id: "project-1", fileIds: ["file-a", "file-b"] }],
                files: [
                    { id: "file-a", name: "bild.png" },
                    { id: "file-b", name: "neu.pdf" }
                ]
            };
            await intervalCallback();
            assert.equal(updates, 1);
        } finally {
            stop();
        }
    } finally {
        globalThis.fetch = originalFetch;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

let pg;
let handler;
const deletedBlobs = [];
const readBlobs = [];
const deletedObjects = [];
const readObjects = [];
const storedObjects = new Map();
let signedUpload;
let blobDeletionFailure;
let storageDeletionFailure;

before(async () => {
    pg = new PGlite();
    const database = {
        query: (text, values = []) => pg.query(text, values),
        transaction: async operation => {
            await pg.query("BEGIN");
            try {
                const result = await operation({
                    query: (text, values = []) => pg.query(text, values)
                });
                await pg.query("COMMIT");
                return result;
            } catch (error) {
                await pg.query("ROLLBACK");
                throw error;
            }
        }
    };
    handler = createApiHandler({
        database,
        deleteBlob: async url => {
            if (blobDeletionFailure) throw blobDeletionFailure;
            deletedBlobs.push(url);
        },
        getBlob: async url => {
            readBlobs.push(url);
            return {
                statusCode: 200,
                stream: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode("private file bytes"));
                        controller.close();
                    }
                }),
                blob: { contentType: "application/pdf" }
            };
        },
        createUploadUrl: async (key, contentType) => {
            signedUpload = { key, contentType };
            return `https://storage.test/${key}`;
        },
        headObject: async key => storedObjects.get(key) ?? null,
        getObject: async key => {
            readObjects.push(key);
            return {
                Body: {
                    transformToWebStream: () => new ReadableStream({
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode("private file bytes"));
                            controller.close();
                        }
                    })
                },
                ContentType: "application/pdf"
            };
        },
        deleteObject: async key => {
            if (storageDeletionFailure) throw storageDeletionFailure;
            deletedObjects.push(key);
            storedObjects.delete(key);
        }
    });
});

after(async () => {
    await pg.close();
});

async function api(path, { method = "GET", body } = {}) {
    const request = new Request(`https://school.test/api${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return handler(request);
}

async function json(response) {
    return response.json();
}

test("health and state use the shared PostgreSQL schema", async () => {
    const health = await api("/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await json(health), { status: "ok" });

    const strippedPrefixHealth = await handler(new Request("https://school.test/health"));
    assert.equal(strippedPrefixHealth.status, 200);
    assert.deepEqual(await json(strippedPrefixHealth), { status: "ok" });

    const state = await api("/state");
    assert.equal(state.status, 200);
    assert.deepEqual(await json(state), { presentations: [], files: [] });
    assert.equal(state.headers.get("cache-control"), "no-store");
});

test("Neon presigned uploads validate size and confirm object existence before storing metadata", async () => {
    const urlResponse = await api("/files/upload-url", {
        method: "POST",
        body: {
            id: "math-file",
            name: "Mathe.pdf",
            mimeType: "application/pdf",
            size: 1024
        }
    });
    assert.equal(urlResponse.status, 200);
    const uploadTarget = await json(urlResponse);
    assert.deepEqual(signedUpload, {
        key: uploadTarget.key,
        contentType: "application/pdf"
    });
    assert.equal(uploadTarget.url, `https://storage.test/${uploadTarget.key}`);
    assert.deepEqual(uploadTarget.headers, { "Content-Type": "application/pdf" });

    const tooLarge = await api("/files/upload-url", {
        method: "POST",
        body: { id: "too-large", name: "bad.bin", size: 101 * 1024 * 1024 }
    });
    assert.equal(tooLarge.status, 400);
    const missingObject = await api("/files", {
        method: "POST",
        body: { id: "math-file", name: "Mathe.pdf", storageKey: uploadTarget.key, size: 1024 }
    });
    assert.equal(missingObject.status, 400);
    storedObjects.set(uploadTarget.key, { ContentLength: 1024 });
});

test("uploaded file metadata, project attachments, edits, and deletion persist", async () => {
    const storageKey = signedUpload.key;
    const fileResponse = await api("/files", {
        method: "POST",
        body: {
            id: "math-file",
            name: "Mathe.pdf",
            type: "PDF",
            subject: "Mathematik",
            mimeType: "application/pdf",
            size: 1024,
            storageKey,
            createdAt: 100
        }
    });
    assert.equal(fileResponse.status, 201);
    assert.deepEqual(await json(fileResponse), {
        id: "math-file",
        name: "Mathe.pdf",
        type: "PDF",
        subject: "Mathematik",
        url: storageKey,
        mimeType: "application/pdf",
        size: 1024,
        createdAt: 100,
        hasContent: true
    });

    const projectResponse = await api("/projects", {
        method: "POST",
        body: {
            title: "Bruchrechnung",
            subject: "Mathematik",
            description: "Präsentation",
            fileIds: ["math-file"]
        }
    });
    assert.equal(projectResponse.status, 201);
    const project = await json(projectResponse);
    assert.deepEqual(project.fileIds, ["math-file"]);

    const projectUpdate = await api(`/projects/${project.id}`, {
        method: "PUT",
        body: {
            title: project.title,
            subject: project.subject,
            description: "Aktualisierte Präsentation",
            fileIds: ["math-file"]
        }
    });
    assert.equal(projectUpdate.status, 200);
    assert.equal((await json(projectUpdate)).description, "Aktualisierte Präsentation");

    const contentResponse = await api("/files/math-file/content");
    assert.equal(contentResponse.status, 200);
    assert.equal(contentResponse.headers.get("content-type"), "application/pdf");
    assert.equal(contentResponse.headers.get("content-disposition"), "inline; filename*=UTF-8''Mathe.pdf");
    assert.equal(await contentResponse.text(), "private file bytes");
    assert.equal(readObjects[0], storageKey);

    const downloadResponse = await api("/files/math-file/content?download=1");
    assert.equal(downloadResponse.headers.get("content-disposition"), "attachment; filename*=UTF-8''Mathe.pdf");

    const update = await api("/files/math-file", {
        method: "PUT",
        body: { subject: "Physik" }
    });
    assert.equal(update.status, 200);
    const updatedFile = await json(update);
    assert.equal(updatedFile.subject, "Physik");
    assert.equal(updatedFile.url, storageKey);
    assert.equal(updatedFile.hasContent, true);

    const state = await json(await api("/state"));
    assert.equal(state.presentations[0].title, "Bruchrechnung");
    assert.equal(state.files[0].subject, "Physik");

    const duplicateUploadUrl = await api("/files/upload-url", {
        method: "POST",
        body: { id: "math-file", name: "overwrite.pdf", mimeType: "application/pdf", size: 1 }
    });
    assert.equal(duplicateUploadUrl.status, 409);

    storageDeletionFailure = new Error("Neon Object Storage unavailable");
    const failedDelete = await api("/files/math-file", { method: "DELETE" });
    storageDeletionFailure = null;
    assert.equal(failedDelete.status, 502);
    assert.match((await json(failedDelete)).error, /Neon Object Storage/);
    assert.equal((await json(await api("/state"))).files[0].id, "math-file");
    assert.deepEqual(deletedObjects, []);

    const deletion = await api("/files/math-file", { method: "DELETE" });
    assert.equal(deletion.status, 204);
    assert.deepEqual(deletedObjects, [storageKey]);
    const stateAfterDeletion = await json(await api("/state"));
    assert.deepEqual(stateAfterDeletion.files, []);
    assert.deepEqual(stateAfterDeletion.presentations[0].fileIds, []);

    const deletedProject = await api(`/projects/${project.id}`, { method: "DELETE" });
    assert.equal(deletedProject.status, 204);
});

test("external file links accept HTTP(S) only", async () => {
    const invalid = await api("/file-links", {
        method: "POST",
        body: { name: "Gefährlich", url: "javascript:alert(1)" }
    });
    assert.equal(invalid.status, 400);

    const valid = await api("/file-links", {
        method: "POST",
        body: { name: "Schulbuch", type: "Link", url: "https://example.org/book" }
    });
    assert.equal(valid.status, 201);
    const file = await json(valid);
    assert.equal(file.url, "https://example.org/book");
    assert.equal(file.hasContent, false);
});

test("legacy file and presentation migration is repeatable and repairs attachments", async () => {
    const blobUrl = "https://school.private.blob.vercel-storage.com/legacy.pdf";
    const imported = await api("/migration/files", {
        method: "POST",
        body: {
            id: "legacy-file",
            name: "Alt.pdf",
            type: "PDF",
            subject: "Deutsch",
            blobUrl,
            mimeType: "application/pdf",
            size: 500,
            createdAt: 50
        }
    });
    assert.equal(imported.status, 201);
    assert.equal((await json(imported)).migrated, true);

    const duplicate = await api("/migration/files", {
        method: "POST",
        body: {
            id: "legacy-file",
            name: "Alt.pdf",
            blobUrl,
            mimeType: "application/pdf",
            size: 500
        }
    });
    assert.equal((await json(duplicate)).migrated, false);

    const project = {
        id: "legacy-project",
        title: "Referat",
        subject: "Deutsch",
        fileIds: ["legacy-file"]
    };
    const firstProject = await api("/migration/projects", { method: "POST", body: project });
    assert.equal(firstProject.status, 201);
    assert.equal((await json(firstProject)).migrated, true);

    const repaired = await api("/migration/projects", {
        method: "POST",
        body: { ...project, fileIds: ["legacy-file", "later-file"] }
    });
    assert.equal(repaired.status, 400);

    const laterFile = await api("/files", {
        method: "POST",
        body: {
            id: "later-file",
            name: "Bild.png",
            size: 2,
            url: "https://school.private.blob.vercel-storage.com/bild.png"
        }
    });
    assert.equal(laterFile.status, 201);
    const repairedProject = await api("/migration/projects", {
        method: "POST",
        body: { ...project, fileIds: ["legacy-file", "later-file"] }
    });
    assert.equal((await json(repairedProject)).repaired, true);
    assert.deepEqual((await json(await api("/state"))).presentations
        .find(item => item.id === project.id).fileIds, ["legacy-file", "later-file"]);

    const legacyContent = await api("/files/legacy-file/content");
    assert.equal(legacyContent.status, 200);
    assert.equal(await legacyContent.text(), "private file bytes");
    assert.equal(readBlobs.at(-1), blobUrl);

    blobDeletionFailure = new Error("Legacy Blob is unavailable");
    const failedDelete = await api("/files/legacy-file", { method: "DELETE" });
    blobDeletionFailure = null;
    assert.equal(failedDelete.status, 502);
    assert.equal((await json(await api("/state"))).files.some(file => file.id === "legacy-file"), true);

    const deleteLegacy = await api("/files/legacy-file", { method: "DELETE" });
    assert.equal(deleteLegacy.status, 204);
    assert.deepEqual(deletedBlobs, [blobUrl]);
});
