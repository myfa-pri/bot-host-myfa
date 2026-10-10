import re

with open('public/index.html', 'r') as f:
    html = f.read()

# 1. Add d-miniapp tab content
miniapp_html = """
        <div id="d-miniapp" class="dash-tab">
            <div class="card" style="background:rgba(0,242,234,.05);border-color:rgba(0,242,234,.2);padding:15px;margin-bottom:15px;display:flex;align-items:center;justify-content:space-between;">
                <div>
                    <div style="font-weight:700;color:var(--primary);margin-bottom:4px;">MiniApp Link</div>
                    <div id="miniappLinkDisplay" style="font-size:12px;color:var(--text-gray);font-family:monospace;word-break:break-all;">Loading...</div>
                </div>
                <button class="btn btn-outline btn-sm" onclick="copyMiniappLink()" style="flex-shrink:0;height:auto;padding:8px 12px;"><i class="fas fa-copy"></i> Copy</button>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <h3 style="margin:0;"><i class="fas fa-layer-group" style="color:var(--text-gray);margin-right:6px;"></i> MiniApp Files</h3>
                <span style="font-size:12px;color:var(--text-gray);">Only HTML, CSS, JS supported</span>
            </div>

            <div id="miniappFileListContainer"></div>

            <!-- Float Add Button -->
            <div style="position:fixed;bottom:80px;right:20px;width:55px;height:55px;background:var(--gradient);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 5px 15px rgba(0,242,234,.4);cursor:pointer;z-index:2500;" onclick="openCreateMiniappFile()">
                <i class="fas fa-plus" style="color:#000;font-size:20px;"></i>
            </div>
        </div>
"""
html = html.replace('<div id="d-env" class="dash-tab">', miniapp_html + '\n        <div id="d-env" class="dash-tab">')

# 2. Add dash-nav item
nav_item_html = """        <div class="d-nav-item" onclick="switchDash('miniapp',this)"><i class="fas fa-mobile-alt"></i>MiniApp</div>
"""
html = html.replace('<div class="d-nav-item" onclick="switchDash(\'env\',this)"><i class="fas fa-lock"></i>Env</div>',
                    nav_item_html + '        <div class="d-nav-item" onclick="switchDash(\'env\',this)"><i class="fas fa-lock"></i>Env</div>')

# 3. Add Slide-up menu
slide_menu_html = """
<!-- Create MiniApp File Menu -->
<div id="createMiniappFileOverlay" class="fullscreen-overlay" style="z-index:3600;background:rgba(5,5,17,.8);backdrop-filter:blur(5px);justify-content:flex-end;">
    <div style="background:var(--card-bg);border-top-left-radius:20px;border-top-right-radius:20px;padding:25px;border-top:1px solid var(--border);animation:slideUp .3s ease-out;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="margin:0;"><i class="fas fa-file-code" style="color:var(--primary);margin-right:8px;"></i> New File</h3>
            <i class="fas fa-times" style="font-size:20px;color:var(--text-gray);cursor:pointer;" onclick="closeCreateMiniappFile()"></i>
        </div>

        <label style="color:var(--text-gray);font-size:12px;margin-bottom:6px;display:block;">File Name (without extension)</label>
        <input id="maFileName" class="input-box" placeholder="e.g. index, style, app">

        <label style="color:var(--text-gray);font-size:12px;margin-bottom:6px;display:block;">File Format</label>
        <select id="maFileType" class="input-box" style="appearance:auto;">
            <option value="html">HTML Document (.html)</option>
            <option value="css">Stylesheet (.css)</option>
            <option value="js">JavaScript (.js)</option>
        </select>

        <button class="btn btn-primary" style="margin-top:10px;" onclick="doCreateMiniappFile()">Create File</button>
    </div>
</div>
"""
html = html.replace('</body>', slide_menu_html + '\n</body>')

