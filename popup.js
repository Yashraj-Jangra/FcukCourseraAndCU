function setRunningUIState(isRunning) {
    const startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.disabled = isRunning;

    const readBtn = document.getElementById('readBtn');
    if (readBtn) readBtn.disabled = isRunning;

    const quizBtn = document.getElementById('quizBtn');
    if (quizBtn) quizBtn.disabled = isRunning;

    const onScreenBtn = document.getElementById('quizOnScreenBtn');
    if (onScreenBtn) onScreenBtn.disabled = isRunning;

    const appBtn = document.getElementById('appItemBtn');
    if (appBtn) appBtn.disabled = isRunning;

    const completeBtn = document.getElementById('completeBtn');
    if (completeBtn) completeBtn.disabled = isRunning;

    const liCompleteBtn = document.getElementById('linkedinCompleteBtn');
    if (liCompleteBtn) liCompleteBtn.disabled = isRunning;

    const liSingleBtn = document.getElementById('linkedinSingleBtn');
    if (liSingleBtn) liSingleBtn.disabled = isRunning;

    const liStartPathBtn = document.getElementById('linkedinStartPathBtn');
    if (liStartPathBtn) liStartPathBtn.disabled = isRunning;

    // Keep speed selector active during playback so user can switch speed dynamically
    const liSpeedSelect = document.getElementById('linkedinSpeedSelect');
    
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
                    <div style="font-size: 12px; font-weight: 600; color: #f4f4f6;">${courseTitle}</div>
                    <div style="font-size: 10px; color: #8e929e; margin-top: 2px;">Completed ${completedItems} of ${totalItems} items</div>
                </div>
                <div style="font-size: 12px; font-weight: 600; color: #f4f4f6;">${percent}%</div>
            </div>
            <div style="background: rgba(255, 255, 255, 0.08); border-radius: 9999px; height: 4px; overflow: hidden; margin-top: 8px;">
                <div style="background: #2563eb; height: 100%; width: ${percent}%;"></div>
            </div>
        </div>

        <div class="report-card">
            <div style="font-size: 9.5px; font-weight: 600; color: #8e929e; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">Module Coverage</div>
    `;

    (modules || []).forEach((m, idx) => {
        const isDone = m.completedCount >= m.totalCount;
        const badgeClass = isDone ? 'badge-done' : 'badge-progress';
        const badgeText = isDone ? '100%' : `${m.percent}% (${m.completedCount}/${m.totalCount})`;

        html += `
            <div class="module-row">
                <span style="color: #d4d4d8; max-width: 240px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500;">
                    ${idx + 1}. ${m.moduleName}
                </span>
                <span class="report-badge ${badgeClass}">${badgeText}</span>
            </div>
        `;
    });

    html += `</div>`;

    if (manualAttentionItems && manualAttentionItems.length > 0) {
        html += `
            <div class="report-card" style="border-left: 2px solid #ef4444; background: rgba(239, 68, 68, 0.06);">
                <div style="font-size: 10.5px; font-weight: 600; color: #f87171; margin-bottom: 4px;">Attention Required (${manualAttentionItems.length})</div>
                <div style="font-size: 9.5px; color: #a1a1aa; margin-bottom: 8px; line-height: 1.4;">
                    The following items are locked or require manual submission before final graded assessments can unlock:
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
        `;
        manualAttentionItems.forEach(item => {
            html += `
                <div style="font-size: 9.5px; background: rgba(0, 0, 0, 0.25); padding: 6px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.06);">
                    <div style="font-weight: 600; color: #ffffff;">[${item.moduleName || 'Module'}] ${item.name}</div>
                    <div style="color: #a1a1aa; margin: 2px 0;">Reason: ${item.reason}</div>
                    <a href="${item.itemUrl}" target="_blank" style="color: #60a5fa; text-decoration: none; font-weight: 500;">Open item →</a>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    if (categories) {
        html += `
            <div class="report-card">
                <div style="font-size: 9.5px; font-weight: 600; color: #8e929e; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">Categories</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 10px; color: #a1a1aa;">
                    <div>Videos: <b style="color: #f4f4f6;">${categories.videos || 0}</b></div>
                    <div>Readings: <b style="color: #f4f4f6;">${categories.readings || 0}</b></div>
                    <div>Discussions: <b style="color: #f4f4f6;">${categories.discussions || 0}</b></div>
                    <div>Dialogues: <b style="color: #f4f4f6;">${categories.dialogues || 0}</b></div>
                    <div>Labs & Apps: <b style="color: #f4f4f6;">${categories.labs || 0}</b></div>
                    <div>Quizzes: <b style="color: #f4f4f6;">${categories.quizzes || 0}</b></div>
                    <div>Graded: <b style="color: #f4f4f6;">${categories.graded || 0}</b></div>
                </div>
            </div>
        `;
    }

    if (remainingItems && remainingItems.length > 0) {
        html += `
            <div class="report-card" style="border-left: 2px solid #f59e0b;">
                <div style="font-size: 9.5px; font-weight: 600; color: #fbbf24; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Remaining Items (${remainingItems.length})</div>
                <div style="font-size: 9.5px; color: #a1a1aa; line-height: 1.5;">
        `;
        remainingItems.slice(0, 8).forEach(item => {
            html += `<div>• [${item.moduleName || 'Module'}] <b>${item.name}</b> (${item.typeName || 'item'})</div>`;
        });
        if (remainingItems.length > 8) {
            html += `<div style="font-style: italic; margin-top: 4px; color: #52525b;">+ ${remainingItems.length - 8} more items</div>`;
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

// Robust Tab Message Dispatcher with Auto-Injection Fallback
async function sendTabMessageWithAutoInject(tabId, message, onComplete) {
    chrome.tabs.sendMessage(tabId, message, async (response) => {
        if (chrome.runtime.lastError) {
            console.log("Content script port disconnected. Auto-injecting content.js...", chrome.runtime.lastError.message);
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js']
                });
                // Wait briefly for content script initialization, then retry message
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, message, (retryResp) => {
                        if (chrome.runtime.lastError) {
                            console.warn("Message retry failed:", chrome.runtime.lastError.message);
                            if (onComplete) onComplete(null, chrome.runtime.lastError);
                        } else {
                            if (onComplete) onComplete(retryResp, null);
                        }
                    });
                }, 350);
            } catch (injectErr) {
                console.error("Auto-injection failed:", injectErr);
                if (onComplete) onComplete(null, injectErr);
            }
        } else {
            if (onComplete) onComplete(response, null);
        }
    });
}

