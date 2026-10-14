import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "@neondatabase/serverless";
import { get } from "@vercel/blob";
import { BLOB_ACCESS } from "../src/data/blobAccess.js";
import { storageKeyForFile } from "../src/serverless/handler.js";
import { createNeonStorageClient, storageBucket } from "../src/serverless/neonStorage.js";

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("POSTGRES_URL oder DATABASE_URL muss gesetzt sein.");
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN muss für den einmaligen Dateiimport gesetzt sein.");
}

const database = new Pool({ connectionString, max: 1 });
const storage = createNeonStorageClient();
let migrated = 0;

try {
    const { rows } = await database.query(`
        SELECT id, blob_url, mime_type, size
        FROM files
        WHERE blob_url IS NOT NULL AND storage_key IS NULL
        ORDER BY created_at
    `);
    for (const row of rows) {
        const legacyFile = await get(row.blob_url, { access: BLOB_ACCESS });
        if (!legacyFile || legacyFile.statusCode !== 200 || !legacyFile.stream) {
            throw new Error(`Die bisherige Datei mit ID ${row.id} konnte nicht aus Vercel Blob gelesen werden.`);
        }
        const body = Buffer.from(await new Response(legacyFile.stream).arrayBuffer());
        if (body.length !== Number(row.size)) {
            throw new Error(`Die Dateigröße der Datei mit ID ${row.id} stimmt nicht mit den Metadaten überein.`);
        }

        const storageKey = storageKeyForFile(row.id);
        await storage.send(new PutObjectCommand({
            Bucket: storageBucket,
            Key: storageKey,
            Body: body,
            ContentType: row.mime_type || "application/octet-stream"
        }));
        const stored = await storage.send(new HeadObjectCommand({
            Bucket: storageBucket,
            Key: storageKey
        }));
        if (Number(stored.ContentLength) !== body.length) {
            throw new Error(`Die Datei mit ID ${row.id} konnte nach dem Kopieren nicht verifiziert werden.`);
        }
        await database.query(
            `UPDATE files SET storage_key = $1, blob_url = NULL
             WHERE id = $2 AND blob_url = $3 AND storage_key IS NULL`,
            [storageKey, row.id, row.blob_url]
        );
        migrated += 1;
        console.log(`Datei ${row.id} nach Neon Object Storage kopiert.`);
    }
    console.log(`${migrated} bisherige Datei(en) kopiert und verifiziert.`);
    console.log("Die Originale in Vercel Blob wurden nicht gelöscht.");
} finally {
    await database.end();
}