cmd_miniapp_btn = """
            <div style="margin-bottom:15px;">
                <button class="btn btn-outline" style="width:100%;height:45px;" onclick="switchDash('miniapp', document.querySelectorAll('.d-nav-item')[2])">
                    <i class="fas fa-mobile-alt"></i> I want MiniApp
                </button>
            </div>
"""
html = html.replace('<div style="position:relative;margin-bottom:15px;"><i class="fas fa-search" style="position:absolute;left:15px;top:15px;color:var(--text-gray);"></i><input class="input-box" style="padding-left:45px;margin-bottom:0;" placeholder="Search..." oninput="filterCmds(this.value)"></div>',
                    cmd_miniapp_btn + '\n            <div style="position:relative;margin-bottom:15px;"><i class="fas fa-search" style="position:absolute;left:15px;top:15px;color:var(--text-gray);"></i><input class="input-box" style="padding-left:45px;margin-bottom:0;" placeholder="Search..." oninput="filterCmds(this.value)"></div>')


# Add css mode and select option
script_css_mode = '<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/css/css.min.js"></script>'
html = html.replace('<script src="/lib/cm-htmlmixed.js"></script>', '<script src="/lib/cm-htmlmixed.js"></script>\n    ' + script_css_mode)
html = html.replace('<option value="html">HTML Page</option>', '<option value="html">HTML Page</option>\n            <option value="css">CSS</option>')


# Modify switchDash
js_switchDash_old = "if (tab === 'commands') loadCommands();"
js_switchDash_new = """if (tab === 'commands') loadCommands();
    if (tab === 'miniapp') loadMiniappFiles();"""
html = html.replace(js_switchDash_old, js_switchDash_new)