// LinkedIn Learning Buttons
const linkedinCompleteBtn = document.getElementById('linkedinCompleteBtn');
if (linkedinCompleteBtn) {
    linkedinCompleteBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes("linkedin.com/learning")) {
            document.getElementById('status').innerText = "Error: Not on LinkedIn Learning!";
            return;
        }

        const speedSelect = document.getElementById('linkedinSpeedSelect');
        const speed = speedSelect ? parseFloat(speedSelect.value) || 16.0 : 16.0;

        setRunningUIState(true);
        document.getElementById('status').innerText = `Running LinkedIn Completer (${speed}x Turbo)...`;

        sendTabMessageWithAutoInject(tab.id, { 
            action: "start_linkedin_videos", 
            speed: speed 
        }, (response, err) => {
            if (err) {
                setRunningUIState(false);
                document.getElementById('status').innerText = "Error: Refresh page & try again.";
            }
        });
    });
}

const linkedinSingleBtn = document.getElementById('linkedinSingleBtn');
if (linkedinSingleBtn) {
    linkedinSingleBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes("linkedin.com/learning")) {
            document.getElementById('status').innerText = "Error: Not on LinkedIn Learning!";
            return;
        }

        const speedSelect = document.getElementById('linkedinSpeedSelect');
        const speed = speedSelect ? parseFloat(speedSelect.value) || 16.0 : 16.0;

        setRunningUIState(true);
        document.getElementById('status').innerText = `Fast-Forwarding Active Video (${speed}x)...`;

        sendTabMessageWithAutoInject(tab.id, { 
            action: "start_linkedin_single_video", 
            speed: speed 
        }, (response, err) => {
            if (err) {
                setRunningUIState(false);
                document.getElementById('status').innerText = "Error: Refresh page & try again.";
            }
        });
    });
}

