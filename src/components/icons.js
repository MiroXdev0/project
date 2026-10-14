const drawings = {
    overview: [
        ["path", { d: "m3 10 9-7 9 7" }],
        ["path", { d: "M5 9v12h14V9M9 21v-7h6v7" }]
    ],
    task: [
        ["rect", { x: "4", y: "4", width: "16", height: "17", rx: "2" }],
        ["path", { d: "M8 9h8M8 13h3m2 3 1.5 1.5L19 14" }]
    ],
    presentation: [
        ["rect", { x: "3", y: "4", width: "18", height: "13", rx: "2" }],
        ["path", { d: "M12 17v4m-4 0h8M7 8h10M7 12h6" }]
    ],
    note: [
        ["path", { d: "M7 3h8l5 5v13H7zM15 3v6h5" }],
        ["path", { d: "M10 13h7m-7 4h7" }]
    ],
    file: [
        ["path", { d: "M3 7h7l2 2h9v11H3z" }],
        ["path", { d: "M3 7V5h7l2 2" }]
    ],
    subjects: [
        ["rect", { x: "3", y: "3", width: "7", height: "7", rx: "2" }],
        ["rect", { x: "14", y: "3", width: "7", height: "7", rx: "2" }],
        ["rect", { x: "3", y: "14", width: "7", height: "7", rx: "2" }],
        ["rect", { x: "14", y: "14", width: "7", height: "7", rx: "2" }]
    ],
    plus: [
        ["path", { d: "M12 5v14M5 12h14" }]
    ],
    edit: [
        ["path", { d: "m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z" }]
    ],
    delete: [
        ["path", { d: "M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" }]
    ],
    open: [
        ["path", { d: "M13 5h6v6m0-6-9 9" }],
        ["path", { d: "M18 13v6H5V6h6" }]
    ],
    download: [
        ["path", { d: "M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" }]
    ],
    info: [
        ["circle", { cx: "12", cy: "12", r: "9" }],
        ["path", { d: "M12 11v5m0-8h.01" }]
    ],
    remove: [
        ["circle", { cx: "12", cy: "12", r: "9" }],
        ["path", { d: "m9 9 6 6m0-6-6 6" }]
    ],
    previous: [
        ["path", { d: "m15 18-6-6 6-6" }]
    ],
    next: [
        ["path", { d: "m9 18 6-6-6-6" }]
    ],
    fullscreen: [
        ["path", { d: "M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" }]
    ],
    upload: [
        ["path", { d: "M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" }]
    ],
    link: [
        ["path", { d: "M10 13a5 5 0 0 0 7.1 0l2-2A5 5 0 0 0 12 3.9l-1.1 1.1" }],
        ["path", { d: "M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" }]
    ]
};

export function createIcon(name, className = "ui-icon") {
    const shapes = drawings[name];
    if (!shapes) return null;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    for (const [tag, attributes] of shapes) {
        const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [attribute, value] of Object.entries(attributes)) {
            shape.setAttribute(attribute, value);
        }
        svg.appendChild(shape);
    }

    return svg;
}
