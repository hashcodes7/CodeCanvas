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
let nodeSymbols = {}; // nodeId -> symbol list
let nodes = [];
let draggingNode = null;
let nodeOffsetX = 0;
let nodeOffsetY = 0;

let edges = [];
let tempLine = null;
let linkingNode = null;
let linkingHandle = null;
let selectedNode = null;
let selectedEdge = null;

// Settings State
// Settings State
let canvasSettings = {
    pattern: 'plain',
    theme: 'none',
    syntaxTheme: 'default'
};

// Toolbar Elements
// Toolbar Elements
const edgeOptions = document.getElementById('edge-options');
const nodeOptions = document.getElementById('node-options');
const thicknessSlider = document.getElementById('edge-thickness');
const thicknessLabel = document.getElementById('thickness-label');
const unlinkBtn = document.getElementById('unlink-btn');

// Global Tools
const addTextBtn = document.getElementById('add-text-btn');

// Node Toolbar Elements
const nodeDuplicateBtn = document.getElementById('node-duplicate-btn');
const nodeUnlinkAllBtn = document.getElementById('node-unlink-all-btn');
const nodeDeleteBtnToolbar = document.getElementById('node-delete-btn-toolbar');

// Settings Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsMenu = document.getElementById('settings-menu');
const patternOpts = document.querySelectorAll('.pattern-opt');
const themeOpts = document.querySelectorAll('.theme-opt');

// Add Text Button Logic
addTextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = 'node-' + Date.now() + Math.random().toString(36).substr(2, 9);
    // Center of the view, adjusted for scale
    // canvas center (approx) relative to transform
    const rect = canvas.getBoundingClientRect();
    const cx = ((rect.width / 2) - params.x) / scale - 175; // -half node width
    const cy = ((rect.height / 2) - params.y) / scale - 150; // -half node height

    createNode(id, 'Text Block', 'Enter text...', cx, cy, null);
    postState();
});

function deleteEdge(edgeId) {
    const edgeIndex = edges.findIndex(e => e.id === edgeId);
    if (edgeIndex === -1) return;

    const el = document.getElementById(edgeId);
    if (el) el.remove();

    edges.splice(edgeIndex, 1);

    if (selectedEdge && selectedEdge.id === edgeId) {
        selectedEdge = null;
        edgeOptions.classList.add('hidden');
    }

    postState();
}

function deleteNode(nodeId) {
    const nodeIndex = nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) return;

    // Remove node element
    const node = result = document.getElementById(nodeId);
    if (node) node.remove();

    // Remove from array
    nodes.splice(nodeIndex, 1);

    // Remove connected edges
    edges = edges.filter(edge => {
        if (edge.from === nodeId || edge.to === nodeId) {
            const el = document.getElementById(edge.id);
            if (el) el.remove();
            return false;
        }
        return true;
    });

    if (selectedNode && selectedNode.id === nodeId) {
        selectedNode = null;
        nodeOptions.classList.add('hidden');
    }

    delete nodeSymbols[nodeId];

    postState();
}

// Global Keydown for Deletion
window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        // Do not delete if editing text/input
        const tag = document.activeElement.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || document.activeElement.isContentEditable) return;

        if (selectedNode) {
            deleteNode(selectedNode.id);
        } else if (selectedEdge) {
            deleteEdge(selectedEdge.id);
        }
    }
});

// Setup infinite canvas
canvas.addEventListener('mousedown', (e) => {
    // Deselect if clicking canvas
    if (e.target === canvas || e.target === content || e.target === svgLayer) {
        deselectEverything();
        isPanning = true;
        startX = e.clientX - params.x;
        startY = e.clientY - params.y;
        document.body.classList.add('grabbing');
    }
});

function deselectEverything() {
    if (selectedNode) {
        selectedNode.classList.remove('selected');
        selectedNode = null;
    }
    if (selectedEdge) {
        const path = document.getElementById(selectedEdge.id);
        if (path) path.classList.remove('selected');
        selectedEdge = null;
        edgeOptions.classList.add('hidden');
    }
    nodeOptions.classList.add('hidden');
}

