import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Pool } from "@neondatabase/serverless";
import { del, get } from "@vercel/blob";
import { handleUpload } from "@vercel/blob/client";
import { BLOB_ACCESS } from "../data/blobAccess.js";
import { createApiHandler } from "./handler.js";

let pool;
let handler;

function getPool() {
    if (pool) return pool;
    const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("Die Umgebungsvariable POSTGRES_URL (oder DATABASE_URL) ist nicht konfiguriert.");
    }
    pool = new Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 5_000,
        connectionTimeoutMillis: 10_000
    });
    return pool;
}

function getHandler() {
    if (handler) return handler;
    const databasePool = getPool();
    const database = {
        query: async (text, values = []) => databasePool.query(text, values),
        transaction: async operation => {
            const client = await databasePool.connect();
            try {
                await client.query("BEGIN");
                const result = await operation({
                    query: (text, values = []) => client.query(text, values)
                });
                await client.query("COMMIT");
                return result;
            } catch (transactionError) {
                await client.query("ROLLBACK");
                throw transactionError;
            } finally {
                client.release();
            }
        }
    };
    handler = createApiHandler({
        database,
        deleteBlob: url => del(url),
        getBlob: url => get(url, { access: BLOB_ACCESS }),
        handleBlobUpload: options => handleUpload(options)
    });
    return handler;
}

async function readIncomingBody(request) {
    if (request.body !== undefined && request.body !== null) {
        if (Buffer.isBuffer(request.body)) return request.body;
        if (typeof request.body === "string") return Buffer.from(request.body);
        return Buffer.from(JSON.stringify(request.body));
    }
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export default async function handleVercelApiRequest(request, response) {
    try {
        const body = await readIncomingBody(request);
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers ?? {})) {
            if (Array.isArray(value)) {
                value.forEach(item => headers.append(name, item));
            } else if (value !== undefined) {
                headers.set(name, String(value));
            }
        }
        const host = request.headers?.host ?? "localhost";
        const forwardedProtocol = request.headers?.["x-forwarded-proto"]?.split(",")[0];
        const protocol = forwardedProtocol ?? (host.startsWith("localhost") ? "http" : "https");
        const webRequest = new Request(
            new URL(request.url ?? "/", `${protocol}://${host}`),
            {
                method: request.method ?? "GET",
                headers,
                body: ["GET", "HEAD"].includes(request.method ?? "GET") || body.length === 0
                    ? undefined
                    : body
            }
        );
        const webResponse = await getHandler()(webRequest);
        response.statusCode = webResponse.status;
        webResponse.headers.forEach((value, name) => response.setHeader(name, value));
        if (!webResponse.body || webResponse.status === 204 || webResponse.status === 304) {
            response.end();
            return;
        }
        await pipeline(Readable.fromWeb(webResponse.body), response);
    } catch (error) {
        console.error("[Schulorganizer] Vercel API request failed:", error);
        if (response.headersSent) {
            response.end();
            return;
        }
        response.statusCode = error.message.includes("POSTGRES_URL")
            || error.message.includes("BLOB_READ_WRITE_TOKEN")
            ? 503
            : 500;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({
            error: error.message.includes("POSTGRES_URL")
                || error.message.includes("BLOB_READ_WRITE_TOKEN")
                ? error.message
                : "Die Serveranfrage konnte nicht verarbeitet werden."
        }));
    }
}

export { createApiHandler };
