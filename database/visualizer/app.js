/** 
 * POSTGRESQL B-TREE VISUALIZER ENGINE
 */

const MAX_ITEMS = 4; // To trigger splits early

class PageNode {
    constructor(id, isLeaf = true, isMeta = false) {
        this.id = id;
        this.isLeaf = isLeaf;
        this.isMeta = isMeta;
        this.items = []; // {id, data, ctid} for Leaf; {key, pageId, rightPageId} for Internal
        this.parent = null;
        this.nextPage = null; // B-tree link
    }
}

class PostgresTree {
    constructor() {
        // Page 0: Meta Page (Postgres standard)
        this.metaPage = new PageNode(0, false, true);
        this.metaPage.rootId = 1;
        
        // Page 1: Initial Root
        this.root = new PageNode(1, true);
        this.pages = [this.metaPage, this.root];
        this.nextPageId = 2;
    }

    insert(id, data) {
        this.log(`[BACKEND] Executing: INSERT INTO users VALUES (${id}, '${data}')`, 'system-msg');
        this.log(`[INDEX] Searching B-Tree for insertion point for Key: ${id}...`);

        let leaf = this.findLeaf(this.root, id);
        
        if (leaf.items.some(k => k.id === id)) {
            this.log(`[ERROR] Duplicate Key ${id} violation.`, 'error-msg');
            return;
        }

        // Simulate CTID (Heap Pointer)
        let block = Math.floor(Math.random() * 100);
        let offset = Math.floor(Math.random() * 50) + 1;
        let ctid = `(${block},${offset})`;

        leaf.items.push({ id, data, ctid });
        leaf.items.sort((a,b) => a.id - b.id);

        this.log(`[INDEX] Inserted Key ${id} into Page #${leaf.id} with Heap Pointer ${ctid}`);

        if (leaf.items.length > MAX_ITEMS) {
            this.log(`[INDEX] Page #${leaf.id} is full. Triggering SPLIT_LEAF...`, 'warning-msg');
            this.split(leaf);
        }
    }

    findLeaf(node, id) {
        if (node.isLeaf) return node;
        for (let i = 0; i < node.items.length; i++) {
            if (id < node.items[i].key) {
                return this.findLeaf(this.findPageById(node.items[i].pageId), id);
            }
        }
        return this.findLeaf(this.findPageById(node.items[node.items.length-1].rightPageId), id);
    }

    split(node) {
        let mid = Math.floor(node.items.length / 2);
        let newNode = new PageNode(this.nextPageId++, node.isLeaf);
        
        let moveItems = node.items.splice(mid);
        newNode.items = moveItems;
        this.pages.push(newNode);

        const splitKey = newNode.items[0].id || newNode.items[0].key;
        this.promote(node, splitKey, newNode);
    }

    promote(node, key, newNode) {
        if (node === this.root) {
            let newRoot = new PageNode(this.nextPageId++, false);
            newRoot.items.push({ key: key, pageId: node.id, rightPageId: newNode.id });
            this.root = newRoot;
            this.pages.push(newRoot);
            this.metaPage.rootId = newRoot.id; // Update Meta Page
            node.parent = newRoot;
            newNode.parent = newRoot;
            this.log(`[INDEX] Tree height increased. New Root is Page #${newRoot.id}. Meta Page updated.`);
        } else {
            let parent = node.parent;
            parent.items.push({ key: key, pageId: node.id, rightPageId: newNode.id });
            parent.items.sort((a,b) => a.key - b.key);
            newNode.parent = parent;
            if (parent.items.length > MAX_ITEMS) this.split(parent);
        }
    }

    findPageById(id) { return this.pages.find(p => p.id === id); }

    log(msg, className = '') {
        const console = document.getElementById('logConsole');
        const p = document.createElement('p');
        p.className = 'log-entry ' + className;
        p.textContent = msg;
        console.appendChild(p);
        console.scrollTop = console.scrollHeight;
    }
}

// UI LOGIC
const tree = new PostgresTree();
let selectedId = null;