function selectEdge(edgeId) {
    deselectEverything();
    selectedEdge = edges.find(e => e.id === edgeId);
    if (selectedEdge) {
        const path = document.getElementById(selectedEdge.id);
        if (path) path.classList.add('selected');

        thicknessSlider.value = selectedEdge.thickness || 1;
        thicknessLabel.innerText = `${thicknessSlider.value}px`;

        // Update active swatch
        document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        const activeSwatch = document.querySelector(`.swatch[data-color="${selectedEdge.color || 'default'}"]`);
        if (activeSwatch) activeSwatch.classList.add('active');

        edgeOptions.classList.remove('hidden');
    }
}

svgLayer.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'path' && e.target.id !== 'temp-line') {
        e.stopPropagation();
        selectEdge(e.target.id);
    }
});

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

function updateTransform() {
    content.style.transform = `translate(${params.x}px, ${params.y}px) scale(${scale})`;
}

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

// Logic for Nodes
function createNode(id, title, text, x, y, uri = null) {
    let node = document.getElementById(id);
    const isNew = !node;

    if (isNew) {
        node = document.createElement('div');
        node.className = 'node';
        node.id = id;

        // Determine language for display
        let langDisplay = 'Text';
        if (uri) {
            const ext = uri.split('.').pop();
            const titleMap = { 'ts': 'TypeScript', 'js': 'JavaScript', 'css': 'CSS', 'html': 'HTML' };
            langDisplay = titleMap[ext] || ext.toUpperCase();
        }

        node.innerHTML = `
            <div class="node-header">
                <span class="node-title">${title}</span>
                <span class="node-lang">${langDisplay}</span>
                <div class="delete-btn" title="Delete Node">×</div>
            </div>
            <div class="node-content-wrapper">
                <div class="editor-container">
                    <div class="line-numbers"></div>
                    <pre class="code-editor language-none" contenteditable="false" spellcheck="false"></pre>
                </div>
            </div>
            <div class="handle handle-left" data-handle-id="left"></div>
            <div class="handle handle-right" data-handle-id="right"></div>
        `;
        content.appendChild(node);
        nodes.push(node);

        const header = node.querySelector('.node-header');

        // Delete Button Logic
        const deleteBtn = node.querySelector('.delete-btn');
        deleteBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation(); // Prevent drag start
        });
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteNode(id);
        });

        // Header Drag + Selection Logic
        header.addEventListener('mousedown', (e) => {
            e.stopPropagation();

            // Select Node
            deselectEverything();
            selectedNode = node;
            node.classList.add('selected');
            nodeOptions.classList.remove('hidden');

            if (e.target.closest('.node-header')) {
                draggingNode = node;
                content.appendChild(node); // Bring to front

                const mouseX = (e.clientX - params.x) / scale;
                const mouseY = (e.clientY - params.y) / scale;
                const nodeX = parseFloat(node.style.left);
                const nodeY = parseFloat(node.style.top);

                nodeOffsetX = mouseX - nodeX;
                nodeOffsetY = mouseY - nodeY;
            }
        });

        // Restore logic for Border Handles
        node.querySelectorAll('.handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault(); // Prevent text selection
                const handleId = handle.dataset.handleId;
                startLinking(node, handleId, e);
            });
        });

        const editor = node.querySelector('.code-editor');

        editor.addEventListener('mousedown', e => {
            e.stopPropagation();
            deselectEverything();
            // Check if we clicked a handle
            if (e.target.hasAttribute('data-handle-id')) {
                e.preventDefault(); // Prevent text selection
                const handleId = e.target.getAttribute('data-handle-id');
                startLinking(node, handleId, e);
                return;
            }

            // If clicking empty area (not a handle) and NOT in edit mode, switch to edit mode
            if (editor.getAttribute('contenteditable') === 'false') {
                // Single click on empty area enables edit mode
                enableEditMode(editor);
            }
        });

        editor.addEventListener('dblclick', (e) => {
            enableEditMode(editor);
        });

        editor.addEventListener('blur', (e) => {
            disableEditMode(editor);
        });

        // Input handling with cursor preservation
        editor.addEventListener('input', (e) => {
            handleInput(node, editor);
        });

        // Prevent default enter behavior to avoid extra divs
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                document.execCommand('insertText', false, '    ');
            }
        });
    }

    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    if (uri) {
        node.dataset.uri = uri;
        const ext = uri.split('.').pop();
        const langMap = { 'ts': 'typescript', 'js': 'javascript', 'css': 'css', 'html': 'markup' };
        node.dataset.language = langMap[ext] || 'clike';
    } else {
        node.dataset.language = 'none';
    }

    node.querySelector('.node-title').innerText = title;

    const editor = node.querySelector('.code-editor');
    if (text !== undefined && text !== null) {
        if (editor.innerText !== text) {
            editor.innerText = text;
            updateNodeDisplay(node, text, false);
        }
    } else if (uri && isNew) {
        editor.innerText = 'Loading...';
    }

    return node;
}

