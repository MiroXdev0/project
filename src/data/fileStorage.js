import { fetchSharedFile } from "./sharedApi.js";

export function readFile(id) {
    return fetchSharedFile(id);
}
