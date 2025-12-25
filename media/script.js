const vscode = acquireVsCodeApi();

const canvas = document.getElementById('canvas-container');
const content = document.getElementById('canvas-content');
const svgLayer = document.getElementById('connections-layer');

let scale = 1;
let params = { x: 0, y: 0 };
let isPanning = false;
let startX = 0;
let startY = 0;

let lastStateString = '';

// Setup infinite canvas
canvas.addEventListener('mousedown', (e) => {
    if (e.target === canvas || e.target === content) {
        isPanning = true;
        startX = e.clientX - params.x;
        startY = e.clientY - params.y;
        document.body.classList.add('grabbing');
    }
});

window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        params.x = e.clientX - startX;
        params.y = e.clientY - startY;
        updateTransform();
    }
});

window.addEventListener('mouseup', () => {
    if (isPanning) {
        isPanning = false;
        document.body.classList.remove('grabbing');
        postState();
    }
});

canvas.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
        const xs = (e.clientX - params.x) / scale;
        const ys = (e.clientY - params.y) / scale;
        const delta = -e.deltaY;

        (delta > 0) ? (scale *= 1.1) : (scale /= 1.1);

        params.x = e.clientX - xs * scale;
        params.y = e.clientY - ys * scale;

        updateTransform();
    } else {
        e.preventDefault();
        params.x -= e.deltaX;
        params.y -= e.deltaY;
        updateTransform();
        postState();
    }
});

function updateTransform() {
    content.style.transform = `translate(${params.x}px, ${params.y}px) scale(${scale})`;
}

// Logic for Nodes
let nodes = [];
let draggingNode = null;
let nodeOffsetX = 0;
let nodeOffsetY = 0;

function createNode(id, title, text, x, y, uri = null) {
    let node = document.getElementById(id);
    const isNew = !node;

    if (isNew) {
        node = document.createElement('div');
        node.className = 'node';
        node.id = id;
        node.innerHTML = `
            <div class="node-header"></div>
            <div class="node-content-wrapper">
                 <textarea class="node-body" spellcheck="false"></textarea>
            </div>
            <div class="handle handle-in" data-type="in"></div>
            <div class="handle handle-out" data-type="out"></div>
        `;
        content.appendChild(node);
        nodes.push(node);

        const header = node.querySelector('.node-header');
        header.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            draggingNode = node;
            // Bring to front
            content.appendChild(node);

            const mouseX = (e.clientX - params.x) / scale;
            const mouseY = (e.clientY - params.y) / scale;
            const nodeX = parseFloat(node.style.left);
            const nodeY = parseFloat(node.style.top);

            nodeOffsetX = mouseX - nodeX;
            nodeOffsetY = mouseY - nodeY;
        });

        const textarea = node.querySelector('textarea');
        textarea.addEventListener('mousedown', e => e.stopPropagation());
        textarea.addEventListener('input', () => {
            if (node.dataset.uri) {
                debounce(() => {
                    vscode.postMessage({
                        command: 'saveFileContent',
                        uri: node.dataset.uri,
                        content: textarea.value
                    });
                }, 500, node.id + '-save')();
            }
            debounce(() => postState(), 1000, 'postState')();
        });
    }

    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    if (uri) node.dataset.uri = uri;
    node.querySelector('.node-header').innerText = title;

    const textarea = node.querySelector('textarea');
    if (text !== undefined && text !== null) {
        if (textarea.value !== text) {
            textarea.value = text;
        }
    } else if (uri && isNew) {
        textarea.value = 'Loading...';
    }

    return node;
}

const timeouts = {};
function debounce(fn, delay, key) {
    return function () {
        if (timeouts[key]) clearTimeout(timeouts[key]);
        timeouts[key] = setTimeout(() => {
            fn();
            delete timeouts[key];
        }, delay);
    };
}

// Global Mouse Move for Node Dragging
window.addEventListener('mousemove', (e) => {
    if (draggingNode) {
        const mouseX = (e.clientX - params.x) / scale;
        const mouseY = (e.clientY - params.y) / scale;

        draggingNode.style.left = `${mouseX - nodeOffsetX}px`;
        draggingNode.style.top = `${mouseY - nodeOffsetY}px`;

        updateConnections();
    }
});

window.addEventListener('mouseup', () => {
    if (draggingNode) {
        draggingNode = null;
        postState();
    }
});

// Linking Logic
let edges = [];
let tempLine = null;
let linkingNode = null;

function createEdge(fromId, toId) {
    if (fromId === toId) return;
    if (edges.find(e => e.from === fromId && e.to === toId)) return;

    const edge = { from: fromId, to: toId, id: `edge-${Date.now()}` };
    edges.push(edge);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.id = edge.id;
    svgLayer.appendChild(path);
    updateEdge(edge);
}

function updateEdge(edge) {
    const fromNode = document.getElementById(edge.from);
    const toNode = document.getElementById(edge.to);
    if (!fromNode || !toNode) return;

    const x1 = parseFloat(fromNode.style.left) + fromNode.offsetWidth;
    const y1 = parseFloat(fromNode.style.top) + fromNode.offsetHeight / 2;
    const x2 = parseFloat(toNode.style.left);
    const y2 = parseFloat(toNode.style.top) + toNode.offsetHeight / 2;

    const path = document.getElementById(edge.id);
    if (path) {
        const c1x = x1 + (x2 - x1) / 2;
        const c1y = y1;
        const c2x = x2 - (x2 - x1) / 2;
        const c2y = y2;
        path.setAttribute('d', `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`);
    }
}