function handleInput(node, editor) {
    let text = editor.innerText;
    // Fix: innerText often includes a trailing newline due to block formatting or <br>.
    // ensuring we don't accumulate newlines on every input.
    if (text.endsWith('\n')) {
        text = text.slice(0, -1);
    }
    const selection = saveSelection(editor);
    const uri = node.dataset.uri;

    updateNodeDisplay(node, text);
    restoreSelection(editor, selection);

    // Optimistic sync: Update ALL other nodes with the same URI
    if (uri) {
        document.querySelectorAll(`.node[data-uri="${CSS.escape(uri)}"]`).forEach(otherNode => {
            if (otherNode.id !== node.id) {
                const otherEditor = otherNode.querySelector('.code-editor');
                // Only update if not the one currently being typed in (redundant check but safe)
                if (otherEditor && document.activeElement !== otherEditor) {
                    otherEditor.innerText = text;
                    updateNodeDisplay(otherNode, text, true);
                }
            }
        });
    }

    if (uri) {
        debounce(() => {
            vscode.postMessage({
                command: 'saveFileContent',
                uri: uri,
                content: text
            });
        }, 500, uri + '-save')();
    }
    debounce(() => postState(), 1000, 'postState')();
}

// Cursor management
function saveSelection(containerEl) {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preSelectionRange = range.cloneRange();
        preSelectionRange.selectNodeContents(containerEl);
        preSelectionRange.setEnd(range.endContainer, range.endOffset);
        const start = preSelectionRange.toString().length;
        return {
            start: start - (range.toString().length),
            end: start
        };
    }
    return { start: 0, end: 0 };
}

