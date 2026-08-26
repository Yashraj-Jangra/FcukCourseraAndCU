function setRunningUIState(isRunning) {
    document.getElementById('startBtn').disabled = isRunning;
    document.getElementById('readBtn').disabled = isRunning;
    document.getElementById('quizBtn').disabled = isRunning;
    const onScreenBtn = document.getElementById('quizOnScreenBtn');
    if (onScreenBtn) onScreenBtn.disabled = isRunning;
    document.getElementById('completeBtn').disabled = isRunning;
    
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
        stopBtn.style.display = isRunning ? 'block' : 'none';
    }

    const statusDot = document.getElementById('statusDot');
    if (statusDot) {
        if (isRunning) statusDot.classList.add('busy');
        else statusDot.classList.remove('busy');
    }

    if (isRunning) {
        document.getElementById('progressContainer').style.display = 'block';
    }
}

const providerSelect = document.getElementById('providerSelect');
const apiKeyInput = document.getElementById('apiKey');
const modelGroup = document.getElementById('modelGroup');
const modelInput = document.getElementById('modelInput');
const endpointGroup = document.getElementById('endpointGroup');
const endpointInput = document.getElementById('endpointInput');
const logContainer = document.getElementById('log');

function updateProviderUI(provider) {
    if (provider === 'openrouter') {
        apiKeyInput.placeholder = "OpenRouter API Key (sk-or-v1-...)";
        modelGroup.style.display = 'block';
        if (!modelInput.value) modelInput.value = "meta-llama/llama-3.3-70b-instruct:free";
        modelInput.placeholder = "meta-llama/llama-3.3-70b-instruct:free";
        endpointGroup.style.display = 'none';
    } else if (provider === 'groq') {
        apiKeyInput.placeholder = "Groq API Key (gsk_...)";
        modelGroup.style.display = 'block';
        if (!modelInput.value) modelInput.value = "llama-3.3-70b-versatile";
        modelInput.placeholder = "llama-3.3-70b-versatile";
        endpointGroup.style.display = 'none';
    } else if (provider === 'custom') {
        apiKeyInput.placeholder = "Custom API Key / Bearer (optional)";
        modelGroup.style.display = 'block';
        modelInput.placeholder = "e.g. gpt-4o-mini, llama3, deepseek-chat";
        endpointGroup.style.display = 'block';
        if (!endpointInput.value) endpointInput.value = "http://localhost:11434/v1/chat/completions";
        endpointInput.placeholder = "http://localhost:11434/v1/chat/completions";
    } else {
        // Gemini
        apiKeyInput.placeholder = "Gemini API Key (AIzaSy...)";
        modelGroup.style.display = 'none';
        endpointGroup.style.display = 'none';
    }
}

providerSelect.addEventListener('change', () => {
    updateProviderUI(providerSelect.value);
    saveSettings();
});

function saveSettings() {
    chrome.storage.local.set({
        aiProvider: providerSelect.value,
        aiApiKey: apiKeyInput.value.trim(),
        aiModel: modelInput.value.trim(),
        aiEndpoint: endpointInput.value.trim(),
        geminiApiKey: apiKeyInput.value.trim()
    });
}

apiKeyInput.addEventListener('input', saveSettings);
modelInput.addEventListener('input', saveSettings);
endpointInput.addEventListener('input', saveSettings);

// Load saved settings & summary report
chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiEndpoint', 'geminiApiKey', 'latestSummaryReport'], (result) => {
    if (result.aiProvider) {
        providerSelect.value = result.aiProvider;
    }
    if (result.aiApiKey || result.geminiApiKey) {
        apiKeyInput.value = result.aiApiKey || result.geminiApiKey;
    }
    if (result.aiModel) {
        modelInput.value = result.aiModel;
    }
    if (result.aiEndpoint) {
        endpointInput.value = result.aiEndpoint;
    }
    updateProviderUI(providerSelect.value);

    if (result.latestSummaryReport) {
        renderSummaryReport(result.latestSummaryReport);
    }
});

function getAIConfig() {
    const provider = providerSelect.value;
    const key = apiKeyInput.value.trim();
    const model = modelInput.value.trim();
    let endpoint = endpointInput.value.trim();

    if (provider === 'openrouter') {
        endpoint = "https://openrouter.ai/api/v1/chat/completions";
    } else if (provider === 'groq') {
        endpoint = "https://api.groq.com/openai/v1/chat/completions";
    }

    return {
        provider: provider,
        apiKey: key,
        model: model,
        endpoint: endpoint
    };
}