miniapp_functions = """
/* ── MINIAPP FILE MANAGER ── */
let miniappFilesCache = {};
let currentMiniappLink = '';
let currentMiniappEditFile = null;

async function loadMiniappFiles() {
    if (!currentBot) return;
    const c = document.getElementById('miniappFileListContainer');
    if(c) c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-gray);">Loading files...</div>';

    try {
        const linkRes = await fetch('/api/miniapp/get-link', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({botId: currentBot.id, userId})
        }).then(r=>r.json());

        if (linkRes.success) {
            const host = window.location.origin;
            currentMiniappLink = `${host}/miniapp/${linkRes.linkId}`;
            const linkDisplay = document.getElementById('miniappLinkDisplay');
            if(linkDisplay) linkDisplay.innerText = currentMiniappLink;
        }

        const files = await fetch(`/api/miniapp/files?botId=${currentBot.id}&userId=${userId}`).then(r=>r.json());
        miniappFilesCache = files;
        renderMiniappFiles();
    } catch(e) {
        if(c) c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--secondary);">Failed to load files</div>';
    }
}

function copyMiniappLink() {
    if (!currentMiniappLink) return;
    navigator.clipboard.writeText(currentMiniappLink);
    showToast('MiniApp link copied!');
}

function renderMiniappFiles() {
    const c = document.getElementById('miniappFileListContainer');
    if(!c) return;
    c.innerHTML = '';
    const vals = Object.values(miniappFilesCache);

    if (!vals.length) {
        c.innerHTML = '<div style="text-align:center;color:var(--text-gray);padding:30px;">No files yet.<br>Click + below to add index.html, style.css, or app.js</div>';
        return;
    }

    vals.sort((a, b) => b.lastUpdated - a.lastUpdated).forEach(file => {
        let iconHtml = '';
        let iconColor = '';
        if (file.type === 'html') { iconHtml = 'fa-html5'; iconColor = '#e34f26'; }
        else if (file.type === 'css') { iconHtml = 'fa-css3-alt'; iconColor = '#264de4'; }
        else if (file.type === 'js') { iconHtml = 'fa-js'; iconColor = '#f7df1e'; }

        const dateStr = new Date(file.lastUpdated).toLocaleString();

        const el = document.createElement('div');
        el.className = 'card';
        el.style.cssText = 'padding:15px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;cursor:pointer;';
        el.onclick = (e) => {
            if(e.target.closest('i')) return; // ignore clicks on action icons
            openMiniappEditor(file.name);
        };

        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:15px;">
                <div style="font-size:24px;color:${iconColor};width:30px;text-align:center;">
                    <i class="fab ${iconHtml}"></i>
                </div>
                <div>
                    <div style="font-weight:700;font-size:15px;">${file.name}</div>
                    <div style="font-size:11px;color:var(--text-gray);margin-top:2px;">Last updated: ${dateStr}</div>
                </div>
            </div>
            <div style="display:flex;gap:15px;padding-left:10px;">
                <i class="fas fa-pen" style="color:var(--text-gray);" onclick="openMiniappEditor('${file.name}')" title="Edit"></i>
                <i class="fas fa-trash" style="color:var(--secondary);" onclick="deleteMiniappFile('${file.name}')" title="Delete"></i>
            </div>
        `;
        c.appendChild(el);
    });
}

function openCreateMiniappFile() {
    document.getElementById('maFileName').value = '';
    document.getElementById('maFileType').value = 'html';
    document.getElementById('createMiniappFileOverlay').classList.add('open');
}

function closeCreateMiniappFile() {
    document.getElementById('createMiniappFileOverlay').classList.remove('open');
}

function doCreateMiniappFile() {
    let name = document.getElementById('maFileName').value.trim();
    const type = document.getElementById('maFileType').value;

    if (!name) return showToast('Filename required');

    // Auto-append extension if missing
    if (!name.endsWith(`.${type}`)) {
        name += `.${type}`;
    }

    // Check if exists
    const safeName = name.replace(/\\./g, '_');
    if (miniappFilesCache[safeName]) return showToast('File already exists');

    closeCreateMiniappFile();

    // Provide default template
    let defaultContent = '';
    if (type === 'html' && name === 'index.html') {
        defaultContent = `<!DOCTYPE html>\\n<html lang="en">\\n<head>\\n    <meta charset="UTF-8">\\n    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">\\n    <title>MiniApp</title>\\n    <!-- Telegram WebApp Script is auto-injected by MyFa Host here -->\\n    <link rel="stylesheet" href="style.css">\\n</head>\\n<body>\\n    <h1>Welcome to MiniApp</h1>\\n    <button id="mainBtn">Get Data</button>\\n    <script src="app.js"></script>\\n</body>\\n</html>`;
    } else if (type === 'css') {
        defaultContent = `body {\\n    background-color: var(--tg-theme-bg-color, #ffffff);\\n    color: var(--tg-theme-text-color, #000000);\\n    font-family: sans-serif;\\n    padding: 20px;\\n}`;
    } else if (type === 'js') {
        defaultContent = `// window.MiniAppAPI is available for backend communication\\n// Telegram WebApp is available at window.Telegram.WebApp\\n\\ndocument.addEventListener('DOMContentLoaded', () => {\\n    window.Telegram?.WebApp?.ready();\\n    \\n    document.getElementById('mainBtn')?.addEventListener('click', async () => {\\n        if (!window.MiniAppAPI) return alert('API not available');\\n        // Example: await window.MiniAppAPI.getData('score');\\n        alert('Button clicked');\\n    });\\n});`;
    }

    currentMiniappEditFile = {
        name: name,
        type: type,
        content: defaultContent,
        isNew: true
    };

    openMiniappEditorUI();
}

function deleteMiniappFile(name) {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    fetch('/api/miniapp/delete-file', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({botId: currentBot.id, userId, fileName: name})
    }).then(r=>r.json()).then(res => {
        if(res.success) {
            miniappFilesCache = res.files;
            renderMiniappFiles();
            showToast('File deleted');
        } else showToast('Delete failed');
    });
}
/* ── MINIAPP EDITOR INTEGRATION ── */
let isMiniappEditorMode = false;
let miniappOriginalContent = '';

function openMiniappEditor(name) {
    const safeName = name.replace(/\\./g, '_');
    const fileData = miniappFilesCache[safeName];
    if (!fileData) return;

    currentMiniappEditFile = {...fileData, isNew: false};
    openMiniappEditorUI();
}

function openMiniappEditorUI() {
    isMiniappEditorMode = true;

    // Hide standard command settings
    document.getElementById('editMain').style.display = 'flex';
    document.getElementById('editSettings').style.display = 'none';
    document.querySelector('.editor-toolbar').style.display = 'flex';

    // Disable command specific fields and buttons for miniapp mode
    document.getElementById('edCmdName').parentElement.style.display = 'none';
    document.getElementById('editorTitle').innerText = 'Editing ' + currentMiniappEditFile.name;

    // Map extension to mode
    const type = currentMiniappEditFile.type;
    let cmMode = 'javascript';
    let langVal = 'javascript';
    if (type === 'html') { cmMode = 'htmlmixed'; langVal = 'html'; }
    if (type === 'css') { cmMode = 'css'; langVal = 'css'; }

    // Force lang select drop down but keep it disabled or hidden if you want. We'll just set it.
    document.getElementById('edLangSelect').value = langVal;

    document.getElementById('editorPanel').style.display = 'flex';

    setTimeout(() => {
        if (!codeEditor) {
            codeEditor = CodeMirror(document.getElementById('cmEditor'), {
                mode: cmMode, theme: 'dracula',
                lineNumbers: true, autoCloseBrackets: true, matchBrackets: true,
                extraKeys: { 'Ctrl-Space': 'autocomplete' }, lineWrapping: true,
                value: ""
            });
            codeEditor.setSize('100%', '100%');
            codeEditor.on('change', () => {
                if(autoSaveTimer) clearTimeout(autoSaveTimer);
                if(isAutoSave) autoSaveTimer = setTimeout(() => saveMiniappFile(true), 2000);
            });
        }

        // ensure we have css mode loaded dynamically if needed (we rely on htmlmixed parsing css usually or fallback)
        codeEditor.setOption('mode', cmMode);

        miniappOriginalContent = currentMiniappEditFile.content || '';
        codeEditor.setValue(miniappOriginalContent);
        codeEditor.clearHistory();

        const b = document.getElementById('editorStatusBadge');
        if (type === 'html') { b.className = 'tag tag-html'; b.innerText = 'HTML'; }
        else if (type === 'css') { b.className = 'tag'; b.style.backgroundColor = 'rgba(38, 77, 228, 0.2)'; b.style.color = '#264de4'; b.innerText = 'CSS'; }
        else { b.className = 'tag tag-js'; b.innerText = 'JS'; }

        const prevBtn = document.getElementById('htmlPreviewBtn');
        if (type === 'html') {
            prevBtn.classList.add('visible');
            // override standard preview
            prevBtn.onclick = () => {
                 if (currentMiniappLink) {
                      window.open(currentMiniappLink, '_blank');
                 } else {
                     showToast('Link not generated yet');
                 }
            };
        } else {
            prevBtn.classList.remove('visible');
        }
    }, 100);
}

function saveMiniappFile(silent = false) {
    if (!currentMiniappEditFile) return;
    const code = codeEditor ? codeEditor.getValue() : '';

    const fileObj = {
        name: currentMiniappEditFile.name,
        type: currentMiniappEditFile.type,
        content: code
    };

    if(!silent) showToast('Saving...');

    fetch('/api/miniapp/file', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({botId: currentBot.id, userId, file: fileObj})
    }).then(r=>r.json()).then(res => {
        if(res.success) {
            miniappFilesCache = res.files;
            miniappOriginalContent = code;
            currentMiniappEditFile.isNew = false;
            renderMiniappFiles();
            if(!silent) showToast('Saved!');
        } else {
            if(!silent) showToast('Save failed!');
        }
    }).catch(() => {
        if(!silent) showToast('Network Error - Save failed!');
    });
}
"""