function restoreSelection(containerEl, savedSel) {
    let charIndex = 0, range = document.createRange();
    range.setStart(containerEl, 0);
    range.collapse(true);
    let nodeStack = [containerEl], node, foundStart = false, stop = false;

    while (!stop && (node = nodeStack.pop())) {
        if (node.nodeType == 3) {
            const nextCharIndex = charIndex + node.length;
            if (!foundStart && savedSel.end >= charIndex && savedSel.end <= nextCharIndex) {
                range.setEnd(node, savedSel.end - charIndex);
                stop = true;
            }
            if (!foundStart && savedSel.start >= charIndex && savedSel.start <= nextCharIndex) {
                range.setStart(node, savedSel.start - charIndex);
                foundStart = true;
            }
            charIndex = nextCharIndex;
        } else {
            let i = node.childNodes.length;
            while (i--) {
                nodeStack.push(node.childNodes[i]);
            }
        }
    }

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function updateNodeDisplay(node, text, highlight = true) {
    if (text === undefined || text === null) text = '';
    const editor = node.querySelector('.code-editor');
    const lineNumbers = node.querySelector('.line-numbers');
    const lang = node.dataset.language || 'none';

    // update class for Prism
    editor.className = `code-editor language-${lang}`;

    if (window.Prism) { // Using standard Prism highlights string
        const grammar = Prism.languages[lang] || Prism.languages.plaintext;
        const highlighted = Prism.highlight(text, grammar, lang);
        editor.innerHTML = highlighted + '<br>'; // Trailing BR for editing at end

        // Update line numbers
        const lines = text.split('\n');
        lineNumbers.innerHTML = lines.map((_, i) => `<span>${i + 1}</span>`).join('');

        // After highlighting, activate handles
        if (nodeSymbols[node.id]) {
            activateSymbols(node, nodeSymbols[node.id]);
        }
        addGenericHandlesToCode(editor);
    } else {
        editor.innerText = text;
        const lines = text.split('\n');
        lineNumbers.innerHTML = lines.map((_, i) => `<span>${i + 1}</span>`).join('');
    }
}

function addGenericHandlesToCode(codeElement) {
    // Only wrap direct text nodes inside the code element (not already in a token span)
    const walker = document.createTreeWalker(codeElement, NodeFilter.SHOW_TEXT, null, false);
    let nodesToReplace = [];
    let node;
    while (node = walker.nextNode()) {
        if (node.parentElement === codeElement && node.textContent.trim()) {
            nodesToReplace.push(node);
        }
    }

    nodesToReplace.forEach(textNode => {
        const span = document.createElement('span');
        const content = textNode.textContent;
        span.innerHTML = content.split(/(\s+)/).map(part => {
            if (/\s+/.test(part)) return part;
            return `<span class="word-handle" data-handle-id="word-${part}-${Math.random().toString(36).substr(2, 5)}">${part}</span>`;
        }).join('');
        textNode.replaceWith(...span.childNodes);
    });
}

function getHandleCenter(node, handleId) {
    const handle = node.querySelector(`[data-handle-id="${handleId}"]`);
    if (!handle) return { x: 0, y: 0 };

    const hRect = handle.getBoundingClientRect();
    const cRect = content.getBoundingClientRect();

    return {
        x: (hRect.left + hRect.width / 2 - cRect.left) / scale,
        y: (hRect.top + hRect.height / 2 - cRect.top) / scale
    };
}

function createEdge(fromId, fromHandle, toId, toHandle) {
    if (fromId === toId && fromHandle === toHandle) return;
    const edge = {
        from: fromId,
        fromHandle: fromHandle,
        to: toId,
        toHandle: toHandle,
        id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    };
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

    const p1 = getHandleCenter(fromNode, edge.fromHandle);
    const p2 = getHandleCenter(toNode, edge.toHandle);

    const path = document.getElementById(edge.id);
    if (path) {
        const x1 = p1.x;
        const y1 = p1.y;
        const x2 = p2.x;
        const y2 = p2.y;

        const c1x = x1 + (x2 - x1) / 2;
        const c1y = y1;
        const c2x = x2 - (x2 - x1) / 2;
        const c2y = y2;
        path.setAttribute('d', `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`);

        // Apply thickness
        const thickness = edge.thickness || 1;
        path.style.strokeWidth = thickness + 'px';

        // Apply color
        if (edge.color && edge.color !== 'default') {
            path.style.stroke = edge.color;
        } else {
            path.style.stroke = ''; // Reset to default CSS stroke
        }
    }
}

// Toolbar Interactions
document.querySelectorAll('.swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
        if (selectedEdge) {
            const color = swatch.dataset.color;
            selectedEdge.color = color;

            document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');

            updateEdge(selectedEdge);
            postState();
        }
    });
});

function duplicateNode(nodeId) {
    const original = nodes.find(n => n.id === nodeId);
    if (!original) return;

    const id = 'node-' + Date.now() + Math.random().toString(36).substr(2, 9);
    const title = original.querySelector('.node-title').innerText;
    const text = original.querySelector('.code-editor').innerText;
    const uri = original.dataset.uri;
    const x = parseFloat(original.style.left) + 40;
    const y = parseFloat(original.style.top) + 40;

    createNode(id, title, text, x, y, uri);
    if (uri) vscode.postMessage({ command: 'requestSymbols', uri: uri, nodeId: id });

    // Select the new node
    const newNode = document.getElementById(id);
    if (newNode) {
        deselectEverything();
        selectedNode = newNode;
        newNode.classList.add('selected');
        nodeOptions.classList.remove('hidden');
    }

    postState();
}

