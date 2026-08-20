function setRunningUIState(isRunning) {
    document.getElementById('startBtn').disabled = isRunning;
    document.getElementById('readBtn').disabled = isRunning;
    document.getElementById('quizBtn').disabled = isRunning;
    document.getElementById('completeBtn').disabled = isRunning;
    
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
        stopBtn.style.display = isRunning ? 'block' : 'none';
    }

    if (isRunning) {
        document.getElementById('progressContainer').style.display = 'block';
    }
}

const providerSelect = document.getElementById('providerSelect');
const apiKeyLabel = document.getElementById('apiKeyLabel');
const apiKeyInput = document.getElementById('apiKey');
const modelGroup = document.getElementById('modelGroup');
const modelInput = document.getElementById('modelInput');
const endpointGroup = document.getElementById('endpointGroup');
const endpointInput = document.getElementById('endpointInput');
const logContainer = document.getElementById('log');

function updateProviderUI(provider) {
    if (provider === 'openrouter') {
        apiKeyLabel.innerText = "OpenRouter API Key";
        apiKeyInput.placeholder = "sk-or-v1-...";
        modelGroup.style.display = 'block';
        if (!modelInput.value) modelInput.value = "meta-llama/llama-3.3-70b-instruct:free";
        modelInput.placeholder = "meta-llama/llama-3.3-70b-instruct:free";
        endpointGroup.style.display = 'none';
    } else if (provider === 'groq') {
        apiKeyLabel.innerText = "Groq API Key";
        apiKeyInput.placeholder = "gsk_...";
        modelGroup.style.display = 'block';
        if (!modelInput.value) modelInput.value = "llama-3.3-70b-versatile";
        modelInput.placeholder = "llama-3.3-70b-versatile";
        endpointGroup.style.display = 'none';
    } else if (provider === 'custom') {
        apiKeyLabel.innerText = "Custom API Key / Bearer Token";
        apiKeyInput.placeholder = "API Key (leave blank if local/none)";
        modelGroup.style.display = 'block';
        modelInput.placeholder = "e.g. gpt-4o-mini, llama3, deepseek-chat";
        endpointGroup.style.display = 'block';
        if (!endpointInput.value) endpointInput.value = "http://localhost:11434/v1/chat/completions";
        endpointInput.placeholder = "https://api.openai.com/v1/chat/completions";
    } else {
        // Gemini
        apiKeyLabel.innerText = "Gemini API Key";
        apiKeyInput.placeholder = "AIzaSy...";
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

// Load saved settings
chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiEndpoint', 'geminiApiKey'], (result) => {
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
        btn.innerText = "Copied!";
        setTimeout(() => { btn.innerText = oldText; }, 1500);
    });
});

document.getElementById('clearLogBtn').addEventListener('click', () => {
    logContainer.innerHTML = '';
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
    document.getElementById('status').innerText = "Starting Video Skip...";

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
    document.getElementById('status').innerText = "Starting Reading Completion...";

    chrome.tabs.sendMessage(tab.id, { action: "start_reading_completion" }, (response) => {
        if (chrome.runtime.lastError) {
            setRunningUIState(false);
            document.getElementById('status').innerText = "Error: Refresh page & try again.";
        }
    });
});

// Check for running process on load
(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes("coursera.org")) {
        chrome.tabs.sendMessage(tab.id, { action: "get_status" }, (response) => {
            if (chrome.runtime.lastError) return;
            
            if (response && response.isRunning) {
                setRunningUIState(true);
                document.getElementById('status').innerText = response.statusMessage;
                
                logContainer.innerHTML = '';
                if (response.logs && response.logs.length > 0) {
                    response.logs.forEach(msg => {
                        appendLog(msg);
                    });
                }

                if (response.progress && response.progress.total > 0) {
                    const { current, total, message } = response.progress;
                    const percentage = Math.round((current / total) * 100);
                    document.getElementById('progressContainer').style.display = 'block';
                    document.getElementById('progressBar').style.width = percentage + '%';
                    document.getElementById('progressText').innerText = `${percentage}% - ${message}`;
                }
            }
        });
    }
})();

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
    document.getElementById('status').innerText = "Starting Quiz & Practice Solver...";

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
        alert(`Please enter a ${config.provider} API Key first.`);
        return;
    }
    
    saveSettings();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = "Starting Full Course Completion...";

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
        document.getElementById('progressText').innerText = `${percentage}% - ${message}`;
    }
    if (request.action === "finished") {
        setRunningUIState(false);
        document.getElementById('status').innerText = "Process Finished!";
    }
});
