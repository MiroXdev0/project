import {
    createSharedFileLink,
    deleteSharedFile,
    getSharedFiles,
    updateSharedFile,
    uploadSharedFile
} from "../data/sharedApi.js";

export function getFiles() {
    return getSharedFiles();
}

export function addFile(
    name,
    type = "",
    subject = "",
    url = "",
    details = {}
) {
    if (details.content instanceof Blob) {
        return uploadSharedFile(details.content, {
            type,
            subject,
            onUploadProgress: details.onUploadProgress
        });
    }

    return createSharedFileLink({
        name,
        type,
        subject,
        url
    });
}

export function updateFile(id, changes) {
    return updateSharedFile(id, changes);
}

export function deleteFile(id) {
    return deleteSharedFile(id);
}