const linkedinSpeedSelect = document.getElementById('linkedinSpeedSelect');
if (linkedinSpeedSelect) {
    chrome.storage.local.get(['linkedinTargetSpeed'], (res) => {
        if (res.linkedinTargetSpeed) {
            linkedinSpeedSelect.value = String(res.linkedinTargetSpeed);
        }
    });

    linkedinSpeedSelect.addEventListener('change', async () => {
        const speed = parseFloat(linkedinSpeedSelect.value) || 16.0;
        await chrome.storage.local.set({ linkedinTargetSpeed: speed });
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { 
                action: "set_linkedin_speed", 
                speed: speed 
            }).catch(() => {});
        }
    });
}

// =========================================================================
// LinkedIn Learning Path Worker Pool UI & Controls
// =========================================================================
let activePathRunning = false;
let detectedLinkedInContext = null;

function renderPathWorkerState(state) {
    if (!state) return;
    const workerTray = document.getElementById('linkedinWorkerTray');
    const workerTrayCount = document.getElementById('workerTrayCount');
    const workerList = document.getElementById('workerList');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressStep = document.getElementById('progressStep');
    const statusEl = document.getElementById('status');

    activePathRunning = !!state.isRunning;

    if (state.isRunning || (state.courses && state.courses.length > 0)) {
        if (workerTray) workerTray.style.display = 'block';
        if (workerTrayCount) {
            workerTrayCount.innerText = `${state.activeWorkerCount || 0} active • ${state.completedCourses || 0}/${state.totalCourses || 0} done`;
        }
    }

    if (workerList && Array.isArray(state.courses)) {
        workerList.innerHTML = '';
        state.courses.forEach((c) => {
            const item = document.createElement('div');
            item.className = 'worker-item';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'worker-name';
            const typeIcon = c.itemType === 'video' ? '🎬 ' : '📚 ';
            nameSpan.innerText = `${c.index}. ${typeIcon}${c.title}`;
            nameSpan.title = `${c.title} (${c.itemType || 'course'}${c.duration ? ' • ' + c.duration : ''})`;

            const badgeSpan = document.createElement('span');
            let badgeClass = 'badge-queued';
            let badgeText = 'Queued';

            if (c.status === 'completed') {
                badgeClass = 'badge-done';
                badgeText = '100% ✓';
            } else if (c.status === 'running') {
                badgeClass = 'badge-running';
                badgeText = c.percent > 0 ? `${c.percent}%` : 'Running...';
            } else if (c.status === 'failed') {
                badgeClass = 'badge-queued';
                badgeText = 'Failed';
            }

            badgeSpan.className = `worker-badge ${badgeClass}`;
            badgeSpan.innerText = badgeText;

            item.appendChild(nameSpan);
            item.appendChild(badgeSpan);
            workerList.appendChild(item);
        });
    }

    if (state.totalCourses > 0) {
        const pct = Math.round((state.completedCourses / state.totalCourses) * 100);
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.innerText = `${pct}%`;
        if (progressStep) progressStep.innerText = `${state.completedCourses}/${state.totalCourses} courses complete`;
        if (statusEl && state.isRunning) {
            statusEl.innerText = `Parallel Workers: ${state.activeWorkerCount} tabs active (max ${state.maxConcurrency})...`;
        }
    }

    if (state.targetSpeed) {
        const pathSpeedSelect = document.getElementById('linkedinPathSpeedSelect');
        if (pathSpeedSelect) pathSpeedSelect.value = String(state.targetSpeed);
    }

    // Sync throttle notice banner in popup
    const popupNoticeBanner = document.getElementById('popupNoticeBanner');
    const popupNoticeText = document.getElementById('popupNoticeText');
    if (popupNoticeBanner && popupNoticeText) {
        if (state.throttleNotice) {
            popupNoticeBanner.style.display = 'flex';
            popupNoticeText.innerText = state.throttleNotice;
        } else {
            popupNoticeBanner.style.display = 'none';
        }
    }

    // Sync active concurrency pill with state
    if (state.maxConcurrency) {
        const pills = document.querySelectorAll('.concurrency-pill');
        pills.forEach(p => {
            if (parseInt(p.getAttribute('data-concurrency'), 10) === state.maxConcurrency) {
                p.classList.add('active');
            } else {
                p.classList.remove('active');
            }
        });
    }
}