function updateConnections() {
    edges.forEach(updateEdge);
}

document.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('handle-out')) {
        e.stopPropagation();
        const node = e.target.closest('.node');
        linkingNode = node;

        tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tempLine.style.stroke = 'var(--vscode-textLink-activeForeground)';
        tempLine.style.strokeDasharray = '5,5';
        svgLayer.appendChild(tempLine);
    }
});

window.addEventListener('mousemove', (e) => {
    if (linkingNode && tempLine) {
        const mouseX = (e.clientX - params.x) / scale;
        const mouseY = (e.clientY - params.y) / scale;

        const fromX = parseFloat(linkingNode.style.left) + linkingNode.offsetWidth;
        const fromY = parseFloat(linkingNode.style.top) + linkingNode.offsetHeight / 2;

        const x1 = fromX;
        const y1 = fromY;
        const x2 = mouseX;
        const y2 = mouseY;

        const c1x = x1 + (x2 - x1) / 2;
        const c1y = y1;
        const c2x = x2 - (x2 - x1) / 2;
        const c2y = y2;

        tempLine.setAttribute('d', `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`);
    }
});

window.addEventListener('mouseup', (e) => {
    if (linkingNode && tempLine) {
        if (e.target.classList.contains('handle-in')) {
            const targetNode = e.target.closest('.node');
            if (targetNode && targetNode !== linkingNode) {
                createEdge(linkingNode.id, targetNode.id);
                postState();
            }
        }

        tempLine.remove();
        tempLine = null;
        linkingNode = null;
    }
});

document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    const uriList = e.dataTransfer.getData('text/uri-list');
    if (uriList) {
        const uris = uriList.split('\r\n').filter(u => u);
        uris.forEach(uri => {
            vscode.postMessage({
                command: 'requestFileContent',
                uri: uri,
                x: (e.clientX - params.x) / scale,
                y: (e.clientY - params.y) / scale
            });
        });
        return;
    }

    vscode.postMessage({
        command: 'alert',
        text: 'Please drop files from the VS Code Explorer.'
    });
});

function getState() {
    const nodesData = nodes.map(node => {
        return {
            id: node.id,
            title: node.querySelector('.node-header').innerText,
            uri: node.dataset.uri,
            text: node.dataset.uri ? null : node.querySelector('textarea').value,
            x: parseFloat(node.style.left),
            y: parseFloat(node.style.top)
        };
    });

    return {
        version: 1,
        params: { ...params },
        scale: scale,
        nodes: nodesData,
        edges: edges
    };
}

function restoreStateFixed(state) {
    if (!state) return;
    const stateString = JSON.stringify(state);
    if (stateString === lastStateString) return;
    lastStateString = stateString;

    if (state.params) params = state.params;
    if (state.scale) scale = state.scale;
    updateTransform();

    // Remove nodes that are no longer in state
    const stateNodeIds = new Set((state.nodes || []).map(n => n.id));
    nodes = nodes.filter(node => {
        if (!stateNodeIds.has(node.id)) {
            node.remove();
            return false;
        }
        return true;
    });

    if (state.nodes) {
        state.nodes.forEach(n => {
            createNode(n.id, n.title, n.text, n.x, n.y, n.uri);
            if (n.uri && !document.getElementById(n.id).dataset.loaded) {
                vscode.postMessage({
                    command: 'requestNodeContent',
                    uri: n.uri,
                    nodeId: n.id
                });
            }
        });
    }

    // Update edges
    document.querySelectorAll('path:not([style*="stroke-dasharray"])').forEach(p => p.remove());
    edges = [];
    if (state.edges) {
        state.edges.forEach(e => {
            edges.push(e);
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.id = e.id;
            svgLayer.appendChild(path);
            updateEdge(e);
        });
    }
}

function postState() {
    const state = getState();
    const stateString = JSON.stringify(state);
    if (stateString === lastStateString) return;
    lastStateString = stateString;
    vscode.postMessage({
        command: 'updateState',
        value: state
    });
}

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'addNode':
            const { fileName, content, x, y, uri } = message;
            const id = 'node-' + Date.now() + Math.random().toString(36).substr(2, 9);
            createNode(id, fileName, content, x, y, uri);
            const node = document.getElementById(id);
            if (uri) node.dataset.loaded = 'true';
            postState();
            break;
        case 'updateNodeContent':
            const { nodeId, content: newContent } = message;
            const n = document.getElementById(nodeId);
            if (n) {
                const textarea = n.querySelector('textarea');
                if (textarea.value !== newContent) {
                    textarea.value = newContent;
                }
                n.dataset.loaded = 'true';
            }
            break;
        case 'setValue':
            if (!message.value) {
                restoreStateFixed({});
                return;
            }
            try {
                const state = JSON.parse(message.value);
                restoreStateFixed(state);
            } catch (e) {
                console.error('Failed to parse state:', e);
            }
            break;
    }
});