// Log Renderer with Color Coding
function createLogElement(logItem) {
    let text = "";
    let type = "info";
    let timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    if (typeof logItem === 'object' && logItem !== null) {
        text = logItem.text || "";
        type = logItem.type || "info";
        if (logItem.timestamp) timestamp = logItem.timestamp;
    } else {
        text = String(logItem || "");
        const lower = text.toLowerCase();
        if (lower.includes('error') || lower.includes('failed') || lower.includes('failure') || lower.includes('could not')) {
            type = 'error';
        } else if (lower.includes('completed') || lower.includes('success') || lower.includes('matched option') || lower.includes('saved') || lower.includes('posted') || lower.includes('done!')) {
            type = 'success';
        } else if (lower.includes('cooling down') || lower.includes('warning') || lower.includes('rate limit') || lower.includes('retrying') || lower.includes('fallback') || lower.includes('skipping')) {
            type = 'warning';
        } else if (lower.includes('asking') || lower.includes('response:') || lower.includes('discovered')) {
            type = 'ai';
        }
    }

    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.innerText = timestamp;

    const textSpan = document.createElement('span');
    textSpan.className = 'log-text';
    textSpan.innerText = text;

    entry.appendChild(timeSpan);
    entry.appendChild(textSpan);
    return entry;
}

