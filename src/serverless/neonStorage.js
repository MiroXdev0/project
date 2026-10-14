import { S3Client } from "@aws-sdk/client-s3";

export const storageBucket = "schulorganizer-files";

export function createNeonStorageClient(env = process.env) {
    const endpoint = env.AWS_ENDPOINT_URL_S3;
    const region = env.AWS_REGION;
    const accessKeyId = env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
    if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
        throw new Error("Neon Object Storage benötigt die vier AWS_* Umgebungsvariablen.");
    }
    let parsedEndpoint;
    try {
        parsedEndpoint = new URL(endpoint);
    } catch {
        throw new Error("Neon Object Storage hat keinen gültigen S3-Endpunkt.");
    }
    if (parsedEndpoint.protocol !== "https:") {
        throw new Error("Neon Object Storage erfordert einen HTTPS-S3-Endpunkt.");
    }
    return new S3Client({
        endpoint: parsedEndpoint.href,
        region,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true
    });
}
