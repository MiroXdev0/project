const modal =
    document.querySelector("#modal");

const modalTitle =
    document.querySelector("#modalTitle");

const modalBody =
    document.querySelector("#modalBody");

const modalClose =
    document.querySelector("#modalClose");

const modalCancel =
    document.querySelector("#modalCancel");

const modalSubmit =
    document.querySelector("#modalSubmit");

let submitHandler = null;
let closeHandler = null;
let isSubmitting = false;

let previouslyFocusedElement = null;


function ensureModal() {
    if (!modal) {
        throw new Error(
            "Modal element #modal wurde nicht gefunden."
        );
    }
}


/*
|--------------------------------------------------------------------------
| Modal lifecycle
|--------------------------------------------------------------------------
*/

export function openModal({
    title = "Dialog",
    content,
    onSubmit = null,
    onClose = null,
    submitText = "Speichern",
    cancelText = "Abbrechen"
}) {
    ensureModal();

    previouslyFocusedElement =
        document.activeElement;

    modalTitle.textContent = title;

    modalBody.replaceChildren();

    if (content instanceof Node) {
        modalBody.appendChild(content);
    } else {
        throw new TypeError(
            "Modal content muss ein DOM-Element sein."
        );
    }

    modalSubmit.textContent =
        submitText;

    modalCancel.textContent =
        cancelText;

    submitHandler = onSubmit;
    closeHandler = onClose;

    isSubmitting = false;

    setSubmitState(true);

    modal.classList.add("visible");

    modal.setAttribute(
        "aria-hidden",
        "false"
    );

    document.body.classList.add(
        "modal-open"
    );

    const initialFocus =
        modalBody.querySelector("[data-initial-focus]");
    const firstInput =
        modalBody.querySelector(
            "input:not([type='hidden']):not([tabindex='-1']), textarea, select"
        );

    const focusTarget =
        initialFocus ?? firstInput ?? modal.querySelector(".modal-content");
    focusTarget?.focus();
    window.requestAnimationFrame(() => {
        if (
            modal.classList.contains("visible") &&
            !modal.contains(document.activeElement)
        ) {
            focusTarget?.focus();
        }
    });
}


export function closeModal() {
    if (!modal) {
        return;
    }

    const onClose = closeHandler;
    closeHandler = null;
    modal.classList.remove("visible");

    modal.setAttribute(
        "aria-hidden",
        "true"
    );

    document.body.classList.remove(
        "modal-open"
    );

    modalBody.replaceChildren();

    submitHandler = null;

    isSubmitting = false;

    setSubmitState(true);

    if (
        previouslyFocusedElement &&
        typeof previouslyFocusedElement.focus ===
            "function"
    ) {
        previouslyFocusedElement.focus();
    }

    previouslyFocusedElement = null;
    onClose?.();
}


/*
|--------------------------------------------------------------------------
| Submit
|--------------------------------------------------------------------------
*/

export async function submitModal() {
    if (
        !submitHandler ||
        isSubmitting
    ) {
        return;
    }

    const form =
        modalBody.querySelector(
            "form"
        );

    if (form && !form.reportValidity()) {
        return;
    }

    isSubmitting = true;

    setSubmitState(false);

    try {
        await submitHandler();
        if (modal?.classList.contains("visible")) {
            isSubmitting = false;
            setSubmitState(true);
        }
    } catch (submitError) {
        console.error(
            "[Schulorganizer] Modal submit error:",
            submitError
        );
        notifyModalError(submitError);

        isSubmitting = false;

        setSubmitState(true);
    }
}

function notifyModalError(submitError) {
    const message = document.createElement("p");
    message.className = "modal-error-message";
    message.setAttribute("role", "alert");
    message.textContent = submitError instanceof Error && submitError.message.trim()
        ? submitError.message
        : "Die Änderung konnte nicht gespeichert werden. Bitte erneut versuchen.";
    modalBody.querySelector(".modal-error-message")?.remove();
    modalBody.prepend(message);
}


function setSubmitState(enabled) {
    if (!modalSubmit) {
        return;
    }

    modalSubmit.disabled =
        !enabled;

    modalCancel.disabled =
        !enabled;

    modalClose.disabled =
        !enabled;
}


/*
|--------------------------------------------------------------------------
| Modal events
|--------------------------------------------------------------------------
*/

