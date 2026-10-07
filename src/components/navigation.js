const navigationButtons =
    document.querySelectorAll(".nav-item");

const pages = {
    dashboard: {
        title: "Übersicht",
        description:
            "Deine schulischen Inhalte – lokal auf diesem Gerät gespeichert."
    },

    tasks: {
        title: "Aufgaben",
        description:
            "Verwalte deine schulischen Aufgaben."
    },

    presentations: {
        title: "Präsentationen",
        description:
            "Plane Referate und verwalte Präsentationen mit allen Projektdateien."
    },

    notes: {
        title: "Notizen",
        description:
            "Speichere wichtige Informationen."
    },

    files: {
        title: "Dateien",
        description:
            "Verwalte deine schulischen Dateien."
    },

    subjects: {
        title: "Fächer",
        description:
            "Organisiere deine Inhalte nach Fach."
    }
};

let currentPage = "dashboard";

const pageTitle =
    document.querySelector("#pageTitle");

const pageDescription =
    document.querySelector("#pageDescription");

export function getCurrentPage() {
    return currentPage;
}

export function navigateTo(pageName, { replaceHistory = false } = {}) {
    if (!pages[pageName]) {
        return;
    }

    currentPage = pageName;

    pageTitle.textContent =
        pages[pageName].title;

    pageDescription.textContent =
        pages[pageName].description;

    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active-page");
    });

    const target =
        document.querySelector(`#${pageName}Page`);

    target?.classList.add("active-page");

    navigationButtons.forEach(button => {
        const isCurrent = button.dataset.page === pageName;
        button.classList.toggle("active", isCurrent);
        if (isCurrent) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });

    const targetUrl = `${window.location.pathname}${window.location.search}#${pageName}`;
    if (replaceHistory) {
        window.history.replaceState({ page: pageName }, "", targetUrl);
    } else if (window.location.hash !== `#${pageName}`) {
        window.history.pushState({ page: pageName }, "", targetUrl);
    }

    window.dispatchEvent(
        new CustomEvent("pagechange", {
            detail: {
                page: pageName
            }
        })
    );
}

window.addEventListener("popstate", () => {
    const pageName = window.location.hash.slice(1);
    navigateTo(pages[pageName] ? pageName : "dashboard", {
        replaceHistory: true
    });
});

navigationButtons.forEach(button => {
    button.addEventListener("click", () => {
        navigateTo(button.dataset.page);
    });
});