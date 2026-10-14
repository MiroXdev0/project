import { DatabaseSync } from "node:sqlite";
import { Pool } from "@neondatabase/serverless";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { postgresSchema, storageKeyForFile } from "../src/serverless/handler.js";

const [sqlitePath] = process.argv.slice(2);
const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
const storageBucket = "schulorganizer-files";

if (!sqlitePath) {
    throw new Error("Aufruf: npm run migrate:sqlite -- <Pfad-zur-schulorganizer.sqlite>");
}
if (!connectionString) {
    throw new Error("POSTGRES_URL oder DATABASE_URL muss gesetzt sein.");
}
const source = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new Pool({ connectionString, max: 1 });
const storage = new S3Client({ forcePathStyle: true });
const now = Date.now();
let migratedFiles = 0;
let migratedProjects = 0;

try {
    for (const statement of postgresSchema.split(";").map(value => value.trim()).filter(Boolean)) {
        await pool.query(statement);
    }

    const files = source.prepare(`
        SELECT id, name, type, subject, url, mime_type, size, created_at, content
        FROM files ORDER BY created_at
    `).all();

    for (const file of files) {
        const current = await pool.query(
            "SELECT storage_key, blob_url FROM files WHERE id = $1",
            [file.id]
        );
        let storageKey = current.rows[0]?.storage_key ?? null;
        let blobUrl = current.rows[0]?.blob_url ?? null;
        const content = file.content == null ? null : Buffer.from(file.content);

        if (!storageKey && !blobUrl && content !== null) {
            storageKey = storageKeyForFile(file.id);
            await storage.send(new PutObjectCommand({
                Bucket: storageBucket,
                Key: storageKey,
                Body: content,
                ContentType: file.mime_type || "application/octet-stream"
            }));
        }

        await pool.query(`
            INSERT INTO files
                (id, name, type, subject, external_url, blob_url, storage_key, mime_type, size, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                type = EXCLUDED.type,
                subject = EXCLUDED.subject,
                external_url = CASE WHEN EXCLUDED.blob_url IS NOT NULL OR EXCLUDED.storage_key IS NOT NULL
                    THEN '' ELSE EXCLUDED.external_url END,
                blob_url = COALESCE(files.blob_url, EXCLUDED.blob_url),
                storage_key = COALESCE(files.storage_key, EXCLUDED.storage_key),
                mime_type = EXCLUDED.mime_type,
                size = EXCLUDED.size
        `, [
            file.id,
            file.name,
            file.type,
            file.subject,
            (blobUrl || storageKey) ? "" : file.url,
            blobUrl,
            storageKey,
            file.mime_type || "application/octet-stream",
            Number(file.size) || content?.length || 0,
            Number(file.created_at) || now
        ]);
        migratedFiles += 1;
    }

    const projects = source.prepare(`
        SELECT id, title, subject, date, description, created_at, updated_at
        FROM projects ORDER BY created_at
    `).all();
    const projectFiles = source.prepare(`
        SELECT project_id, file_id FROM project_files ORDER BY rowid
    `).all();
    const filesByProject = new Map();
    for (const relation of projectFiles) {
        const ids = filesByProject.get(relation.project_id) ?? [];
        ids.push(relation.file_id);
        filesByProject.set(relation.project_id, ids);
    }

    for (const project of projects) {
        await pool.query(`
            INSERT INTO projects (id, title, subject, date, description, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO NOTHING
        `, [
            project.id,
            project.title,
            project.subject,
            project.date,
            project.description,
            Number(project.created_at) || now,
            Number(project.updated_at) || Number(project.created_at) || now
        ]);
        for (const fileId of filesByProject.get(project.id) ?? []) {
            await pool.query(`
                INSERT INTO project_files (project_id, file_id)
                SELECT $1, $2
                WHERE EXISTS (SELECT 1 FROM files WHERE id = $2)
                ON CONFLICT DO NOTHING
            `, [project.id, fileId]);
        }
        migratedProjects += 1;
    }

    console.log(`Migration abgeschlossen: ${migratedFiles} Dateien und ${migratedProjects} Projekte verarbeitet.`);
    console.log("Die SQLite-Quelldatei wurde nicht verändert.");
} finally {
    source.close();
    await pool.end();
}
