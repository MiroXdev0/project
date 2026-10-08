import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterEach, test } from "node:test";
import { createApiApp, createDatabase } from "../server.js";

const servers = [];
const databases = [];
const temporaryDirectories = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
    databases.splice(0).forEach(database => database.close());
    temporaryDirectories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }));
});

async function startApi() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "schulorganizer-api-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "data", "school.sqlite");
    const database = createDatabase(databasePath);
    databases.push(database);
    const server = createApiApp(database).listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    return {
        databasePath,
        database,
        baseUrl: `http://127.0.0.1:${server.address().port}`
    };
}

async function json(response) {
    return response.status === 204 ? null : response.json();
}

test("projects and original file bytes persist in SQLite and are shared by the API", async () => {
    const api = await startApi();
    const original = Buffer.from("original power point bytes \u0000");
    const form = new FormData();
    form.set("file", new Blob([original], {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    }), "Referat.pptx");
    form.set("type", "Präsentation");
    form.set("subject", "Physik");

    const uploadResponse = await fetch(`${api.baseUrl}/api/files`, { method: "POST", body: form });
    assert.equal(uploadResponse.status, 201);
    const file = await uploadResponse.json();
    assert.equal(file.name, "Referat.pptx");
    assert.equal(file.size, original.length);
    assert.equal(file.subject, "Physik");

    const projectResponse = await fetch(`${api.baseUrl}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            title: "Klimawandel",
            subject: "Physik",
            description: "Schülerprojekt mit Originalpräsentation.",
            fileIds: [file.id]
        })
    });
    assert.equal(projectResponse.status, 201);
    const project = await projectResponse.json();

    const state = await fetch(`${api.baseUrl}/api/state`, { cache: "no-store" }).then(json);
    assert.deepEqual(state.presentations[0].fileIds, [file.id]);
    assert.equal(state.presentations[0].title, "Klimawandel");
    assert.deepEqual(state.files[0], { ...file, hasContent: true });
    assert.equal(JSON.stringify(state).includes(original.toString()), false);

    const contentResponse = await fetch(`${api.baseUrl}/api/files/${file.id}/content`);
    assert.equal(contentResponse.headers.get("content-type"), file.mimeType);
    assert.deepEqual(Buffer.from(await contentResponse.arrayBuffer()), original);

    const downloadResponse = await fetch(`${api.baseUrl}/api/files/${file.id}/content?download=1`);
    assert.match(downloadResponse.headers.get("content-disposition"), /^attachment;/);
    assert.deepEqual(Buffer.from(await downloadResponse.arrayBuffer()), original);

    await new Promise(resolve => {
        const server = servers[0];
        server.close(resolve);
        servers.length = 0;
    });
    api.database.close();
    databases.splice(databases.indexOf(api.database), 1);

    const reopenedDatabase = createDatabase(api.databasePath);
    databases.push(reopenedDatabase);
    const reopenedServer = createApiApp(reopenedDatabase).listen(0, "127.0.0.1");
    servers.push(reopenedServer);
    await once(reopenedServer, "listening");
    const reopenedUrl = `http://127.0.0.1:${reopenedServer.address().port}`;
    const reopenedState = await fetch(`${reopenedUrl}/api/state`).then(json);
    assert.equal(reopenedState.presentations[0].id, project.id);
    assert.deepEqual(reopenedState.presentations[0].fileIds, [file.id]);
    assert.deepEqual(
        Buffer.from(await (await fetch(`${reopenedUrl}/api/files/${file.id}/content`)).arrayBuffer()),
        original
    );
});

test("server changes notify connected clients and deleting projects preserves their files", async () => {
    const { baseUrl } = await startApi();
    const events = await fetch(`${baseUrl}/api/events`);
    assert.equal(events.status, 200);
    const reader = events.body.getReader();

    const createResponse = await fetch(`${baseUrl}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Gemeinsames Projekt", fileIds: [] })
    });
    assert.equal(createResponse.status, 201);
    const project = await createResponse.json();

    let eventText = "";
    while (!eventText.includes("event: update")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        eventText += new TextDecoder().decode(chunk.value);
    }
    assert.match(eventText, /event: update/);

    const updateResponse = await fetch(`${baseUrl}/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            title: "Projekt synchronisiert",
            description: "Von einem anderen Browser aktualisiert.",
            fileIds: []
        })
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).title, "Projekt synchronisiert");

    await reader.cancel();
    assert.equal((await fetch(`${baseUrl}/api/projects/not-a-project`, { method: "DELETE" })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/projects/${project.id}`, { method: "DELETE" })).status, 204);
    const state = await fetch(`${baseUrl}/api/state`).then(json);
    assert.deepEqual(state.presentations, []);
});

test("invalid project references and missing uploads return clear client errors", async () => {
    const { baseUrl } = await startApi();
    const missingFile = await fetch(`${baseUrl}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Ungültiger Verweis", fileIds: ["missing-file"] })
    });
    assert.equal(missingFile.status, 400);
    assert.match((await missingFile.json()).error, /Datei wurde nicht gefunden/);

    const missingUpload = await fetch(`${baseUrl}/api/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "fehlt.pptx" })
    });
    assert.equal(missingUpload.status, 400);
    assert.match((await missingUpload.json()).error, /keine Datei übertragen/);
});

test("legacy files and projects migrate with their original IDs and without duplicates", async () => {
    const { baseUrl } = await startApi();
    const original = Buffer.from("legacy presentation bytes");
    const fileForm = new FormData();
    fileForm.set("id", "legacy-file-id");
    fileForm.set("name", "Altes Referat.pptx");
    fileForm.set("type", "Präsentation");
    fileForm.set("subject", "Deutsch");
    fileForm.set("mimeType", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    fileForm.set("createdAt", "1700000000000");

    const metadataImport = await fetch(`${baseUrl}/api/migration/files`, {
        method: "POST",
        body: fileForm
    });
    assert.equal(metadataImport.status, 201);
    assert.equal((await metadataImport.json()).migrated, true);

    const repairForm = new FormData();
    repairForm.set("id", "legacy-file-id");
    repairForm.set("name", "Altes Referat.pptx");
    repairForm.set("mimeType", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    repairForm.set("file", new Blob([original]), "Altes Referat.pptx");
    const repairedFile = await fetch(`${baseUrl}/api/migration/files`, {
        method: "POST",
        body: repairForm
    });
    assert.equal(repairedFile.status, 200);
    assert.equal((await repairedFile.json()).repaired, true);

    const duplicateForm = new FormData();
    duplicateForm.set("id", "legacy-file-id");
    duplicateForm.set("name", "Altes Referat.pptx");
    const duplicateImport = await fetch(`${baseUrl}/api/migration/files`, {
        method: "POST",
        body: duplicateForm
    });
    assert.equal(duplicateImport.status, 200);
    assert.equal((await duplicateImport.json()).repaired, false);

    const projectPayload = {
        id: "legacy-project-id",
        title: "Altes Deutschreferat",
        subject: "Deutsch",
        description: "Vor dem Server-Update erstellt.",
        createdAt: 1700000000000,
        fileIds: ["legacy-file-id"]
    };
    const projectWithoutAttachment = await fetch(`${baseUrl}/api/migration/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...projectPayload, fileIds: [] })
    });
    assert.equal(projectWithoutAttachment.status, 201);
    assert.equal((await projectWithoutAttachment.json()).migrated, true);

    const repairedProject = await fetch(`${baseUrl}/api/migration/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectPayload)
    });
    assert.equal(repairedProject.status, 200);
    assert.equal((await repairedProject.json()).repaired, true);

    const duplicateProjectImport = await fetch(`${baseUrl}/api/migration/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectPayload)
    });
    assert.equal(duplicateProjectImport.status, 200);
    assert.equal((await duplicateProjectImport.json()).repaired, false);

    const state = await fetch(`${baseUrl}/api/state`).then(json);
    assert.equal(state.files.length, 1);
    assert.equal(state.files[0].hasContent, true);
    assert.equal(state.presentations.length, 1);
    assert.deepEqual(state.presentations[0].fileIds, ["legacy-file-id"]);
    assert.deepEqual(
        Buffer.from(await (await fetch(`${baseUrl}/api/files/legacy-file-id/content`)).arrayBuffer()),
        original
    );
});
