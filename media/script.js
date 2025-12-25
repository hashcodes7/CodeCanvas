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

// Setup infinite canvas
canvas.addEventListener('mousedown', (e) => {
    if (e.target === canvas || e.target === content) {
        isPanning = true;
        startX = e.clientX - params.x;
        startY = e.clientY - params.y;
        document.body.classList.add('grabbing');
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
        node.innerHTML = `
            <div class="node-header">${title}</div>
            <div class="node-content-wrapper">
                <div class="editor-container">
                    <pre class="code-editor language-none" contenteditable="false" spellcheck="false"></pre>
                </div>
            </div>
            <div class="handle handle-left" data-handle-id="left"></div>
            <div class="handle handle-right" data-handle-id="right"></div>
        `;
        content.appendChild(node);
        nodes.push(node);

        const header = node.querySelector('.node-header');
        header.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (e.target.closest('.node-header')) {
                draggingNode = node;
                content.appendChild(node);

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

    node.querySelector('.node-header').innerText = title;

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
    const text = editor.innerText;
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
    const editor = node.querySelector('.code-editor');
    const lang = node.dataset.language || 'none';

    // update class for Prism
    editor.className = `code-editor language-${lang}`;

    if (window.Prism) { // Using standard Prism highlights string
        const grammar = Prism.languages[lang] || Prism.languages.plaintext;
        const highlighted = Prism.highlight(text, grammar, lang);
        editor.innerHTML = highlighted + '<br>'; // Trailing BR for editing at end

        // After highlighting, activate handles
        if (nodeSymbols[node.id]) {
            activateSymbols(node, nodeSymbols[node.id]);
        }
        addGenericHandlesToCode(editor);
    } else {
        editor.innerText = text;
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
    }
}

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
    }
});

document.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('[data-handle-id]');
    if (handle) {
        e.stopPropagation();
        const node = handle.closest('.node');
        linkingNode = node;
        linkingHandle = handle.dataset.handleId;

        tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tempLine.setAttribute('stroke', 'var(--vscode-textLink-activeForeground)');
        tempLine.setAttribute('stroke-width', '2');
        tempLine.setAttribute('fill', 'none');
        tempLine.style.strokeDasharray = '5,5';
        svgLayer.appendChild(tempLine);
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
            title: n.querySelector('.node-header').innerText,
            uri: n.dataset.uri,
            text: n.querySelector('.code-editor').innerText, // FIXED: removed .value check
            x: parseFloat(n.style.left),
            y: parseFloat(n.style.top)
        })),
        edges
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

    tokens.forEach(token => {
        const name = token.innerText.trim();
        if (!name) return;

        // IGNORE LIST: spaces already trimmed. Ignore structural punctuation.
        // Allowing keywords, numbers, strings (including quotes), operators like +, -, =, etc.
        if (/^[\{\}\(\)\[\]\.,;]+$/.test(name)) return;

        // Check if it's a known symbol from VS Code (for better semantic IDs if possible)
        const symbol = (symbols || []).find(s => s.name === name);
        if (symbol) {
            token.dataset.handleId = `token-${symbol.name}-${Math.random().toString(36).substr(2, 5)}`;
        } else {
            // Generic token handle
            if (!token.dataset.handleId) {
                token.dataset.handleId = `token-any-${name}-${Math.random().toString(36).substr(2, 5)}`;
            }
        }
    });
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
        // Split by whitespace AND structural punctuation to isolate words
        // Keeping the separators in the result to reconstruct text
        span.innerHTML = content.split(/([\{\}\(\)\[\]\.,;\s]+)/).map(part => {
            // If part is pure whitespace or purely ignored punctuation, just return text
            if (/^[\{\}\(\)\[\]\.,;\s]+$/.test(part)) return part;
            // Otherwise it's a word/number/string-part -> Make Handle
            if (!part.trim()) return part; // Safety
            return `<span class="word-handle" data-handle-id="word-${part}-${Math.random().toString(36).substr(2, 5)}">${part}</span>`;
        }).join('');
        textNode.replaceWith(...span.childNodes);
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

    tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempLine.setAttribute('class', 'temp-connection');
    tempLine.setAttribute('stroke', '#007acc');
    tempLine.setAttribute('stroke-width', '2');
    tempLine.setAttribute('fill', 'none');
    svgLayer.appendChild(tempLine);

    // Initial draw
    const mouseX = (event.clientX - params.x) / scale;
    const mouseY = (event.clientY - params.y) / scale;
    const p1 = getHandleCenter(node, handleId);

    // Just a straight line or point initially
    tempLine.setAttribute('d', `M ${p1.x} ${p1.y} L ${mouseX} ${mouseY}`);
}
