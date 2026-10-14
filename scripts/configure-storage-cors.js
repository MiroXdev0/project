import { PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { createNeonStorageClient, storageBucket } from "../src/serverless/neonStorage.js";

const storage = createNeonStorageClient();
await storage.send(new PutBucketCorsCommand({
    Bucket: storageBucket,
    CORSConfiguration: {
        CORSRules: [{
            AllowedHeaders: ["*"],
            AllowedMethods: ["PUT", "GET", "HEAD"],
            AllowedOrigins: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600
        }]
    }
}));

console.log(`CORS für den privaten Neon-Bucket "${storageBucket}" eingerichtet.`);