function unlinkNodeLinks(nodeId) {
    edges = edges.filter(edge => {
        if (edge.from === nodeId || edge.to === nodeId) {
            const el = document.getElementById(edge.id);
            if (el) el.remove();
            return false;
        }
        return true;
    });
    postState();
}

nodeDuplicateBtn.addEventListener('click', () => {
    if (selectedNode) duplicateNode(selectedNode.id);
});

nodeUnlinkAllBtn.addEventListener('click', () => {
    if (selectedNode) unlinkNodeLinks(selectedNode.id);
});

nodeDeleteBtnToolbar.addEventListener('click', () => {
    if (selectedNode) deleteNode(selectedNode.id);
});

thicknessSlider.addEventListener('input', (e) => {
    if (selectedEdge) {
        selectedEdge.thickness = parseFloat(e.target.value);
        thicknessLabel.innerText = `${selectedEdge.thickness}px`;
        updateEdge(selectedEdge);
    }
});

thicknessSlider.addEventListener('change', () => {
    postState();
});

unlinkBtn.addEventListener('click', () => {
    if (selectedEdge) {
        deleteEdge(selectedEdge.id);
    }
});

function updateConnections() {
    edges.forEach(updateEdge);
}

window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        params.x = e.clientX - startX;
        params.y = e.clientY - startY;
        updateTransform();
    } else if (draggingNode) {
        const mouseX = (e.clientX - params.x) / scale;
        const mouseY = (e.clientY - params.y) / scale;
        draggingNode.style.left = `${mouseX - nodeOffsetX}px`;
        draggingNode.style.top = `${mouseY - nodeOffsetY}px`;
        updateConnections();
    } else if (linkingNode && tempLine) {
        const mouseX = (e.clientX - params.x) / scale;
        const mouseY = (e.clientY - params.y) / scale;
        const p1 = getHandleCenter(linkingNode, linkingHandle);

        const x1 = p1.x;
        const y1 = p1.y;
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
    if (isPanning) {
        isPanning = false;
        document.body.classList.remove('grabbing');
        postState();
    } else if (draggingNode) {
        draggingNode = null;
        postState();
    } else if (linkingNode && tempLine) {
        const targetHandle = e.target.closest('[data-handle-id]');
        if (targetHandle) {
            const targetNode = targetHandle.closest('.node');
            const targetHandleId = targetHandle.dataset.handleId;
            if (targetNode && (targetNode !== linkingNode || targetHandleId !== linkingHandle)) {
                createEdge(linkingNode.id, linkingHandle, targetNode.id, targetHandleId);
                postState();
            }
        }
        tempLine.remove();
        tempLine = null;
        linkingNode = null;
        linkingHandle = null;
        document.body.classList.remove('linking-active');
    }
});

document.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('[data-handle-id]');
    if (handle) {
        e.stopPropagation();
        e.preventDefault();
        const node = handle.closest('.node');
        const handleId = handle.dataset.handleId;
        startLinking(node, handleId, e);
    }
});

document.addEventListener('dragover', e => e.preventDefault());
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
    }
});

function getState() {
    return {
        version: 3,
        params,
        scale,
        nodes: nodes.map(n => ({
            id: n.id,
            title: n.querySelector('.node-title').innerText,
            uri: n.dataset.uri,
            text: n.querySelector('.code-editor').innerText, // FIXED: removed .value check
            x: parseFloat(n.style.left),
            y: parseFloat(n.style.top)
        })),
        edges,
        settings: canvasSettings
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
                vscode.postMessage({ command: 'requestNodeContent', uri: n.uri, nodeId: n.id });
                vscode.postMessage({ command: 'requestSymbols', uri: n.uri, nodeId: n.id });
                document.getElementById(n.id).dataset.loaded = 'true';
            }
        });
    }

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

    if (state.settings) {
        canvasSettings = state.settings;
        applyPattern(canvasSettings.pattern);
        applyTheme(canvasSettings.theme);
        applySyntaxTheme(canvasSettings.syntaxTheme);
    }
}

