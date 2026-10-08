import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";
import multer from "multer";

const root = path.dirname(fileURLToPath(import.meta.url));
const maxFileSize = 100 * 1024 * 1024;

export function createDatabase(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.exec(`
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            subject TEXT NOT NULL DEFAULT '',
            date TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL DEFAULT '',
            url TEXT NOT NULL DEFAULT '',
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            size INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            content BLOB
        );

        CREATE TABLE IF NOT EXISTS project_files (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            PRIMARY KEY (project_id, file_id)
        );

        CREATE INDEX IF NOT EXISTS project_files_file_id ON project_files(file_id);
        CREATE INDEX IF NOT EXISTS projects_created_at ON projects(created_at);
        CREATE INDEX IF NOT EXISTS files_created_at ON files(created_at);
    `);

    return database;
}

function cleanText(value, maxLength = 5000) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getProject(database, id) {
    const project = database.prepare(`
        SELECT id, title, subject, date, description, created_at AS createdAt
        FROM projects WHERE id = ?
    `).get(id);
    if (!project) return null;
    project.fileIds = database.prepare(
        "SELECT file_id FROM project_files WHERE project_id = ? ORDER BY rowid"
    ).all(id).map(row => row.file_id);
    return project;
}

function getFile(database, id) {
    return database.prepare(`
        SELECT id, name, type, subject, url, mime_type AS mimeType,
               size, created_at AS createdAt
        FROM files WHERE id = ?
    `).get(id) ?? null;
}

function getState(database) {
    const projects = database.prepare(`
        SELECT id, title, subject, date, description, created_at AS createdAt
        FROM projects ORDER BY created_at DESC
    `).all();
    const projectFiles = database.prepare(
        "SELECT project_id AS projectId, file_id AS fileId FROM project_files ORDER BY rowid"
    ).all();
    const files = database.prepare(`
        SELECT id, name, type, subject, url, mime_type AS mimeType,
               size, created_at AS createdAt, content IS NOT NULL AS hasContent
        FROM files ORDER BY created_at DESC
    `).all();
    files.forEach(file => {
        file.hasContent = Boolean(file.hasContent);
    });

    const fileIds = new Map();
    projectFiles.forEach(({ projectId, fileId }) => {
        if (!fileIds.has(projectId)) fileIds.set(projectId, []);
        fileIds.get(projectId).push(fileId);
    });
    projects.forEach(project => {
        project.fileIds = fileIds.get(project.id) ?? [];
    });
    return { presentations: projects, files };
}

function safeFilename(name) {
    return path.basename(String(name).replaceAll("\\", "/")).slice(0, 255) || "datei";
}