modalClose?.addEventListener(
    "click",
    closeModal
);

modalCancel?.addEventListener(
    "click",
    closeModal
);

modalSubmit?.addEventListener(
    "click",
    submitModal
);


modal?.addEventListener(
    "click",
    event => {
        if (
            event.target === modal &&
            !isSubmitting
        ) {
            closeModal();
        }
    }
);


document.addEventListener(
    "keydown",
    event => {
        if (
            event.key === "Tab" &&
            modal?.classList.contains("visible")
        ) {
            const focusable = [
                ...modal.querySelectorAll(
                    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]"
                )
            ].filter(element =>
                element.tabIndex >= 0 &&
                element.offsetParent !== null
            );
            const first = focusable[0];
            const last = focusable.at(-1);

            if (
                event.shiftKey &&
                document.activeElement === first
            ) {
                event.preventDefault();
                last?.focus();
            } else if (
                !event.shiftKey &&
                document.activeElement === last
            ) {
                event.preventDefault();
                first?.focus();
            }

            return;
        }

        if (
            event.key === "Escape" &&
            modal?.classList.contains(
                "visible"
            ) &&
            !isSubmitting
        ) {
            closeModal();

            return;
        }

        if (
            event.key === "Enter" &&
            event.ctrlKey &&
            modal?.classList.contains(
                "visible"
            )
        ) {
            event.preventDefault();

            submitModal();
        }
    }
);


/*
|--------------------------------------------------------------------------
| Form helpers
|--------------------------------------------------------------------------
*/

export function createForm() {
    const form =
        document.createElement("form");

    form.className = "modal-form";

    form.addEventListener(
        "submit",
        event => {
            event.preventDefault();

            submitModal();
        }
    );

    return form;
}


export function createField({
    label,
    type = "text",
    placeholder = "",
    value = "",
    name = "",
    required = false,
    minLength,
    maxLength
}) {
    const wrapper =
        document.createElement("label");

    wrapper.className = "form-field";

    const labelText =
        document.createElement("span");

    labelText.textContent = label;

    if (required) {
        const marker = document.createElement("span");
        marker.textContent = " *";
        marker.setAttribute("aria-hidden", "true");
        labelText.appendChild(marker);
    }

    let input;

    if (type === "textarea") {
        input =
            document.createElement(
                "textarea"
            );

        input.rows = 5;
    } else {
        input =
            document.createElement(
                "input"
            );

        input.type = type;
    }

    input.name = name;

    input.placeholder =
        placeholder;

    input.value = value;

    input.required =
        required;
    if (required) {
        input.setAttribute("aria-required", "true");
    }

    if (
        minLength !== undefined
    ) {
        input.minLength =
            minLength;
    }

    if (
        maxLength !== undefined
    ) {
        input.maxLength =
            maxLength;
    }

    wrapper.append(
        labelText,
        input
    );

    return wrapper;
}


export function createSelect({
    label,
    name,
    options = [],
    value = "",
    required = false
}) {
    const wrapper =
        document.createElement("label");

    wrapper.className = "form-field";

    const labelText =
        document.createElement("span");

    labelText.textContent =
        label;

    const select =
        document.createElement("select");

    select.name = name;

    select.required =
        required;

    options.forEach(option => {
        const element =
            document.createElement(
                "option"
            );

        if (
            typeof option ===
            "string"
        ) {
            element.value =
                option;

            element.textContent =
                option;
        } else {
            element.value =
                option.value;

            element.textContent =
                option.label;
        }

        element.selected =
            element.value === value;

        select.appendChild(
            element
        );
    });

    wrapper.append(
        labelText,
        select
    );

    return wrapper;
}


export function createCheckbox({
    label,
    name = "",
    checked = false
}) {
    const wrapper =
        document.createElement("label");

    wrapper.className =
        "form-checkbox";

    const input =
        document.createElement(
            "input"
        );

    input.type = "checkbox";

    input.name = name;

    input.checked =
        checked;

    const text =
        document.createElement(
            "span"
        );

    text.textContent =
        label;

    wrapper.append(
        input,
        text
    );

    return wrapper;
}


export function getFieldValue(
    container,
    selector
) {
    const element =
        container.querySelector(
            selector
        );

    return element?.value?.trim() ?? "";
}