function appendLog(logItem) {
    const el = createLogElement(logItem);
    logContainer.appendChild(el);
    if (logContainer.children.length > 250) {
        logContainer.removeChild(logContainer.firstChild);
    }
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Toolbar: Copy & Clear Logs
document.getElementById('copyLogBtn').addEventListener('click', () => {
    const rawLines = Array.from(logContainer.querySelectorAll('.log-entry')).map(el => {
        const t = el.querySelector('.log-time')?.innerText || '';
        const txt = el.querySelector('.log-text')?.innerText || '';
        return `[${t}] ${txt}`;
    }).join('\n');

    if (!rawLines) return;

    navigator.clipboard.writeText(rawLines).then(() => {
        const btn = document.getElementById('copyLogBtn');
        const oldText = btn.innerText;
        btn.innerText = "✓ Copied";
        setTimeout(() => { btn.innerText = oldText; }, 1500);
    });
});

document.getElementById('clearLogBtn').addEventListener('click', () => {
    logContainer.innerHTML = '';
});

// Summary Report Modal Handler
const reportModal = document.getElementById('reportModal');
const reportBody = document.getElementById('reportBody');
const copyReportBtn = document.getElementById('copyReportBtn');

document.getElementById('openReportBtn').addEventListener('click', () => {
    reportModal.style.display = 'block';
});

document.getElementById('closeReportBtn').addEventListener('click', () => {
    reportModal.style.display = 'none';
});

let currentRawReportText = "";

function renderSummaryReport(data) {
    if (!data) return;

    const courseTitle = data.courseTitle || 'Course Summary';
    const percent = data.percent || 0;
    const totalItems = data.totalItems || 0;
    const completedItems = data.completedItems || 0;
    const modules = data.modules || [];
    const categories = data.categories || null;
    const remainingItems = data.remainingItems || [];
    const manualAttentionItems = data.manualAttentionItems || [];

    let html = `
        <div class="report-card">
            <div class="report-header">
                <div>
                    <div style="font-size: 13px; font-weight: 700; color: #ffffff;">${courseTitle}</div>
                    <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">Completed ${completedItems} of ${totalItems} items</div>
                </div>
                <div class="report-percent">${percent}%</div>
            </div>
            <div style="background: #334155; border-radius: 9999px; height: 6px; overflow: hidden; margin-top: 8px;">
                <div style="background: linear-gradient(90deg, #3b82f6, #10b981); height: 100%; width: ${percent}%;"></div>
            </div>
        </div>

        <div class="report-card">
            <div style="font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">📁 Modules Coverage</div>
    `;

    (modules || []).forEach((m, idx) => {
        const isDone = m.completedCount >= m.totalCount;
        const badgeClass = isDone ? 'badge-done' : 'badge-progress';
        const badgeText = isDone ? '100% DONE' : `${m.percent}% (${m.completedCount}/${m.totalCount})`;

        html += `
            <div class="module-row">
                <span style="color: #cbd5e1; max-width: 240px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500;">
                    ${idx + 1}. ${m.moduleName}
                </span>
                <span class="report-badge ${badgeClass}">${badgeText}</span>
            </div>
        `;
    });

    html += `</div>`;

    if (manualAttentionItems && manualAttentionItems.length > 0) {
        html += `
            <div class="report-card" style="border-left: 3px solid #ef4444; background: rgba(239, 68, 68, 0.08);">
                <div style="font-size: 11px; font-weight: 700; color: #f87171; margin-bottom: 4px;">⚠️ Attention Required (${manualAttentionItems.length})</div>
                <div style="font-size: 9px; color: #fca5a5; margin-bottom: 8px; line-height: 1.4;">
                    The following items are locked or require manual submission before final graded assessments can unlock:
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
        `;
        manualAttentionItems.forEach(item => {
            html += `
                <div style="font-size: 9px; background: rgba(0, 0, 0, 0.35); padding: 6px; border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.25);">
                    <div style="font-weight: 700; color: #ffffff;">• [${item.moduleName || 'Module'}] ${item.name}</div>
                    <div style="color: #cbd5e1; margin: 2px 0;">Reason: ${item.reason}</div>
                    <a href="${item.itemUrl}" target="_blank" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">🔗 Open in Coursera →</a>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    if (categories) {
        html += `
            <div class="report-card">
                <div style="font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">📋 Category Summary</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 10px; color: #cbd5e1;">
                    <div>🎬 Videos: <b>${categories.videos || 0}</b></div>
                    <div>📖 Readings: <b>${categories.readings || 0}</b></div>
                    <div>💬 Discussions: <b>${categories.discussions || 0}</b></div>
                    <div>🎭 Dialogues: <b>${categories.dialogues || 0}</b></div>
                    <div>🧪 Labs & Apps: <b>${categories.labs || 0}</b></div>
                    <div>📝 Quizzes: <b>${categories.quizzes || 0}</b></div>
                    <div>🎯 Graded: <b>${categories.graded || 0}</b></div>
                </div>
            </div>
        `;
    }

    if (remainingItems && remainingItems.length > 0) {
        html += `
            <div class="report-card" style="border-left: 3px solid #f59e0b;">
                <div style="font-size: 10px; font-weight: 700; color: #fde047; margin-bottom: 6px;">⏳ Remaining Items (${remainingItems.length})</div>
                <div style="font-size: 9px; color: #94a3b8; line-height: 1.5;">
        `;
        remainingItems.slice(0, 8).forEach(item => {
            html += `<div>• [${item.moduleName || 'Module'}] <b>${item.name}</b> (${item.typeName || 'item'})</div>`;
        });
        if (remainingItems.length > 8) {
            html += `<div style="font-style: italic; margin-top: 4px; color: #64748b;">+ ${remainingItems.length - 8} more items</div>`;
        }
        html += `</div></div>`;
    } else {
        html += `
            <div class="report-card" style="border-left: 3px solid #22c55e; text-align: center; color: #86efac; font-size: 11px; font-weight: 700;">
                🎉 All modules and items are fully completed!
            </div>
        `;
    }

    reportBody.innerHTML = html;
    copyReportBtn.style.display = 'block';

    currentRawReportText = `=== COURSE COMPLETION REPORT ===\nCourse: ${courseTitle}\nProgress: ${percent}% (${completedItems}/${totalItems})\n\nMODULES:\n` +
        (modules || []).map(m => `- ${m.moduleName}: ${m.percent}% (${m.completedCount}/${m.totalCount})`).join('\n') +
        (manualAttentionItems && manualAttentionItems.length > 0 ? `\n\n⚠️ MANUAL ATTENTION REQUIRED (${manualAttentionItems.length}):\n` + manualAttentionItems.map(m => `- [${m.moduleName}] ${m.name}: ${m.reason}\n  Link: ${m.itemUrl}`).join('\n') : '') +
        `\n\nREMAINING (${(remainingItems || []).length}):\n` +
        (remainingItems || []).map(r => `- [${r.moduleName}] ${r.name} (${r.typeName})`).join('\n');
}

copyReportBtn.addEventListener('click', () => {
    if (!currentRawReportText) return;
    navigator.clipboard.writeText(currentRawReportText).then(() => {
        copyReportBtn.innerText = "✓ Copied Full Report!";
        setTimeout(() => { copyReportBtn.innerText = "📋 Copy Full Report"; }, 1500);
    });
});

// Stop Button
document.getElementById('stopBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    document.getElementById('status').innerText = "Stopping...";
    chrome.tabs.sendMessage(tab.id, { action: "stop_process" }, (response) => {
        if (chrome.runtime.lastError) {
            document.getElementById('status').innerText = "Could not reach tab.";
        }
    });
});

document.getElementById('startBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = "Skipping Videos...";

    chrome.tabs.sendMessage(tab.id, { action: "start_skipping" }, (response) => {
        if (chrome.runtime.lastError) {
            setRunningUIState(false);
            document.getElementById('status').innerText = "Error: Refresh page & try again.";
        }
    });
});

document.getElementById('readBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = "Completing Readings...";

    chrome.tabs.sendMessage(tab.id, { action: "start_reading_completion" }, (response) => {
        if (chrome.runtime.lastError) {
            setRunningUIState(false);
            document.getElementById('status').innerText = "Error: Refresh page & try again.";
        }
    });
});

// Check for running process or existing state on load
(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes("coursera.org")) {
        chrome.tabs.sendMessage(tab.id, { action: "get_status" }, (response) => {
            if (chrome.runtime.lastError || !response) return;
            
            if (response.statusMessage && response.statusMessage !== "Ready") {
                document.getElementById('status').innerText = response.statusMessage;
            }
            
            if (response.logs && response.logs.length > 0) {
                logContainer.innerHTML = '';
                response.logs.forEach(msg => {
                    appendLog(msg);
                });
            }

            if (response.progress && response.progress.total > 0) {
                const { current, total, message } = response.progress;
                const percentage = Math.round((current / total) * 100);
                document.getElementById('progressContainer').style.display = 'block';
                document.getElementById('progressBar').style.width = percentage + '%';
                document.getElementById('progressText').innerText = `${percentage}%`;
                document.getElementById('progressStep').innerText = message;
            }

            if (response.isRunning) {
                setRunningUIState(true);
            }
        });
    }
})();

// On-Screen Solver Mode Modal & Triggers
const solveModeModal = document.getElementById('solveModeModal');
const closeSolveModeBtn = document.getElementById('closeSolveModeBtn');
const solveAndSubmitBtn = document.getElementById('solveAndSubmitBtn');
const solveAndDraftBtn = document.getElementById('solveAndDraftBtn');

if (closeSolveModeBtn) {
    closeSolveModeBtn.addEventListener('click', () => {
        if (solveModeModal) solveModeModal.style.display = 'none';
    });
}

document.getElementById('quizOnScreenBtn').addEventListener('click', async () => {
    const config = getAIConfig();
    if (!config.apiKey && config.provider !== 'custom') {
        document.getElementById('status').innerText = `Enter ${config.provider} API Key first!`;
        return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    // Open modal to prompt user for submission preference
    if (solveModeModal) solveModeModal.style.display = 'flex';
});

async function executeOnScreenSolver(autoSubmit) {
    if (solveModeModal) solveModeModal.style.display = 'none';

    const config = getAIConfig();
    saveSettings();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = autoSubmit 
        ? "Solving & Auto-Submitting Quiz..." 
        : "Solving & Saving Quiz as Draft...";

    chrome.tabs.sendMessage(tab.id, { 
        action: "start_onscreen_quiz_solver", 
        apiKey: config.apiKey, 
        aiConfig: config,
        autoSubmit: autoSubmit
    }, (response) => {
        if (chrome.runtime.lastError) {
            setRunningUIState(false);
            document.getElementById('status').innerText = "Error: Refresh page & try again.";
        }
    });
}

if (solveAndSubmitBtn) {
    solveAndSubmitBtn.addEventListener('click', () => executeOnScreenSolver(true));
}
if (solveAndDraftBtn) {
    solveAndDraftBtn.addEventListener('click', () => executeOnScreenSolver(false));
}

document.getElementById('quizBtn').addEventListener('click', async () => {
    const config = getAIConfig();
    if (!config.apiKey && config.provider !== 'custom') {
        document.getElementById('status').innerText = `Enter ${config.provider} API Key first!`;
        return;
    }
    saveSettings();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = "Solving Quizzes & Practice...";

    chrome.tabs.sendMessage(tab.id, { 
        action: "start_quiz_solver", 
        apiKey: config.apiKey, 
        aiConfig: config 
    }, (response) => {
        if (chrome.runtime.lastError) {
            setRunningUIState(false);
            document.getElementById('status').innerText = "Error: Refresh page & try again.";
        }
    });
});

document.getElementById('completeBtn').addEventListener('click', async () => {
    const config = getAIConfig();
    if (!config.apiKey && config.provider !== 'custom') {
        document.getElementById('status').innerText = `Enter ${config.provider} API Key first!`;
        return;
    }
    
    saveSettings();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = "Running Complete Course with T&C & Auto-Submit...";

    chrome.tabs.sendMessage(tab.id, { 
        action: "start_complete_course", 
        apiKey: config.apiKey, 
        aiConfig: config 
    }, (response) => {
        if (chrome.runtime.lastError) {
            setRunningUIState(false);
            document.getElementById('status').innerText = "Error: Refresh page & try again.";
        }
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "log") {
        appendLog(request.data);
    }
    if (request.action === "status") {
        document.getElementById('status').innerText = request.data;
    }
    if (request.action === "progress_update") {
        const { current, total, message } = request.data;
        
        document.getElementById('progressContainer').style.display = 'block';

        let percentage = 0;
        if (total > 0) {
            percentage = Math.round((current / total) * 100);
        }
        
        document.getElementById('progressBar').style.width = percentage + '%';
        document.getElementById('progressText').innerText = `${percentage}%`;
        document.getElementById('progressStep').innerText = message;
    }
    if (request.action === "summary_report") {
        renderSummaryReport(request.data);
        chrome.storage.local.set({ latestSummaryReport: request.data });
    }
    if (request.action === "finished") {
        setRunningUIState(false);
        document.getElementById('status').innerText = "Process Finished!";
    }
});