export function createApiApp(database) {
    const app = express();
    const clients = new Set();
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: maxFileSize, files: 1 }
    });
    const insertProjectFiles = database.prepare(
        "INSERT INTO project_files (project_id, file_id) VALUES (?, ?)"
    );

    function publishUpdate() {
        const message = `event: update\ndata: ${Date.now()}\n\n`;
        clients.forEach(response => response.write(message));
    }

    app.disable("x-powered-by");
    app.use("/api", (request, response, next) => {
        const origin = request.get("Origin");
        const configuredOrigins = (process.env.APP_ORIGIN ?? "")
            .split(",")
            .map(value => value.trim())
            .filter(Boolean);
        const isLocalDevelopmentOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? "");
        response.vary("Origin");

        if (origin && (configuredOrigins.includes(origin) || isLocalDevelopmentOrigin)) {
            response.set("Access-Control-Allow-Origin", origin);
            response.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            response.set("Access-Control-Allow-Headers", "Content-Type");
            response.set("Access-Control-Max-Age", "600");
        } else if (origin) {
            response.status(403).json({
                error: "Diese Website ist nicht für den gemeinsamen Datei-Server freigegeben. Ergänze ihre Adresse in APP_ORIGIN."
            });
            return;
        }

        if (request.method === "OPTIONS") {
            response.status(204).end();
            return;
        }
        next();
    });
    app.use("/api", express.json({ limit: "1mb" }));

    app.get("/api/health", (_request, response) => {
        response.json({ status: "ok" });
    });

    app.get("/api/state", (_request, response) => {
        response.set("Cache-Control", "no-store");
        response.json(getState(database));
    });

    app.get("/api/events", (request, response) => {
        response.status(200);
        response.set({
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
        });
        response.flushHeaders();
        response.write("retry: 3000\n\n");
        clients.add(response);

        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20_000);
        heartbeat.unref();
        request.on("close", () => {
            clearInterval(heartbeat);
            clients.delete(response);
        });
    });

    app.post("/api/projects", (request, response) => {
        const title = cleanText(request.body?.title, 160);
        if (!title) {
            response.status(400).json({ error: "Für das Projekt wird ein Titel benötigt." });
            return;
        }

        const fileIds = Array.isArray(request.body.fileIds)
            ? [...new Set(request.body.fileIds.filter(id => typeof id === "string"))]
            : [];
        const insert = database.transaction(() => {
            if (fileIds.length) {
                const placeholders = fileIds.map(() => "?").join(", ");
                const found = database.prepare(
                    `SELECT id FROM files WHERE id IN (${placeholders})`
                ).all(...fileIds);
                if (found.length !== fileIds.length) {
                    const error = new Error("Mindestens eine angehängte Datei wurde nicht gefunden.");
                    error.status = 400;
                    throw error;
                }
            }

            const id = crypto.randomUUID();
            const now = Date.now();
            database.prepare(`
                INSERT INTO projects (id, title, subject, date, description, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                title,
                cleanText(request.body.subject, 100),
                cleanText(request.body.date, 10),
                cleanText(request.body.description),
                now,
                now
            );
            fileIds.forEach(fileId => insertProjectFiles.run(id, fileId));
            return id;
        });

        try {
            const id = insert();
            publishUpdate();
            response.status(201).json(getProject(database, id));
        } catch (error) {
            response.status(error.status ?? 500).json({
                error: error.status ? error.message : "Das Projekt konnte nicht gespeichert werden."
            });
        }
    });

    app.put("/api/projects/:id", (request, response) => {
        const title = cleanText(request.body?.title, 160);
        if (!title) {
            response.status(400).json({ error: "Für das Projekt wird ein Titel benötigt." });
            return;
        }

        const fileIds = Array.isArray(request.body.fileIds)
            ? [...new Set(request.body.fileIds.filter(id => typeof id === "string"))]
            : [];
        try {
            const update = database.transaction(() => {
                if (!database.prepare("SELECT id FROM projects WHERE id = ?").get(request.params.id)) {
                    return false;
                }
                if (fileIds.length) {
                    const placeholders = fileIds.map(() => "?").join(", ");
                    const found = database.prepare(
                        `SELECT id FROM files WHERE id IN (${placeholders})`
                    ).all(...fileIds);
                    if (found.length !== fileIds.length) {
                        const error = new Error("Mindestens eine angehängte Datei wurde nicht gefunden.");
                        error.status = 400;
                        throw error;
                    }
                }

                database.prepare(`
                    UPDATE projects
                    SET title = ?, subject = ?, date = ?, description = ?, updated_at = ?
                    WHERE id = ?
                `).run(
                    title,
                    cleanText(request.body.subject, 100),
                    cleanText(request.body.date, 10),
                    cleanText(request.body.description),
                    Date.now(),
                    request.params.id
                );
                database.prepare("DELETE FROM project_files WHERE project_id = ?")
                    .run(request.params.id);
                fileIds.forEach(fileId => insertProjectFiles.run(request.params.id, fileId));
                return true;
            });

            if (!update()) {
                response.status(404).json({ error: "Das Projekt wurde nicht gefunden." });
                return;
            }
            publishUpdate();
            response.json(getProject(database, request.params.id));
        } catch (error) {
            response.status(error.status ?? 500).json({
                error: error.status ? error.message : "Das Projekt konnte nicht aktualisiert werden."
            });
        }
    });

    app.delete("/api/projects/:id", (request, response) => {
        const result = database.prepare("DELETE FROM projects WHERE id = ?")
            .run(request.params.id);
        if (!result.changes) {
            response.status(404).json({ error: "Das Projekt wurde nicht gefunden." });
            return;
        }
        publishUpdate();
        response.status(204).end();
    });

    app.post("/api/files", upload.single("file"), (request, response) => {
        if (!request.file) {
            response.status(400).json({ error: "Es wurde keine Datei übertragen." });
            return;
        }

        const id = crypto.randomUUID();
        const file = {
            id,
            name: safeFilename(request.file.originalname),
            type: cleanText(request.body.type, 40) || "Sonstiges",
            subject: cleanText(request.body.subject, 100),
            url: "",
            mimeType: cleanText(request.file.mimetype, 150) || "application/octet-stream",
            size: request.file.size,
            createdAt: Date.now()
        };
        try {
            database.prepare(`
                INSERT INTO files (id, name, type, subject, url, mime_type, size, created_at, content)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                file.id,
                file.name,
                file.type,
                file.subject,
                file.url,
                file.mimeType,
                file.size,
                file.createdAt,
                request.file.buffer
            );
            publishUpdate();
            response.status(201).json(file);
        } catch (error) {
            console.error("[Schulorganizer] Datei konnte nicht in der Datenbank gespeichert werden:", error);
            response.status(500).json({ error: "Die Datei konnte nicht auf dem Server gespeichert werden." });
        }
    });

    app.post("/api/migration/files", upload.single("file"), (request, response) => {
        const id = cleanText(request.body?.id, 100);
        const name = safeFilename(cleanText(request.body?.name ?? request.file?.originalname, 255));
        if (!id || !name) {
            response.status(400).json({ error: "Die alte Datei enthält keine gültige ID oder keinen Dateinamen." });
            return;
        }

        const file = {
            id,
            name,
            type: cleanText(request.body.type, 40) || "Sonstiges",
            subject: cleanText(request.body.subject, 100),
            url: cleanText(request.body.url, 2048),
            mimeType: request.file && request.file.mimetype !== "application/octet-stream"
                ? cleanText(request.file.mimetype, 150)
                : cleanText(request.body.mimeType, 150) || "application/octet-stream",
            size: request.file?.size ?? (
                Number.isFinite(Number(request.body.size)) && Number(request.body.size) >= 0
                    ? Number(request.body.size)
                    : 0
            ),
            createdAt: Number(request.body.createdAt) || Date.now()
        };
        try {
            const migrate = database.transaction(() => {
                const existing = database.prepare(
                    "SELECT content IS NOT NULL AS hasContent FROM files WHERE id = ?"
                ).get(id);
                if (existing) {
                    const repaired = !existing.hasContent && request.file
                        ? database.prepare(`
                            UPDATE files
                            SET content = ?, size = ?, mime_type = ?
                            WHERE id = ? AND content IS NULL
                        `).run(request.file.buffer, request.file.size, file.mimeType, id).changes > 0
                        : false;
                    return { migrated: false, repaired };
                }

                database.prepare(`
                    INSERT INTO files (id, name, type, subject, url, mime_type, size, created_at, content)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    file.id,
                    file.name,
                    file.type,
                    file.subject,
                    file.url,
                    file.mimeType,
                    file.size,
                    file.createdAt,
                    request.file?.buffer ?? null
                );
                return { migrated: true, repaired: false };
            });
            const result = migrate();
            if (result.migrated || result.repaired) publishUpdate();
            response.status(result.migrated ? 201 : 200).json({
                file: getFile(database, id),
                ...result
            });
        } catch (error) {
            console.error("[Schulorganizer] Alte Datei konnte nicht übernommen werden:", error);
            response.status(500).json({ error: "Eine alte Datei konnte nicht auf den Server übernommen werden." });
        }
    });

    app.post("/api/migration/projects", (request, response) => {
        const id = cleanText(request.body?.id, 100);
        const title = cleanText(request.body?.title, 160);
        const fileIds = Array.isArray(request.body?.fileIds)
            ? [...new Set(request.body.fileIds.filter(fileId => typeof fileId === "string"))]
            : [];
        if (!id || !title) {
            response.status(400).json({ error: "Das alte Projekt enthält keine gültige ID oder keinen Titel." });
            return;
        }
        try {
            const insert = database.transaction(() => {
                if (fileIds.length) {
                    const placeholders = fileIds.map(() => "?").join(", ");
                    const found = database.prepare(
                        `SELECT id FROM files WHERE id IN (${placeholders})`
                    ).all(...fileIds);
                    if (found.length !== fileIds.length) {
                        const error = new Error("Mindestens eine alte Projektdatei wurde nicht gefunden.");
                        error.status = 400;
                        throw error;
                    }
                }
                const createdAt = Number(request.body.createdAt) || Date.now();
                const inserted = database.prepare(`
                    INSERT OR IGNORE INTO projects (id, title, subject, date, description, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(
                    id,
                    title,
                    cleanText(request.body.subject, 100),
                    cleanText(request.body.date, 10),
                    cleanText(request.body.description),
                    createdAt,
                    createdAt
                );
                if (inserted.changes) {
                    fileIds.forEach(fileId => insertProjectFiles.run(id, fileId));
                    return { migrated: true, repaired: false };
                }
                const existingFileIds = new Set(database.prepare(
                    "SELECT file_id FROM project_files WHERE project_id = ?"
                ).all(id).map(row => row.file_id));
                const missingFileIds = fileIds.filter(fileId => !existingFileIds.has(fileId));
                missingFileIds.forEach(fileId => insertProjectFiles.run(id, fileId));
                if (missingFileIds.length) {
                    database.prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
                        .run(Date.now(), id);
                }
                return { migrated: false, repaired: missingFileIds.length > 0 };
            });
            const result = insert();
            if (result.migrated || result.repaired) publishUpdate();
            response.status(result.migrated ? 201 : 200).json({
                project: getProject(database, id),
                ...result
            });
        } catch (error) {
            response.status(error.status ?? 500).json({
                error: error.status ? error.message : "Ein altes Projekt konnte nicht auf den Server übernommen werden."
            });
        }
    });

    app.post("/api/file-links", (request, response) => {
        const name = safeFilename(cleanText(request.body?.name, 255));
        const url = cleanText(request.body?.url, 2048);
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch {
            response.status(400).json({ error: "Bitte einen gültigen Datei-Link eingeben." });
            return;
        }
        if (!name || !["http:", "https:"].includes(parsedUrl.protocol)) {
            response.status(400).json({ error: "Bitte einen Namen und einen sicheren HTTP(S)-Link eingeben." });
            return;
        }

        const file = {
            id: crypto.randomUUID(),
            name,
            type: cleanText(request.body.type, 40),
            subject: cleanText(request.body.subject, 100),
            url: parsedUrl.href,
            mimeType: "",
            size: 0,
            createdAt: Date.now()
        };
        database.prepare(`
            INSERT INTO files (id, name, type, subject, url, mime_type, size, created_at, content)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `).run(
            file.id, file.name, file.type, file.subject, file.url,
            file.mimeType, file.size, file.createdAt
        );
        publishUpdate();
        response.status(201).json(file);
    });

    app.put("/api/files/:id", (request, response) => {
        const result = database.prepare(`
            UPDATE files SET name = ?, type = ?, subject = ?, url = ?
            WHERE id = ?
        `).run(
            safeFilename(cleanText(request.body?.name, 255)),
            cleanText(request.body?.type, 40),
            cleanText(request.body?.subject, 100),
            cleanText(request.body?.url, 2048),
            request.params.id
        );
        if (!result.changes) {
            response.status(404).json({ error: "Die Datei wurde nicht gefunden." });
            return;
        }
        publishUpdate();
        response.json(getFile(database, request.params.id));
    });

    app.get("/api/files/:id/content", (request, response) => {
        const file = database.prepare(
            "SELECT name, mime_type AS mimeType, content FROM files WHERE id = ?"
        ).get(request.params.id);
        if (!file?.content) {
            response.status(404).json({ error: "Der Dateiinhalt wurde nicht gefunden." });
            return;
        }

        const disposition = request.query.download === "1" ? "attachment" : "inline";
        response.set({
            "Content-Type": file.mimeType || "application/octet-stream",
            "Content-Length": file.content.length,
            "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff"
        });
        response.send(file.content);
    });

    app.delete("/api/files/:id", (request, response) => {
        const result = database.prepare("DELETE FROM files WHERE id = ?")
            .run(request.params.id);
        if (!result.changes) {
            response.status(404).json({ error: "Die Datei wurde nicht gefunden." });
            return;
        }
        publishUpdate();
        response.status(204).end();
    });

    app.use("/api", (_request, response) => {
        response.status(404).json({ error: "API-Endpunkt nicht gefunden." });
    });

    app.use((error, _request, response, _next) => {
        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
            response.status(413).json({ error: "Dateien dürfen höchstens 100 MB groß sein." });
            return;
        }
        console.error("[Schulorganizer] Serveranfrage fehlgeschlagen:", error);
        response.status(500).json({ error: "Die Serveranfrage konnte nicht verarbeitet werden." });
    });

    return app;
}

async function start() {
    const databasePath = process.env.DATABASE_PATH
        ? path.resolve(process.env.DATABASE_PATH)
        : path.join(root, "data", "schulorganizer.sqlite");
    const database = createDatabase(databasePath);
    const app = createApiApp(database);
    const isDevelopment = process.argv[2] !== "production";

    if (isDevelopment) {
        const { createServer } = await import("vite");
        const apiPort = Number(process.env.API_PORT ?? 3001);
        const apiServer = app.listen(apiPort, "127.0.0.1");
        const vite = await createServer({
            server: {
                host: process.env.HOST ?? "127.0.0.1",
                port: Number(process.env.PORT ?? 5173),
                strictPort: true,
                proxy: {
                    "/api": `http://127.0.0.1:${apiPort}`
                }
            }
        });
        await vite.listen();
        vite.printUrls();

        const closeServers = async () => {
            await vite.close();
            apiServer.close();
            database.close();
        };
        process.once("SIGINT", closeServers);
        process.once("SIGTERM", closeServers);
        return;
    }

    app.use(express.static(path.join(root, "dist"), {
        etag: true,
        maxAge: "1h"
    }));
    app.get("*path", (_request, response) => {
        response.sendFile(path.join(root, "dist", "index.html"));
    });

    const server = app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "0.0.0.0", () => {
        console.log(`[Schulorganizer] Server läuft auf Port ${process.env.PORT ?? 3000}.`);
    });
    const closeServer = () => server.close(() => {
        database.close();
        process.exit(0);
    });
    process.once("SIGINT", closeServer);
    process.once("SIGTERM", closeServer);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    start().catch(error => {
        console.error("[Schulorganizer] Serverstart fehlgeschlagen:", error);
        process.exitCode = 1;
    });
}
