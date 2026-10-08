import { randomUUID } from "node:crypto";
import { handleUpload as handleVercelBlobUpload } from "@vercel/blob/client";

const maxFileSize = 100 * 1024 * 1024;
const schema = `
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        external_url TEXT NOT NULL DEFAULT '',
        blob_url TEXT,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_files (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        PRIMARY KEY (project_id, file_id)
    );
    CREATE INDEX IF NOT EXISTS project_files_file_id ON project_files(file_id);
    CREATE INDEX IF NOT EXISTS projects_created_at ON projects(created_at);
    CREATE INDEX IF NOT EXISTS files_created_at ON files(created_at);
`;

function cleanText(value, maxLength = 5000) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeFilename(value) {
    return String(value ?? "")
        .replaceAll("\\", "/")
        .split("/")
        .pop()
        .slice(0, 255) || "datei";
}

function json(data, status = 200, headers = {}) {
    return Response.json(data, { status, headers });
}

function failure(message, status = 400) {
    return json({ error: message }, status);
}

function normalizeFile(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        type: row.type,
        subject: row.subject,
        url: row.blob_url || row.external_url || "",
        mimeType: row.mime_type,
        size: Number(row.size),
        createdAt: Number(row.created_at),
        hasContent: Boolean(row.blob_url)
    };
}

function normalizeProject(row, fileIds = []) {
    if (!row) return null;
    return {
        id: row.id,
        title: row.title,
        subject: row.subject,
        date: row.date,
        description: row.description,
        createdAt: Number(row.created_at),
        fileIds
    };
}

async function getFile(database, id) {
    const result = await database.query(
        `SELECT id, name, type, subject, external_url, blob_url, mime_type, size, created_at
         FROM files WHERE id = $1`,
        [id]
    );
    return normalizeFile(result.rows[0]);
}

async function getProject(database, id) {
    const result = await database.query(
        `SELECT p.id, p.title, p.subject, p.date, p.description, p.created_at,
                COALESCE(array_agg(pf.file_id) FILTER (WHERE pf.file_id IS NOT NULL), '{}') AS file_ids
         FROM projects p
         LEFT JOIN project_files pf ON pf.project_id = p.id
         WHERE p.id = $1
         GROUP BY p.id`,
        [id]
    );
    const row = result.rows[0];
    return row ? normalizeProject(row, row.file_ids ?? []) : null;
}

async function getState(database) {
    const [projectsResult, filesResult] = await Promise.all([
        database.query(`
            SELECT p.id, p.title, p.subject, p.date, p.description, p.created_at,
                   COALESCE(array_agg(pf.file_id) FILTER (WHERE pf.file_id IS NOT NULL), '{}') AS file_ids
            FROM projects p
            LEFT JOIN project_files pf ON pf.project_id = p.id
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `),
        database.query(`
            SELECT id, name, type, subject, external_url, blob_url, mime_type, size, created_at
            FROM files ORDER BY created_at DESC
        `)
    ]);
    return {
        presentations: projectsResult.rows.map(row => normalizeProject(row, row.file_ids ?? [])),
        files: filesResult.rows.map(normalizeFile)
    };
}

function validBlobUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" &&
            url.hostname.endsWith(".blob.vercel-storage.com");
    } catch {
        return false;
    }
}

async function validateProjectFiles(database, fileIds) {
    if (!fileIds.length) return true;
    const result = await database.query(
        "SELECT id FROM files WHERE id = ANY($1::text[])",
        [fileIds]
    );
    return result.rows.length === fileIds.length;
}

function parseProjectBody(body) {
    const title = cleanText(body?.title, 160);
    if (!title) return { error: "Für das Projekt wird ein Titel benötigt." };
    return {
        title,
        subject: cleanText(body.subject, 100),
        date: cleanText(body.date, 10),
        description: cleanText(body.description),
        fileIds: Array.isArray(body.fileIds)
            ? [...new Set(body.fileIds.filter(id => typeof id === "string"))]
            : []
    };
}

async function ensureSchema(database, readySchemas) {
    if (readySchemas.has(database)) return readySchemas.get(database);
    const ready = (async () => {
        for (const statement of schema.split(";").map(item => item.trim()).filter(Boolean)) {
            await database.query(statement);
        }
    })();
    readySchemas.set(database, ready);
    try {
        await ready;
    } catch (error) {
        readySchemas.delete(database);
        throw error;
    }
}

