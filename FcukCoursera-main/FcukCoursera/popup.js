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
        document.getElementById('progressText').style.display = 'block';
    }
}

const providerSelect = document.getElementById('providerSelect');
const apiKeyLabel = document.getElementById('apiKeyLabel');
const apiKeyInput = document.getElementById('apiKey');
const modelGroup = document.getElementById('modelGroup');
const modelInput = document.getElementById('modelInput');
const endpointGroup = document.getElementById('endpointGroup');
const endpointInput = document.getElementById('endpointInput');

function updateProviderUI(provider) {
    if (provider === 'openrouter') {
        apiKeyLabel.innerText = "OpenRouter API Key";
        apiKeyInput.placeholder = "sk-or-v1-...";
        modelGroup.style.display = 'block';
        if (!modelInput.value) modelInput.value = "meta-llama/llama-3.3-70b-instruct:free";
        modelInput.placeholder = "e.g. meta-llama/llama-3.3-70b-instruct:free or google/gemini-2.0-flash-001";
        endpointGroup.style.display = 'none';
    } else if (provider === 'groq') {
        apiKeyLabel.innerText = "Groq API Key";
        apiKeyInput.placeholder = "gsk_...";
        modelGroup.style.display = 'block';
        if (!modelInput.value) modelInput.value = "llama-3.3-70b-versatile";
        modelInput.placeholder = "e.g. llama-3.3-70b-versatile";
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
        // Keep backwards compatibility
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
    document.getElementById('status').innerText = "Starting...";

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
    document.getElementById('status').innerText = "Starting Readings...";

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
                
                const logDiv = document.getElementById('log');
                logDiv.innerHTML = '';
                if (response.logs && response.logs.length > 0) {
                    response.logs.forEach(msg => {
                        const entry = document.createElement('div');
                        entry.innerText = msg;
                        logDiv.appendChild(entry);
                    });
                    logDiv.scrollTop = logDiv.scrollHeight;
                }

                if (response.progress && response.progress.total > 0) {
                    const { current, total, message } = response.progress;
                    const percentage = Math.round((current / total) * 100);
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
    document.getElementById('status').innerText = "Starting Quiz Solver...";

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
        const logDiv = document.getElementById('log');
        const entry = document.createElement('div');
        entry.innerText = request.data;
        logDiv.appendChild(entry);
        if (logDiv.children.length > 150) {
            logDiv.removeChild(logDiv.firstChild);
        }
        logDiv.scrollTop = logDiv.scrollHeight;
    }
    if (request.action === "status") {
        document.getElementById('status').innerText = request.data;
    }
    if (request.action === "progress_update") {
        const { current, total, message } = request.data;
        
        document.getElementById('progressContainer').style.display = 'block';
        document.getElementById('progressText').style.display = 'block';

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
