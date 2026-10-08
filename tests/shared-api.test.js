import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import uploadTokenFunction, { config as uploadTokenConfig } from "../api/files/upload-token.js";
import catchAllFunction, { config as catchAllConfig } from "../api/[...path].js";
import { BLOB_ACCESS } from "../src/data/blobAccess.js";
import { deleteSharedFile, getUploadContentType } from "../src/data/sharedApi.js";
import { createApiHandler } from "../src/serverless/handler.js";

test("Vercel upload-token route is explicit and keeps request bodies unparsed", () => {
    assert.equal(typeof uploadTokenFunction, "function");
    assert.equal(uploadTokenConfig.api.bodyParser, false);
    assert.equal(typeof catchAllFunction, "function");
    assert.equal(catchAllConfig.api.bodyParser, false);
});

test("Vercel file-id route is explicit and DELETE uses /api/files/:id", async () => {
    const { default: fileFunction, config: fileConfig } = await import("../api/files/[id].js");
    assert.equal(typeof fileFunction, "function");
    assert.equal(fileConfig.api.bodyParser, false);

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

test("browser and legacy uploads target the configured private Blob store", () => {
    assert.equal(BLOB_ACCESS, "private");
});

let pg;
let handler;
const deletedBlobs = [];
const readBlobs = [];
let uploadOptions;
let blobDeletionFailure;

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
        handleBlobUpload: async options => {
            uploadOptions = options;
            return { clientToken: "test-client-token" };
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

test("Blob upload tokens constrain file types and size", async () => {
    const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    try {
        const response = await api("/files/upload-token", {
            method: "POST",
            body: { type: "blob.generate-client-token", payload: "{}" }
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await json(response), { clientToken: "test-client-token" });
        assert.equal(uploadOptions.token, "test-token");
        assert.equal(uploadOptions.request.url, "https://school.test/api/files/upload-token");
        const constraints = await uploadOptions.onBeforeGenerateToken("upload.pptx");
        assert.equal(constraints.maximumSizeInBytes, 100 * 1024 * 1024);
        assert.ok(constraints.allowedContentTypes.includes("image/*"));
        assert.ok(constraints.allowedContentTypes.includes("text/*"));
        assert.ok(constraints.allowedContentTypes.includes("application/*"));

        const strippedPrefixResponse = await handler(new Request(
            "https://school.test/files/upload-token",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "blob.generate-client-token", payload: "{}" })
            }
        ));
        assert.equal(strippedPrefixResponse.status, 200);
        assert.deepEqual(await json(strippedPrefixResponse), { clientToken: "test-client-token" });
    } finally {
        if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
        else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
    }
});

test("uploaded file metadata, project attachments, edits, and deletion persist", async () => {
    const blobUrl = "https://school.private.blob.vercel-storage.com/math.pdf";
    const fileResponse = await api("/files", {
        method: "POST",
        body: {
            id: "math-file",
            name: "Mathe.pdf",
            type: "PDF",
            subject: "Mathematik",
            mimeType: "application/pdf",
            size: 1024,
            url: blobUrl,
            createdAt: 100
        }
    });
    assert.equal(fileResponse.status, 201);
    assert.deepEqual(await json(fileResponse), {
        id: "math-file",
        name: "Mathe.pdf",
        type: "PDF",
        subject: "Mathematik",
        url: blobUrl,
        mimeType: "application/pdf",
        size: 1024,
        createdAt: 100,
        hasContent: true
    });

    const invalidFile = await api("/files", {
        method: "POST",
        body: {
            id: "invalid",
            name: "bad.pdf",
            size: 1,
            url: "https://example.com/file.pdf"
        }
    });
    assert.equal(invalidFile.status, 400);

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

    const contentResponse = await api("/files/math-file/content");
    assert.equal(contentResponse.status, 200);
    assert.equal(contentResponse.headers.get("content-type"), "application/pdf");
    assert.equal(contentResponse.headers.get("content-disposition"), "inline; filename*=UTF-8''Mathe.pdf");
    assert.equal(await contentResponse.text(), "private file bytes");
    assert.equal(readBlobs[0], blobUrl);

    const downloadResponse = await api("/files/math-file/content?download=1");
    assert.equal(downloadResponse.headers.get("content-disposition"), "attachment; filename*=UTF-8''Mathe.pdf");

    const update = await api("/files/math-file", {
        method: "PUT",
        body: { subject: "Physik" }
    });
    assert.equal(update.status, 200);
    const updatedFile = await json(update);
    assert.equal(updatedFile.subject, "Physik");
    assert.equal(updatedFile.url, blobUrl);
    assert.equal(updatedFile.hasContent, true);

    const state = await json(await api("/state"));
    assert.equal(state.presentations[0].title, "Bruchrechnung");
    assert.equal(state.files[0].subject, "Physik");

    blobDeletionFailure = new Error("Blob storage unavailable");
    const failedDeletion = await api("/files/math-file", { method: "DELETE" });
    blobDeletionFailure = null;
    assert.equal(failedDeletion.status, 502);
    assert.match((await json(failedDeletion)).error, /Dateieintrag bleibt erhalten/);
    assert.deepEqual(deletedBlobs, []);
    const stateAfterFailedDeletion = await json(await api("/state"));
    assert.equal(stateAfterFailedDeletion.files[0].id, "math-file");
    assert.deepEqual(stateAfterFailedDeletion.presentations[0].fileIds, ["math-file"]);

    const deletion = await api("/files/math-file", { method: "DELETE" });
    assert.equal(deletion.status, 204);
    assert.deepEqual(deletedBlobs, [blobUrl]);
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
});
