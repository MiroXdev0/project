import {
    createSharedPresentation,
    deleteSharedPresentation,
    getSharedPresentations,
    updateSharedPresentation
} from "../data/sharedApi.js";

export function getPresentations() {
    return getSharedPresentations();
}

export function addPresentation(
    title,
    subject = "",
    date = "",
    description = "",
    details = {}
) {
    return createSharedPresentation({
        title,
        subject,
        date,
        description,
        fileIds: details.fileIds ?? []
    });
}

export function updatePresentation(id, changes) {
    return updateSharedPresentation(id, changes);
}

export function deletePresentation(id) {
    return deleteSharedPresentation(id);
}