html = html.replace('/* ── SHARE BOTS ── */', miniapp_functions + '\n\n/* ── SHARE BOTS ── */')

# Hook closeEditor for unsaved changes
js_closeEditor_old = """function closeEditor() {
    if (codeEditor) {"""
js_closeEditor_new = """function closeEditor() {
    if (isMiniappEditorMode) {
        if (codeEditor && codeEditor.getValue() !== miniappOriginalContent) {
            if (!confirm('You have unsaved changes. Discard them?')) return;
        }
        isMiniappEditorMode = false;
        currentMiniappEditFile = null;
        document.getElementById('edCmdName').parentElement.style.display = 'block'; // restore
        document.getElementById('editorPanel').style.display = 'none';

        // restore preview btn onclick to default
        document.getElementById('htmlPreviewBtn').onclick = previewHtmlPage;
        return;
    }

    if (codeEditor) {"""
html = html.replace(js_closeEditor_old, js_closeEditor_new)

# Hook save logic to save btn
js_saveCommand_old = "function saveCommand(silent = false) {"
js_saveCommand_new = """function saveCommand(silent = false) {
    if (isMiniappEditorMode) return saveMiniappFile(silent);
"""

html = html.replace(js_saveCommand_old, js_saveCommand_new)

with open('public/index.html', 'w') as f:
    f.write(html)