// Concurrency Selector (Pills 1 - 5, default 3)
const concurrencyPills = document.querySelectorAll('.concurrency-pill');
concurrencyPills.forEach(pill => {
    pill.addEventListener('click', () => {
        concurrencyPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const conc = parseInt(pill.getAttribute('data-concurrency'), 10) || 3;
        chrome.storage.local.set({ linkedinPathConcurrency: conc });
        chrome.runtime.sendMessage({ action: "set_path_concurrency", concurrency: conc }).catch(() => {});
    });
});

// Learning Path Start Hero Button
const linkedinStartPathBtn = document.getElementById('linkedinStartPathBtn');
if (linkedinStartPathBtn) {
    linkedinStartPathBtn.addEventListener('click', async () => {
        // If context not ready or courses empty, attempt an immediate live rescan of the active tab first
        if (!detectedLinkedInContext || !detectedLinkedInContext.courses || detectedLinkedInContext.courses.length === 0) {
            document.getElementById('status').innerText = "Scanning Learning Path content...";
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab && activeTab.id) {
                try {
                    const freshCtx = await new Promise((resolve) => {
                        sendTabMessageWithAutoInject(activeTab.id, { action: "get_linkedin_context" }, (resp) => {
                            resolve(resp);
                        });
                    });
                    if (freshCtx && freshCtx.isPathPage && freshCtx.courses && freshCtx.courses.length > 0) {
                        detectedLinkedInContext = freshCtx;
                        const remaining = (freshCtx.totalCourses || 0) - (freshCtx.completedCourses || 0);
                        const subEl = document.getElementById('linkedinContextSub');
                        if (subEl) subEl.innerText = `${freshCtx.totalCourses || 0} items • ${freshCtx.completedCourses || 0} completed • ${remaining} remaining`;
                        renderPathWorkerState({
                            isRunning: false,
                            courses: freshCtx.courses,
                            totalCourses: freshCtx.totalCourses,
                            completedCourses: freshCtx.completedCourses,
                            maxConcurrency: 3,
                            activeWorkerCount: 0
                        });
                    }
                } catch(e) {}
            }
        }

        if (!detectedLinkedInContext || !detectedLinkedInContext.courses || detectedLinkedInContext.courses.length === 0) {
            document.getElementById('status').innerText = "No courses detected in this Learning Path.";
            return;
        }

        const activePill = document.querySelector('.concurrency-pill.active');
        const concurrency = activePill ? parseInt(activePill.getAttribute('data-concurrency'), 10) || 3 : 3;

        const pathSpeedSelect = document.getElementById('linkedinPathSpeedSelect') || document.getElementById('linkedinSpeedSelect');
        const speed = pathSpeedSelect ? parseFloat(pathSpeedSelect.value) || 16.0 : 16.0;

        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const overviewTabId = activeTab ? activeTab.id : null;

        setRunningUIState(true);
        activePathRunning = true;
        document.getElementById('status').innerText = `Spawning Worker Tabs (max ${concurrency} at once)...`;
        const workerTray = document.getElementById('linkedinWorkerTray');
        if (workerTray) workerTray.style.display = 'block';

        chrome.runtime.sendMessage({
            action: "start_learning_path",
            pathTitle: detectedLinkedInContext.pathTitle || "Learning Path",
            pathUrl: detectedLinkedInContext.pathUrl || "",
            courses: detectedLinkedInContext.courses,
            maxConcurrency: concurrency,
            speed: speed,
            overviewTabId: overviewTabId
        }, (resp) => {
            if (chrome.runtime.lastError) {
                setRunningUIState(false);
                activePathRunning = false;
                document.getElementById('status').innerText = "Failed to launch path workers.";
            } else {
                appendLog({
                    text: `Started Learning Path Worker Pool: ${detectedLinkedInContext.courses.length} courses, ${concurrency} parallel tabs`,
                    type: "info"
                });
            }
        });
    });
}