export function createApiHandler({
    database,
    deleteBlob = async () => {},
    getBlob = async () => null,
    handleBlobUpload = handleVercelBlobUpload
}) {
    if (!database?.query || !database?.transaction) {
        throw new TypeError("A queryable PostgreSQL database is required.");
    }
    const readySchemas = new WeakMap();

    return async request => {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, "");
        const segments = path.split("/").filter(Boolean).map(segment => {
            try {
                return decodeURIComponent(segment);
            } catch {
                return "";
            }
        });
        if (segments[0] === "api") segments.shift();
        const method = request.method.toUpperCase();

        if (method === "OPTIONS") {
            return new Response(null, { status: 204 });
        }

        try {
            await ensureSchema(database, readySchemas);
            if (method === "GET" && segments[0] === "health") {
                await database.query("SELECT 1");
                return json({ status: "ok" });
            }
            if (method === "GET" && segments[0] === "state") {
                return json(await getState(database), 200, { "Cache-Control": "no-store" });
            }
            if (method === "GET" && segments[0] === "events") {
                return json({ sync: "polling", intervalMs: 5000 });
            }

            if (method === "POST" && segments[0] === "files" && segments[1] === "upload-token") {
                const token = process.env.BLOB_READ_WRITE_TOKEN;
                if (!token) {
                    return failure("Vercel Blob ist nicht konfiguriert. Setze BLOB_READ_WRITE_TOKEN.", 503);
                }
                const body = await request.json();
                const result = await handleBlobUpload({
                    token,
                    request,
                    body,
                    onBeforeGenerateToken: async pathname => ({
                        allowedContentTypes: [
                            "image/*",
                            "video/*",
                            "audio/*",
                            "application/*",
                            "text/*"
                        ],
                        maximumSizeInBytes: maxFileSize,
                        addRandomSuffix: true,
                        tokenPayload: JSON.stringify({ pathname: safeFilename(pathname) })
                    })
                });
                return json(result);
            }

            if (method === "POST" && segments[0] === "projects" && segments.length === 1) {
                const body = parseProjectBody(await request.json());
                if (body.error) return failure(body.error);
                if (!(await validateProjectFiles(database, body.fileIds))) {
                    return failure("Mindestens eine angehängte Datei wurde nicht gefunden.");
                }
                const id = randomUUID();
                const now = Date.now();
                await database.transaction(async transaction => {
                    await transaction.query(
                        `INSERT INTO projects (id, title, subject, date, description, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
                        [id, body.title, body.subject, body.date, body.description, now]
                    );
                    for (const fileId of body.fileIds) {
                        await transaction.query(
                            "INSERT INTO project_files (project_id, file_id) VALUES ($1, $2)",
                            [id, fileId]
                        );
                    }
                });
                return json(await getProject(database, id), 201);
            }

            if (segments[0] === "projects" && segments.length === 2 && method === "PUT") {
                const body = parseProjectBody(await request.json());
                if (body.error) return failure(body.error);
                const existing = await database.query(
                    "SELECT id FROM projects WHERE id = $1",
                    [segments[1]]
                );
                if (!existing.rows.length) return failure("Das Projekt wurde nicht gefunden.", 404);
                if (!(await validateProjectFiles(database, body.fileIds))) {
                    return failure("Mindestens eine angehängte Datei wurde nicht gefunden.");
                }
                await database.transaction(async transaction => {
                    await transaction.query(
                        `UPDATE projects
                         SET title = $1, subject = $2, date = $3, description = $4, updated_at = $5
                         WHERE id = $6`,
                        [body.title, body.subject, body.date, body.description, Date.now(), segments[1]]
                    );
                    await transaction.query("DELETE FROM project_files WHERE project_id = $1", [segments[1]]);
                    for (const fileId of body.fileIds) {
                        await transaction.query(
                            "INSERT INTO project_files (project_id, file_id) VALUES ($1, $2)",
                            [segments[1], fileId]
                        );
                    }
                });
                return json(await getProject(database, segments[1]));
            }

            if (segments[0] === "projects" && segments.length === 2 && method === "DELETE") {
                const result = await database.query(
                    "DELETE FROM projects WHERE id = $1 RETURNING id",
                    [segments[1]]
                );
                return result.rows.length
                    ? new Response(null, { status: 204 })
                    : failure("Das Projekt wurde nicht gefunden.", 404);
            }

            if (method === "POST" && segments[0] === "files" && segments.length === 1) {
                const body = await request.json();
                const name = safeFilename(body.name);
                const blobUrl = cleanText(body.url, 2048);
                if (!name || !validBlobUrl(blobUrl)) {
                    return failure("Die hochgeladene Datei hat keine gültige Vercel-Blob-Adresse.");
                }
                const id = cleanText(body.id, 100) || randomUUID();
                const mimeType = cleanText(body.mimeType, 150) || "application/octet-stream";
                const size = Number(body.size);
                if (!Number.isFinite(size) || size < 0 || size > maxFileSize) {
                    return failure("Dateien dürfen höchstens 100 MB groß sein.");
                }
                const existing = await database.query("SELECT blob_url FROM files WHERE id = $1", [id]);
                if (existing.rows.length) {
                    if (existing.rows[0].blob_url === blobUrl) return json(await getFile(database, id));
                    return failure("Diese Datei-ID wird bereits verwendet.", 409);
                }
                await database.query(
                    `INSERT INTO files (id, name, type, subject, blob_url, mime_type, size, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        id,
                        name,
                        cleanText(body.type, 40) || "Sonstiges",
                        cleanText(body.subject, 100),
                        blobUrl,
                        mimeType,
                        Math.trunc(size),
                        Number(body.createdAt) || Date.now()
                    ]
                );
                return json(await getFile(database, id), 201);
            }

            if (method === "POST" && segments[0] === "migration" && segments[1] === "files") {
                const body = await request.json();
                const id = cleanText(body.id, 100);
                const name = safeFilename(body.name);
                if (!id || !name) return failure("Die alte Datei enthält keine gültige ID oder keinen Dateinamen.");
                const blobUrl = cleanText(body.blobUrl, 2048);
                if (blobUrl && !validBlobUrl(blobUrl)) {
                    return failure("Die alte Datei hat keine gültige Vercel-Blob-Adresse.");
                }
                const externalUrl = cleanText(body.url, 2048);
                if (!blobUrl && externalUrl) {
                    try {
                        const parsedExternalUrl = new URL(externalUrl);
                        if (!["http:", "https:"].includes(parsedExternalUrl.protocol)) {
                            return failure("Die alte Datei enthält keinen gültigen HTTP(S)-Link.");
                        }
                    } catch {
                        return failure("Die alte Datei enthält keinen gültigen HTTP(S)-Link.");
                    }
                }
                const existing = await database.query(
                    "SELECT blob_url FROM files WHERE id = $1",
                    [id]
                );
                let migrated = false;
                let repaired = false;
                if (existing.rows.length) {
                    if (!existing.rows[0].blob_url && blobUrl) {
                        await database.query(
                            `UPDATE files
                             SET blob_url = $1, external_url = '', mime_type = $2, size = $3
                             WHERE id = $4 AND blob_url IS NULL`,
                            [
                                blobUrl,
                                cleanText(body.mimeType, 150) || "application/octet-stream",
                                Number(body.size) || 0,
                                id
                            ]
                        );
                        repaired = true;
                    }
                } else {
                    await database.query(
                        `INSERT INTO files
                         (id, name, type, subject, external_url, blob_url, mime_type, size, created_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                        [
                            id,
                            name,
                            cleanText(body.type, 40) || "Sonstiges",
                            cleanText(body.subject, 100),
                            blobUrl ? "" : externalUrl,
                            blobUrl || null,
                            cleanText(body.mimeType, 150) || "application/octet-stream",
                            Number(body.size) || 0,
                            Number(body.createdAt) || Date.now()
                        ]
                    );
                    migrated = true;
                }
                return json({ file: await getFile(database, id), migrated, repaired }, migrated ? 201 : 200);
            }

            if (method === "POST" && segments[0] === "migration" && segments[1] === "projects") {
                const body = await request.json();
                const id = cleanText(body.id, 100);
                const title = cleanText(body.title, 160);
                const fileIds = Array.isArray(body.fileIds)
                    ? [...new Set(body.fileIds.filter(fileId => typeof fileId === "string"))]
                    : [];
                if (!id || !title) {
                    return failure("Das alte Projekt enthält keine gültige ID oder keinen Titel.");
                }
                if (!(await validateProjectFiles(database, fileIds))) {
                    return failure("Mindestens eine alte Projektdatei wurde nicht gefunden.");
                }
                let migrated = false;
                let repaired = false;
                await database.transaction(async transaction => {
                    const result = await transaction.query(
                        `INSERT INTO projects (id, title, subject, date, description, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $6)
                         ON CONFLICT (id) DO NOTHING
                         RETURNING id`,
                        [
                            id,
                            title,
                            cleanText(body.subject, 100),
                            cleanText(body.date, 10),
                            cleanText(body.description),
                            Number(body.createdAt) || Date.now()
                        ]
                    );
                    migrated = result.rows.length > 0;
                    const existingLinks = await transaction.query(
                        "SELECT file_id FROM project_files WHERE project_id = $1",
                        [id]
                    );
                    const linkedIds = new Set(existingLinks.rows.map(row => row.file_id));
                    for (const fileId of fileIds) {
                        if (linkedIds.has(fileId)) continue;
                        await transaction.query(
                            "INSERT INTO project_files (project_id, file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                            [id, fileId]
                        );
                        repaired = true;
                    }
                });
                return json({
                    project: await getProject(database, id),
                    migrated,
                    repaired
                }, migrated ? 201 : 200);
            }

            if (method === "POST" && segments[0] === "file-links") {
                const body = await request.json();
                const name = safeFilename(body.name);
                let target;
                try {
                    target = new URL(cleanText(body.url, 2048));
                } catch {
                    return failure("Bitte einen gültigen Datei-Link eingeben.");
                }
                if (!name || !["http:", "https:"].includes(target.protocol)) {
                    return failure("Bitte einen Namen und einen sicheren HTTP(S)-Link eingeben.");
                }
                const id = randomUUID();
                await database.query(
                    `INSERT INTO files (id, name, type, subject, external_url, size, created_at)
                     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
                    [
                        id,
                        name,
                        cleanText(body.type, 40),
                        cleanText(body.subject, 100),
                        target.href,
                        Date.now()
                    ]
                );
                return json(await getFile(database, id), 201);
            }

            if (segments[0] === "files" && segments.length === 2 && method === "PUT") {
                const body = await request.json();
                const existingResult = await database.query(
                    "SELECT blob_url, external_url FROM files WHERE id = $1",
                    [segments[1]]
                );
                const existing = existingResult.rows[0];
                if (!existing) return failure("Die Datei wurde nicht gefunden.", 404);
                const hasUrl = typeof body.url === "string";
                const updatedUrl = hasUrl ? cleanText(body.url, 2048) : "";
                const keepBlob = Boolean(existing.blob_url && (!hasUrl || updatedUrl === existing.blob_url));
                let externalUrl = existing.external_url;
                if (hasUrl && !keepBlob) {
                    if (updatedUrl && !/^https?:\/\//i.test(updatedUrl)) {
                        return failure("Bitte einen gültigen HTTP(S)-Datei-Link eingeben.");
                    }
                    externalUrl = updatedUrl;
                }
                await database.query(
                    `UPDATE files
                     SET                      name = COALESCE($1, name), type = COALESCE($2, type),
                     subject = COALESCE($3, subject), external_url = $4,
                         blob_url = $5
                     WHERE id = $6`,
                    [
                        typeof body.name === "string" ? safeFilename(body.name) : null,
                        typeof body.type === "string" ? cleanText(body.type, 40) : null,
                        typeof body.subject === "string" ? cleanText(body.subject, 100) : null,
                        keepBlob ? "" : externalUrl,
                        keepBlob ? existing.blob_url : null,
                        segments[1]
                    ]
                );
                return json(await getFile(database, segments[1]));
            }

            if (segments[0] === "files" && segments[1] && segments[2] === "content" && method === "GET") {
                const result = await database.query(
                    "SELECT blob_url FROM files WHERE id = $1",
                    [segments[1]]
                );
                const blobUrl = result.rows[0]?.blob_url;
                if (!blobUrl) return failure("Der Dateiinhalt wurde nicht gefunden.", 404);
                const file = await getFile(database, segments[1]);
                const blob = await getBlob(blobUrl);
                if (!blob || blob.statusCode !== 200) {
                    return failure("Der Dateiinhalt wurde nicht gefunden.", 404);
                }
                const filename = encodeURIComponent(file.name).replace(
                    /[!'()*]/g,
                    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
                );
                return new Response(blob.stream, {
                    headers: {
                        "Content-Type": blob.blob.contentType,
                        "Content-Disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
                        "Cache-Control": "private, no-store",
                        "X-Content-Type-Options": "nosniff"
                    }
                });
            }

            if (segments[0] === "files" && segments.length === 2 && method === "DELETE") {
                const file = await getFile(database, segments[1]);
                if (!file) return failure("Die Datei wurde nicht gefunden.", 404);
                if (file.hasContent) {
                    try {
                        await deleteBlob(file.url);
                    } catch (deleteError) {
                        console.error("[Schulorganizer] Vercel Blob delete failed:", deleteError);
                        return failure(
                            "Die Datei konnte nicht aus Vercel Blob gelöscht werden. Der Dateieintrag bleibt erhalten; prüfe die serverseitige Blob-Konfiguration und versuche es erneut.",
                            502
                        );
                    }
                }
                await database.query("DELETE FROM files WHERE id = $1", [segments[1]]);
                return new Response(null, { status: 204 });
            }

            return failure("API-Endpunkt nicht gefunden.", 404);
        } catch (error) {
            console.error("[Schulorganizer] API operation failed:", error);
            if (error instanceof SyntaxError) return failure("Die Anfrage enthält kein gültiges JSON.");
            if (error.message?.includes("BLOB_READ_WRITE_TOKEN")) {
                return failure("Vercel Blob ist nicht konfiguriert. Setze BLOB_READ_WRITE_TOKEN.", 503);
            }
            return failure("Die Serveranfrage konnte nicht verarbeitet werden.", 500);
        }
    };
}

export { schema as postgresSchema };