function render() {
    document.getElementById('totalPages').textContent = tree.pages.length;
    document.getElementById('rootAt').textContent = tree.root.id;

    const treeContainer = document.getElementById('treeContainer');
    treeContainer.innerHTML = '';
    
    // Render Meta Page first
    renderMetaPage(treeContainer);
    // Render Logical Tree
    renderNode(tree.root, treeContainer);

    // Render Physical Pages
    const pageContainer = document.getElementById('pageContainer');
    pageContainer.innerHTML = '';
    tree.pages.forEach(p => {
        if (p.isMeta) return;
        pageContainer.appendChild(createPhysicalPage(p));
    });

    if (selectedId !== null) updateInspector();
}

function renderMetaPage(container) {
    const div = document.createElement('div');
    div.className = 'node meta ' + (selectedId === 0 ? 'selected' : '');
    div.innerHTML = `<div class="node-title">Page #0 (META PAGE)</div><div class="node-content">ROOT_PTR: #${tree.metaPage.rootId}</div>`;
    div.onclick = () => { selectedId = 0; render(); };
    container.appendChild(div);
}

function renderNode(node, container) {
    const div = document.createElement('div');
    div.className = `node ${node.isLeaf ? 'leaf' : ''} ${selectedId === node.id ? 'selected' : ''}`;
    div.innerHTML = `<div class="node-title">#${node.id} (${node.isLeaf ? 'Leaf' : 'Int'})</div>
                     <div class="node-content">[${node.items.map(i => i.id || i.key).join(' | ')}]</div>`;
    
    div.onclick = (e) => { e.stopPropagation(); selectedId = node.id; render(); };
    container.appendChild(div);

    if (!node.isLeaf) {
        const levelDiv = document.createElement('div');
        levelDiv.className = 'tree-level';
        container.appendChild(levelDiv);
        let cids = [...new Set(node.items.map(i => [i.pageId, i.rightPageId]).flat())];
        cids.forEach(cid => {
            let child = tree.findPageById(cid);
            if (child) renderNode(child, levelDiv);
        });
    }
}

function createPhysicalPage(page) {
    const box = document.createElement('div');
    box.className = 'page-box ' + (selectedId === page.id ? 'selected' : '');
    
    box.innerHTML = `
        <div class="pg-header">Page #${page.id} - ${page.isLeaf ? 'Leaf' : 'Internal'}</div>
        <div class="pg-body">
            <div class="pg-line-pointers">
                ${page.items.map((_, i) => `<div class="pointer-item">off:${i}</div>`).join('')}
            </div>
            <div class="pg-free-space">FREE SPACE GAP</div>
            <div class="pg-data-tuples">
                ${page.items.map(item => `
                    <div class="tuple-item">
                        K:${item.id || item.key} ➞ ${item.ctid || 'Ptr'}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    box.onclick = () => { selectedId = page.id; render(); };
    return box;
}

function updateInspector() {
    const inspector = document.getElementById('pageInspector');
    const details = document.getElementById('inspectDetails');
    const page = tree.findPageById(selectedId);
    
    if (!page) return;
    inspector.classList.remove('hidden');
    document.getElementById('inspectingId').textContent = page.id;

    let html = `<div class="inspect-card"><h3>Header</h3><p>Page ID: ${page.id}</p><p>Type: ${page.isMeta ? 'META' : (page.isLeaf ? 'LEAF' : 'INTERNAL')}</p></div>`;
    
    if (page.isMeta) {
        html += `<div class="inspect-card"><h3>Index Info</h3><p>Magic: 0x053421</p><p>Root Page: #${page.rootId}</p></div>`;
    } else {
        html += page.items.map(item => `
            <div class="inspect-card">
                <h3>${page.isLeaf ? 'Index Tuple' : 'Downlink'}</h3>
                <p>Key: ${item.id || item.key}</p>
                <p>${page.isLeaf ? 'CTID (Heap Pointer): ' + item.ctid : 'Internal Downlink: #' + (item.pageId || item.rightPageId)}</p>
            </div>
        `).join('');
    }
    details.innerHTML = html;
}

document.getElementById('insertBtn').addEventListener('click', () => {
    const id = parseInt(document.getElementById('userId').value);
    const data = document.getElementById('payload').value || "Data";
    if (isNaN(id)) return;
    tree.insert(id, data);
    selectedId = id; // Try to focus
    render();
    document.getElementById('userId').value = id + 5; // Skip items to split faster
});

render();
