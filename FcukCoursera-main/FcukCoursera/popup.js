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

// Load saved key
chrome.storage.local.get(['geminiApiKey'], (result) => {
    if (result.geminiApiKey) {
        document.getElementById('apiKey').value = result.geminiApiKey;
    }
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
    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
        document.getElementById('status').innerText = "Enter Gemini API Key first!";
        return;
    }
    chrome.storage.local.set({ geminiApiKey: apiKey });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = "Starting Quiz Solver...";

    chrome.tabs.sendMessage(tab.id, { action: "start_quiz_solver", apiKey: apiKey }, (response) => {
        if (chrome.runtime.lastError) {
            setRunningUIState(false);
            document.getElementById('status').innerText = "Error: Refresh page & try again.";
        }
    });
});

document.getElementById('completeBtn').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
        alert("Please enter a Gemini API Key first.");
        return;
    }
    
    chrome.storage.local.set({ geminiApiKey: apiKey });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || !tab.url.includes("coursera.org")) {
        document.getElementById('status').innerText = "Error: Not on Coursera!";
        return;
    }

    setRunningUIState(true);
    document.getElementById('status').innerText = "Starting Full Course Completion...";

    chrome.tabs.sendMessage(tab.id, { action: "start_complete_course", apiKey: apiKey }, (response) => {
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