// Switch to Path Button (when on single course that belongs to a path)
const linkedinSwitchPathBtn = document.getElementById('linkedinSwitchPathBtn');
if (linkedinSwitchPathBtn) {
    linkedinSwitchPathBtn.addEventListener('click', async () => {
        if (detectedLinkedInContext && detectedLinkedInContext.parentPathUrl) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.id) {
                await chrome.tabs.update(tab.id, { url: detectedLinkedInContext.parentPathUrl });
                window.close();
            }
        }
    });
}

// Floating HUD Toggle Button
const toggleHudBtn = document.getElementById('toggleHudBtn');
if (toggleHudBtn) {
    toggleHudBtn.addEventListener('click', async () => {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id) {
            sendTabMessageWithAutoInject(activeTab.id, { action: "show_floating_hud" }, () => {
                window.close();
            });
        }
    });
}

// Path Speed Selector Dynamic Change
const linkedinPathSpeedSelect = document.getElementById('linkedinPathSpeedSelect');
if (linkedinPathSpeedSelect) {
    linkedinPathSpeedSelect.addEventListener('change', () => {
        const val = parseFloat(linkedinPathSpeedSelect.value) || 16.0;
        chrome.runtime.sendMessage({ action: "set_path_speed", speed: val }).catch(() => {});
    });
}

// Stop Button (Handles both single process and background worker pool)
document.getElementById('stopBtn').addEventListener('click', async () => {
    document.getElementById('status').innerText = "Stopping...";

    if (activePathRunning) {
        chrome.runtime.sendMessage({ action: "stop_learning_path" }, () => {
            activePathRunning = false;
            setRunningUIState(false);
            document.getElementById('status').innerText = "Learning Path workers stopped.";
            appendLog({ text: "Learning path worker pool stopped by user.", type: "warning" });
        });
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
        sendTabMessageWithAutoInject(tab.id, { action: "stop_process" }, (response, err) => {
            if (err) {
                document.getElementById('status').innerText = "Could not reach tab.";
            }
        });
    }
});

document.getElementById('startBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;
    
    if (tab.url.includes("linkedin.com/learning")) {
        if (linkedinCompleteBtn) linkedinCompleteBtn.click();
        return;
    }

    if (!tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera or LinkedIn!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = "Skipping Videos...";

    sendTabMessageWithAutoInject(tab.id, { action: "start_skipping" }, (response, err) => {
        if (err) {
            setRunningUIState(false);
            document.getElementById('status').innerText = "Error: Refresh page & try again.";
        }
    });
});