function postState() {
    const state = getState();
    const stateString = JSON.stringify(state);
    if (stateString === lastStateString) return;
    lastStateString = stateString;
    vscode.postMessage({ command: 'updateState', value: state });
}

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'addNode':
            const id = 'node-' + Date.now() + Math.random().toString(36).substr(2, 9);
            createNode(id, message.fileName, message.content, message.x, message.y, message.uri);
            document.getElementById(id).dataset.loaded = 'true';
            if (message.uri) vscode.postMessage({ command: 'requestSymbols', uri: message.uri, nodeId: id });
            postState();
            break;
        case 'updateNodeContent':
            const n = document.getElementById(message.nodeId);
            if (n) {
                const editor = n.querySelector('.code-editor');
                if (document.activeElement !== editor) {
                    editor.innerText = message.content;
                    updateNodeDisplay(n, message.content, true);
                    n.dataset.loaded = 'true';
                }
            }
            break;
        case 'updateSymbols':
            nodeSymbols[message.nodeId] = message.symbols;
            const node = document.getElementById(message.nodeId);
            if (node) activateSymbols(node, message.symbols);
            break;
        case 'fileChanged':
            // Backend reports a file change (could be from another editor tab or this extension saving)
            const changedUri = message.uri;
            const newContent = message.content;
            document.querySelectorAll(`.node[data-uri="${CSS.escape(changedUri)}"]`).forEach(n => {
                const editor = n.querySelector('.code-editor');
                // Only update if we are NOT the one typing (avoid overwriting cursor)
                if (document.activeElement !== editor) {
                    if (editor.innerText !== newContent) {
                        editor.innerText = newContent;
                        updateNodeDisplay(n, newContent, true);
                    }
                }
            });
            break;
        case 'setValue':
            if (!message.value) { restoreStateFixed({}); return; }
            try { restoreStateFixed(JSON.parse(message.value)); } catch (e) { }
            break;
    }
});

