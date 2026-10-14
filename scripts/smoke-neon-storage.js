import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Pool } from "@neondatabase/serverless";
import { createApiHandler } from "../src/serverless/handler.js";
import { createNeonStorageClient, storageBucket } from "../src/serverless/neonStorage.js";

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("POSTGRES_URL oder DATABASE_URL muss gesetzt sein.");

const databasePool = new Pool({ connectionString, max: 1 });
const storage = createNeonStorageClient();
const id = randomUUID();
const name = "neon-storage-smoke.bin";
const mimeType = "application/octet-stream";
const contents = Buffer.from("Neon Object Storage upload/read/delete smoke test.");
let storageKey;
let objectUploaded = false;

const database = {
    query: (text, values = []) => databasePool.query(text, values),
    transaction: async operation => {
        const client = await databasePool.connect();
        try {
            await client.query("BEGIN");
            const result = await operation({
                query: (text, values = []) => client.query(text, values)
            });
            await client.query("COMMIT");
            return result;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }
};
const api = createApiHandler({
    database,
    createUploadUrl: (key, contentType) => getSignedUrl(
        storage,
        new PutObjectCommand({
            Bucket: storageBucket,
            Key: key,
            ContentType: contentType
        }),
        { expiresIn: 900 }
    ),
    headObject: key => storage.send(new HeadObjectCommand({ Bucket: storageBucket, Key: key })),
    getObject: key => storage.send(new GetObjectCommand({ Bucket: storageBucket, Key: key })),
    deleteObject: key => storage.send(new DeleteObjectCommand({ Bucket: storageBucket, Key: key }))
});

async function request(path, method = "GET", body) {
    return api(new Request(`https://smoke.test/api${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
    }));
}

try {
    const targetResponse = await request("/files/upload-url", "POST", {
        id,
        name,
        mimeType,
        size: contents.length
    });
    assert.equal(targetResponse.status, 200);
    const target = await targetResponse.json();
    assert.match(target.key, /^files\/[a-f0-9]{64}\/[0-9a-f-]{36}\/content$/i);
    storageKey = target.key;

    const uploadResponse = await fetch(target.url, {
        method: "PUT",
        headers: target.headers,
        body: contents
    });
    assert.ok(uploadResponse.ok, `signed PUT returned HTTP ${uploadResponse.status}`);
    objectUploaded = true;
    console.log(`Signed upload: HTTP ${uploadResponse.status}`);

    const metadataResponse = await request("/files", "POST", {
        id,
        name,
        mimeType,
        size: contents.length,
        storageKey
    });
    assert.equal(metadataResponse.status, 201);
    console.log(`Postgres metadata insert: HTTP ${metadataResponse.status}`);

    const contentResponse = await request(`/files/${id}/content`);
    assert.equal(contentResponse.status, 200);
    assert.deepEqual(Buffer.from(await contentResponse.arrayBuffer()), contents);
    console.log(`API download/content verification: HTTP ${contentResponse.status}`);

    const deleteResponse = await request(`/files/${id}`, "DELETE");
    assert.equal(deleteResponse.status, 204);
    await assert.rejects(
        storage.send(new HeadObjectCommand({ Bucket: storageBucket, Key: storageKey })),
        error => error?.$metadata?.httpStatusCode === 404 ||
            error?.name === "NotFound" ||
            error?.name === "NoSuchKey"
    );
    const remainingMetadata = await databasePool.query("SELECT id FROM files WHERE id = $1", [id]);
    assert.equal(remainingMetadata.rows.length, 0);
    objectUploaded = false;
    console.log(`API delete (Neon object and Postgres metadata): HTTP ${deleteResponse.status}`);
} finally {
    if (objectUploaded) {
        await storage.send(new DeleteObjectCommand({ Bucket: storageBucket, Key: storageKey }));
        await databasePool.query("DELETE FROM files WHERE id = $1", [id]);
    }
    await databasePool.end();
}