document.getElementById('appItemBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = "Completing App Items in Course...";

    sendTabMessageWithAutoInject(tab.id, { action: "complete_app_item_on_screen" }, (response, err) => {
        if (err) {
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

    sendTabMessageWithAutoInject(tab.id, { action: "start_reading_completion" }, (response, err) => {
        if (err) {
            setRunningUIState(false);
            document.getElementById('status').innerText = "Error: Refresh page & try again.";
        }
    });
});

// Check for running process or existing state on load & adapt platform UI
(async () => {
    // 1. First check if a background Learning Path worker pool is already running!
    chrome.runtime.sendMessage({ action: "get_learning_path_state" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.state) return;
        const state = res.state;

        if (state.isRunning) {
            activePathRunning = true;
            const platformTag = document.getElementById('platformTag');
            const linkedinSection = document.getElementById('linkedinSection');
            const courseraSection = document.getElementById('courseraSection');
            const aiSettingsSection = document.getElementById('aiSettingsSection');
            const pathControls = document.getElementById('linkedinPathControls');
            const courseControls = document.getElementById('linkedinCourseControls');

            if (linkedinSection) linkedinSection.style.display = 'block';
            if (courseraSection) courseraSection.style.display = 'none';
            if (aiSettingsSection) aiSettingsSection.style.display = 'none';
            if (pathControls) pathControls.style.display = 'block';
            if (courseControls) courseControls.style.display = 'none';
            if (platformTag) platformTag.innerText = "LinkedIn (Path)";

            const titleEl = document.getElementById('linkedinContextTitle');
            const tagEl = document.getElementById('linkedinContextTag');
            const subEl = document.getElementById('linkedinContextSub');
            if (titleEl) titleEl.innerText = state.pathTitle || "Learning Path";
            if (tagEl) {
                tagEl.innerText = "Learning Path";
                tagEl.className = "context-tag";
            }
            if (subEl) subEl.innerText = `${state.completedCourses}/${state.totalCourses} courses complete`;

            // Highlight active concurrency pill
            if (state.maxConcurrency) {
                const pills = document.querySelectorAll('.concurrency-pill');
                pills.forEach(p => {
                    if (parseInt(p.getAttribute('data-concurrency'), 10) === state.maxConcurrency) {
                        p.classList.add('active');
                    } else {
                        p.classList.remove('active');
                    }
                });
            }

            if (state.targetSpeed) {
                const pathSpeedSelect = document.getElementById('linkedinPathSpeedSelect');
                if (pathSpeedSelect) pathSpeedSelect.value = String(state.targetSpeed);
            }

            renderPathWorkerState(state);
            setRunningUIState(true);
        }
    });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const isLinkedIn = tab.url.includes("linkedin.com/learning");
    const isCoursera = tab.url.includes("coursera.org");

    const platformTag = document.getElementById('platformTag');
    const linkedinSection = document.getElementById('linkedinSection');
    const courseraSection = document.getElementById('courseraSection');
    const aiSettingsSection = document.getElementById('aiSettingsSection');
    const pathControls = document.getElementById('linkedinPathControls');
    const courseControls = document.getElementById('linkedinCourseControls');

    if (isLinkedIn) {
        if (linkedinSection) linkedinSection.style.display = 'block';
        if (courseraSection) courseraSection.style.display = 'none';
        if (aiSettingsSection) aiSettingsSection.style.display = 'none';
        if (platformTag) {
            platformTag.innerText = "LinkedIn";
            platformTag.style.color = "";
            platformTag.style.borderColor = "";
        }
        document.getElementById('status').innerText = "Ready on LinkedIn Learning";

        // Restore saved concurrency preference
        chrome.storage.local.get(['linkedinPathConcurrency'], (res) => {
            const targetConc = parseInt(res.linkedinPathConcurrency, 10) || 3;
            const pills = document.querySelectorAll('.concurrency-pill');
            pills.forEach(p => {
                if (parseInt(p.getAttribute('data-concurrency'), 10) === targetConc) {
                    p.classList.add('active');
                } else {
                    p.classList.remove('active');
                }
            });
        });

        // Query active tab context (Learning Path vs Single Course) with auto-retry
        const queryTabContext = (retryCount = 0) => {
            sendTabMessageWithAutoInject(tab.id, { action: "get_linkedin_context" }, (ctx) => {
                if (!ctx) return;
                detectedLinkedInContext = ctx;

                const titleEl = document.getElementById('linkedinContextTitle');
                const tagEl = document.getElementById('linkedinContextTag');
                const subEl = document.getElementById('linkedinContextSub');
                const switchBtn = document.getElementById('linkedinSwitchPathBtn');

                if (ctx.isPathPage) {
                    // User is viewing a Learning Path!
                    if (pathControls) pathControls.style.display = 'block';
                    if (courseControls) courseControls.style.display = 'none';
                    if (titleEl) titleEl.innerText = ctx.pathTitle || "Learning Path";
                    if (tagEl) {
                        tagEl.innerText = "Learning Path";
                        tagEl.className = "context-tag";
                    }

                    // If React DOM is still mounting courses, retry after 500ms
                    if ((!ctx.courses || ctx.courses.length === 0) && retryCount < 3) {
                        if (subEl) subEl.innerText = "Scanning Learning Path items...";
                        setTimeout(() => queryTabContext(retryCount + 1), 500);
                        return;
                    }

                    const remaining = (ctx.totalCourses || 0) - (ctx.completedCourses || 0);
                    if (subEl) subEl.innerText = `${ctx.totalCourses || 0} items • ${ctx.completedCourses || 0} completed • ${remaining} remaining`;
                    if (switchBtn) switchBtn.style.display = 'none';

                    // Initial render of detected courses list in tray
                    renderPathWorkerState({
                        isRunning: false,
                        courses: ctx.courses,
                        totalCourses: ctx.totalCourses,
                        completedCourses: ctx.completedCourses,
                        maxConcurrency: 3,
                        activeWorkerCount: 0
                    });
                } else {
                    // User is viewing a Single Course
                    if (pathControls) pathControls.style.display = 'none';
                    if (courseControls) courseControls.style.display = 'block';
                    if (titleEl) titleEl.innerText = ctx.courseTitle || "Single Course";
                    if (tagEl) {
                        tagEl.innerText = "Single Course";
                        tagEl.className = "context-tag single";
                    }
                    if (subEl) subEl.innerText = `${ctx.completedVideos || 0}/${ctx.totalVideos || 0} videos watched`;

                    if (ctx.hasParentPath && ctx.parentPathUrl) {
                        if (switchBtn) {
                            switchBtn.style.display = 'inline-block';
                            switchBtn.innerText = "View Path →";
                            switchBtn.title = ctx.parentPathTitle || "Open Parent Learning Path";
                        }
                    } else {
                        if (switchBtn) switchBtn.style.display = 'none';
                    }
                }
            });
        };
        queryTabContext(0);
    } else if (isCoursera) {
        if (linkedinSection) linkedinSection.style.display = 'none';
        if (courseraSection) courseraSection.style.display = 'block';
        if (aiSettingsSection) aiSettingsSection.style.display = 'block';
        if (platformTag) {
            platformTag.innerText = "Coursera";
            platformTag.style.color = "";
            platformTag.style.borderColor = "";
        }
    } else {
        document.getElementById('status').innerText = "Open Coursera or LinkedIn Learning";
    }

    if (isCoursera || isLinkedIn) {
        sendTabMessageWithAutoInject(tab.id, { action: "get_status" }, (response) => {
            if (!response) return;
            
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

    sendTabMessageWithAutoInject(tab.id, { 
        action: "start_onscreen_quiz_solver", 
        apiKey: config.apiKey, 
        aiConfig: config,
        autoSubmit: autoSubmit
    }, (response, err) => {
        if (err) {
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

    sendTabMessageWithAutoInject(tab.id, { 
        action: "start_quiz_solver", 
        apiKey: config.apiKey, 
        aiConfig: config 
    }, (response, err) => {
        if (err) {
            setRunningUIState(false);
            document.getElementById('status').innerText = "Error: Refresh page & try again.";
        }
    });
});

document.getElementById('completeBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes("linkedin.com/learning")) {
        if (linkedinCompleteBtn) linkedinCompleteBtn.click();
        return;
    }

    const config = getAIConfig();
    if (!config.apiKey && config.provider !== 'custom') {
        document.getElementById('status').innerText = `Enter ${config.provider} API Key first!`;
        return;
    }
    
    saveSettings();

    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = "Running Complete Course with T&C & Auto-Submit...";

    sendTabMessageWithAutoInject(tab.id, { 
        action: "start_complete_course", 
        apiKey: config.apiKey, 
        aiConfig: config 
    }, (response, err) => {
        if (err) {
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
    if (request.action === "path_progress_update") {
        renderPathWorkerState(request.state);
    }
    if (request.action === "path_all_completed") {
        activePathRunning = false;
        setRunningUIState(false);
        document.getElementById('status').innerText = "🎉 All Courses in Path Completed!";
        appendLog({
            text: `🎉 All courses in "${request.pathTitle}" have been successfully completed!`,
            type: "success"
        });
        renderPathWorkerState(request.state);
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