function activateSymbols(node, symbols) {
    const editor = node.querySelector('.code-editor');
    // Broaden search to ALL tokens to make every colored word a handle
    const tokens = editor.querySelectorAll('.token');

    tokens.forEach((token, index) => {
        const name = token.innerText.trim();
        if (!name) return;

        // EXCLUSION LIST:
        // Text/Tokens matching specifically these characters (or combinations of them) will NOT be handles.
        // User List: ()[]{}:;,./|\ and space, plus natural punctuation !?"'
        if (/^[\(\)\[\]\{\}:;,.\/\|\s\\!?"']+$/.test(name)) return;

        // Use stable deterministic handle ID based on token index
        const symbol = (symbols || []).find(s => s.name === name);
        if (symbol) {
            token.dataset.handleId = `token-${symbol.name}-${index}`;
        } else {
            // Generic token handle
            if (!token.dataset.handleId) {
                token.dataset.handleId = `token-any-${name}-${index}`;
            }
        }
    });
}

function addGenericHandlesToCode(codeElement) {
    const walker = document.createTreeWalker(codeElement, NodeFilter.SHOW_TEXT, null, false);
    let nodesToReplace = [];
    let node;
    while (node = walker.nextNode()) {
        if (!node.parentElement.closest('[data-handle-id]') && node.textContent.trim()) {
            nodesToReplace.push(node);
        }
    }

    // Unified Tokenizer Regex:
    // Group 1: URLs
    // Group 2: Separators (Whitespace + Structural + Natural Punctuation)
    // Group 3: Words (Alphanumeric and others)
    const tokenRegex = /(https?:\/\/[^\s\(\)\[\]\{\}:;,"'<>]+)|([\(\)\[\]\{\}:;,.\/\|\s\\!?"']+)|([^\(\)\[\]\{\}:;,.\/\|\s\\!?"']+)/gi;

    nodesToReplace.forEach((textNode, textNodeIndex) => {
        const content = textNode.textContent;
        const container = document.createElement('span');
        let html = '';

        let match;
        tokenRegex.lastIndex = 0;
        let tokenIndex = 0;

        while ((match = tokenRegex.exec(content)) !== null) {
            const [full, url, sep, word] = match;
            if (url) {
                html += `<span class="word-handle" data-handle-id="url-${textNodeIndex}-${tokenIndex}">${url}</span>`;
            } else if (sep) {
                html += sep;
            } else if (word) {
                html += `<span class="word-handle" data-handle-id="word-${word}-${textNodeIndex}-${tokenIndex}">${word}</span>`;
            }
            tokenIndex++;
        }

        if (html) {
            container.innerHTML = html;
            textNode.replaceWith(...container.childNodes);
        }
    });
}

function enableEditMode(editor) {
    if (editor.getAttribute('contenteditable') !== 'plaintext-only') {
        editor.setAttribute('contenteditable', 'plaintext-only');
        editor.focus();
    }
}

function disableEditMode(editor) {
    if (editor.getAttribute('contenteditable') !== 'false') {
        editor.setAttribute('contenteditable', 'false');
    }
}

function startLinking(node, handleId, event) {
    linkingNode = node;
    linkingHandle = handleId;
    document.body.classList.add('linking-active');

    tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempLine.setAttribute('class', 'temp-connection');
    tempLine.setAttribute('stroke', 'var(--vscode-textLink-activeForeground)');
    tempLine.setAttribute('stroke-width', '2');
    tempLine.setAttribute('fill', 'none');
    tempLine.style.pointerEvents = 'none';
    tempLine.style.strokeDasharray = '5,5';
    svgLayer.appendChild(tempLine);

    // Initial draw
    const mouseX = (event.clientX - params.x) / scale;
    const mouseY = (event.clientY - params.y) / scale;
    const p1 = getHandleCenter(node, handleId);

    tempLine.setAttribute('d', `M ${p1.x} ${p1.y} L ${mouseX} ${mouseY}`);
}

// Settings Logic
function applyPattern(pattern) {
    canvasSettings.pattern = pattern;
    document.body.classList.remove('pattern-plain', 'pattern-dotted', 'pattern-grid', 'pattern-criss-cross');
    if (pattern !== 'plain') {
        document.body.classList.add(`pattern-${pattern}`);
    }
    patternOpts.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.pattern === pattern);
    });
}

function applyTheme(theme) {
    canvasSettings.theme = theme;
    document.body.classList.remove('light-mode', 'dark-mode');
    if (theme && theme !== 'none') {
        document.body.classList.add(`${theme}-mode`);
    }
    themeOpts.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.theme === theme);
    });
}

settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
    if (!settingsContainer.contains(e.target)) {
        settingsMenu.classList.add('hidden');
    }
});

patternOpts.forEach(opt => {
    opt.addEventListener('click', () => {
        applyPattern(opt.dataset.pattern);
        postState();
    });
});

themeOpts.forEach(opt => {
    opt.addEventListener('click', () => {
        applyTheme(opt.dataset.theme);
        postState();
    });
});

const settingsContainer = document.querySelector('.settings-container');
const syntaxThemeSelect = document.getElementById('syntax-theme-select');

function applySyntaxTheme(theme) {
    if (!theme) theme = 'default';
    canvasSettings.syntaxTheme = theme;

    // Switch the stylesheet href
    const themeLink = document.getElementById('prism-theme-style');
    const newHref = window.prismThemes[theme] || window.prismThemes['default'];

    if (themeLink && newHref && themeLink.getAttribute('href') !== newHref) {
        themeLink.setAttribute('href', newHref);
    }

    if (syntaxThemeSelect) {
        syntaxThemeSelect.value = theme;
    }
}

syntaxThemeSelect.addEventListener('change', (e) => {
    applySyntaxTheme(e.target.value);
    postState();
});
