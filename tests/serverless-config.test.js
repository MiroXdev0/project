import assert from "node:assert/strict";
import { test } from "node:test";
import { getDatabaseConnectionString } from "../src/serverless/api.js";

const validUrl = "postgresql://app-user:app-password@db.example.test/app";

test("database connection strings accept dotenv-style quotes copied into Vercel", () => {
    assert.equal(
        getDatabaseConnectionString({ DATABASE_URL: `"${validUrl}"` }),
        validUrl
    );
    assert.equal(
        getDatabaseConnectionString({ DATABASE_URL: `'${validUrl}'` }),
        validUrl
    );
});

test("database connection strings skip empty variables and use a valid fallback", () => {
    assert.equal(
        getDatabaseConnectionString({
            POSTGRES_URL: " ",
            DATABASE_URL: validUrl
        }),
        validUrl
    );
});

test("database connection strings reject invalid URL schemes without exposing credentials", () => {
    assert.throws(
        () => getDatabaseConnectionString({ DATABASE_URL: "https://db.example.test/" }),
        /must be a PostgreSQL connection string|PostgreSQL-Verbindungszeichenfolge/
    );
    assert.throws(
        () => getDatabaseConnectionString({ DATABASE_URL: "not-a-url" }),
        error => {
            assert.match(error.message, /DATABASE_URL/);
            assert.doesNotMatch(error.message, /app-password|db\.example/);
            return true;
        }
    );
});
