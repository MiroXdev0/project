import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createApiHandler } from "../src/serverless/handler.js";

let pg;
let handler;
const deletedBlobs = [];
let uploadOptions;

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
        deleteBlob: async url => deletedBlobs.push(url),
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
        assert.ok(constraints.allowedContentTypes.includes("application/*"));
    } finally {
        if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
        else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
    }
});

test("uploaded file metadata, project attachments, edits, and deletion persist", async () => {
    const blobUrl = "https://school.public.blob.vercel-storage.com/math.pdf";
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
    assert.equal(contentResponse.status, 302);
    assert.equal(contentResponse.headers.get("location"), blobUrl);

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

    const deletion = await api("/files/math-file", { method: "DELETE" });
    assert.equal(deletion.status, 204);
    assert.deepEqual(deletedBlobs, [blobUrl]);
    assert.deepEqual((await json(await api("/state"))).files, []);

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
    const blobUrl = "https://school.public.blob.vercel-storage.com/legacy.pdf";
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
            url: "https://school.public.blob.vercel-storage.com/bild.png"
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
