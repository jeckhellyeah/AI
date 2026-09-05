// ===== STATE =====
let apiKey = localStorage.getItem('gemini_api_key') || '';
let systemPrompt = localStorage.getItem('system_prompt') || 'Kamu adalah asisten AI yang membantu, ramah, dan profesional.';
let temperature = parseFloat(localStorage.getItem('temperature')) || 0.7;
let chatHistory = [];
let uploadedFiles = [];
let isProcessing = false;
let selectedModel = 'gemini-2.0-flash'; // Model terbaru

// ===== DOM REFS =====
const chatBox = document.getElementById('chatBox');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const filePreview = document.getElementById('filePreview');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const systemPromptInput = document.getElementById('systemPrompt');
const savePromptBtn = document.getElementById('savePromptBtn');
const temperatureInput = document.getElementById('temperature');
const tempValue = document.getElementById('tempValue');
const clearChatBtn = document.getElementById('clearChatBtn');
const statusEl = document.getElementById('status');
const modelSelect = document.getElementById('modelSelect');

// ===== INIT =====
apiKeyInput.value = apiKey;
systemPromptInput.value = systemPrompt;
temperatureInput.value = temperature;
tempValue.textContent = temperature;

loadChatHistory();
updateStatus();

// ===== EVENT LISTENERS =====
sendBtn.addEventListener('click', handleSendMessage);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
});

uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileUpload);

saveKeyBtn.addEventListener('click', saveApiKey);
savePromptBtn.addEventListener('click', saveSystemPrompt);
temperatureInput.addEventListener('input', (e) => {
    temperature = parseFloat(e.target.value);
    tempValue.textContent = temperature;
    localStorage.setItem('temperature', temperature);
});
clearChatBtn.addEventListener('click', clearChat);

// ===== CORE FUNCTIONS =====
async function handleSendMessage() {
    const text = messageInput.value.trim();
    if (!text && uploadedFiles.length === 0) return;
    if (isProcessing) return;
    if (!apiKey) {
        alert('🔑 Masukkan API Key terlebih dahulu!');
        return;
    }

    // Add user message
    addMessage('user', text, uploadedFiles);
    messageInput.value = '';
    const files = [...uploadedFiles];
    uploadedFiles = [];
    filePreview.innerHTML = '';
    fileInput.value = '';

    showTypingIndicator();
    isProcessing = true;
    updateStatus('processing');

    try {
        const response = await callGeminiAPI(text, files);
        hideTypingIndicator();
        addMessage('ai', response);
        saveChatHistory();
    } catch (error) {
        hideTypingIndicator();
        let errorMsg = error.message;
        
        // Handle model not found error
        if (errorMsg.includes('not found') || errorMsg.includes('not supported')) {
            errorMsg = '❌ Model tidak ditemukan. Mencoba model alternatif...';
            addMessage('ai', errorMsg);
            
            // Try fallback models
            const fallbackModels = ['gemini-1.5-pro', 'gemini-1.5-flash-001', 'gemini-pro'];
            let success = false;
            
            for (const model of fallbackModels) {
                try {
                    addMessage('ai', `🔄 Mencoba model: ${model}...`);
                    const response = await callGeminiAPI(text, files, model);
                    hideTypingIndicator();
                    addMessage('ai', response);
                    success = true;
                    break;
                } catch (e) {
                    continue;
                }
            }
            
            if (!success) {
                addMessage('ai', '❌ Semua model gagal. Pastikan API Key valid dan coba lagi nanti.');
            }
        } else {
            addMessage('ai', `❌ Error: ${errorMsg}`);
        }
        console.error(error);
    } finally {
        isProcessing = false;
        updateStatus('ready');
    }
}

async function callGeminiAPI(text, files, model = null) {
    // Gunakan model yang dipilih atau default
    const modelToUse = model || selectedModel;
    
    // List model yang didukung (update sesuai availability)
    const supportedModels = [
        'gemini-2.0-flash',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-flash-001',
        'gemini-pro'
    ];
    
    // Coba model yang diminta, jika error coba fallback
    let currentModel = modelToUse;
    let lastError = null;
    
    for (let i = 0; i < Math.min(supportedModels.length, 3); i++) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
            
            const parts = [];
            parts.push({ text: systemPrompt });
            parts.push({ text: text || 'Analisis file berikut:' });

            // Process files
            for (const file of files) {
                const base64 = await fileToBase64(file);
                const mimeType = file.type || 'application/octet-stream';
                
                if (file.type.startsWith('image/')) {
                    parts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: base64.split(',')[1]
                        }
                    });
                } else {
                    try {
                        const textContent = await file.text();
                        parts.push({ text: `\n[File: ${file.name}]\n${textContent.substring(0, 5000)}` });
                    } catch {
                        parts.push({ text: `\n[File: ${file.name}] (tidak bisa dibaca sebagai teks)` });
                    }
                }
            }

            const payload = {
                contents: [{
                    parts: parts
                }],
                generationConfig: {
                    temperature: temperature,
                    maxOutputTokens: 2048,
                    topK: 40,
                    topP: 0.95
                }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
                
                // Jika model not found, coba model berikutnya
                if (errorMsg.includes('not found') || errorMsg.includes('not supported')) {
                    lastError = errorMsg;
                    // Pindah ke model berikutnya dalam daftar
                    const nextIndex = supportedModels.indexOf(currentModel) + 1;
                    if (nextIndex < supportedModels.length) {
                        currentModel = supportedModels[nextIndex];
                        continue;
                    }
                    throw new Error(`Model tidak tersedia. Coba: ${supportedModels.join(', ')}`);
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            return data.candidates[0].content.parts[0].text || 'Maaf, tidak ada respons.';
            
        } catch (error) {
            if (error.message.includes('not found') || error.message.includes('not supported')) {
                // Coba model berikutnya
                const nextIndex = supportedModels.indexOf(currentModel) + 1;
                if (nextIndex < supportedModels.length) {
                    currentModel = supportedModels[nextIndex];
                    continue;
                }
                throw new Error(`Tidak ada model yang tersedia. Coba: ${supportedModels.join(', ')}`);
            }
            throw error;
        }
    }
    
    throw new Error('Gagal memanggil AI setelah mencoba beberapa model.');
}

// ===== UI HELPERS (Sama seperti sebelumnya) =====
function addMessage(role, content, files = []) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    
    if (files.length > 0) {
        files.forEach(file => {
            if (file.type && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    div.appendChild(img);
                };
                reader.readAsDataURL(file);
            } else {
                const info = document.createElement('div');
                info.className = 'file-info';
                info.textContent = `📎 ${file.name} (${(file.size / 1024).toFixed(0)}KB)`;
                div.appendChild(info);
            }
        });
    }
    
    const textDiv = document.createElement('div');
    textDiv.textContent = content;
    div.appendChild(textDiv);
    
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function showTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.id = 'typingIndicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function hideTypingIndicator() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
}

function updateStatus(state = 'ready') {
    const statusMap = {
        'ready': { text: '● Siap', color: '#4caf50' },
        'processing': { text: '⏳ Memproses...', color: '#ff9800' },
        'error': { text: '⚠️ Error', color: '#f44336' }
    };
    const status = statusMap[state] || statusMap.ready;
    statusEl.textContent = status.text;
    statusEl.style.color = status.color;
}

function saveApiKey() {
    apiKey = apiKeyInput.value.trim();
    localStorage.setItem('gemini_api_key', apiKey);
    alert('✅ API Key disimpan!');
    updateStatus('ready');
}

function saveSystemPrompt() {
    systemPrompt = systemPromptInput.value.trim();
    localStorage.setItem('system_prompt', systemPrompt);
    alert('✅ Prompt system disimpan!');
}

function clearChat() {
    if (confirm('Hapus semua riwayat chat?')) {
        chatBox.innerHTML = '';
        chatHistory = [];
        localStorage.removeItem('chat_history');
    }
}

function saveChatHistory() {
    const messages = [];
    document.querySelectorAll('.message').forEach(msg => {
        messages.push({
            role: msg.classList.contains('user') ? 'user' : 'ai',
            content: msg.textContent
        });
    });
    chatHistory = messages;
    localStorage.setItem('chat_history', JSON.stringify(messages));
}

function loadChatHistory() {
    const saved = localStorage.getItem('chat_history');
    if (saved) {
        try {
            const messages = JSON.parse(saved);
            messages.forEach(msg => {
                const div = document.createElement('div');
                div.className = `message ${msg.role}`;
                div.textContent = msg.content;
                chatBox.appendChild(div);
            });
            chatBox.scrollTop = chatBox.scrollHeight;
        } catch (e) { /* ignore */ }
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        if (file.size > 5 * 1024 * 1024) {
            alert(`File ${file.name} terlalu besar (max 5MB)`);
            return;
        }
        uploadedFiles.push(file);
        const tag = document.createElement('div');
        tag.className = 'file-tag';
        tag.innerHTML = `
            📎 ${file.name} (${(file.size / 1024).toFixed(0)}KB)
            <span class="remove-file" data-index="${uploadedFiles.length - 1}">×</span>
        `;
        filePreview.appendChild(tag);
        tag.querySelector('.remove-file').addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            uploadedFiles.splice(idx, 1);
            // Refresh preview
            filePreview.innerHTML = '';
            uploadedFiles.forEach((f, i) => {
                const newTag = document.createElement('div');
                newTag.className = 'file-tag';
                newTag.innerHTML = `
                    📎 ${f.name} (${(f.size / 1024).toFixed(0)}KB)
                    <span class="remove-file" data-index="${i}">×</span>
                `;
                filePreview.appendChild(newTag);
                newTag.querySelector('.remove-file').addEventListener('click', (e) => {
                    const idx = parseInt(e.target.dataset.index);
                    uploadedFiles.splice(idx, 1);
                    filePreview.innerHTML = '';
                    uploadedFiles.forEach((f2, i2) => {
                        const newTag2 = document.createElement('div');
                        newTag2.className = 'file-tag';
                        newTag2.innerHTML = `
                            📎 ${f2.name} (${(f2.size / 1024).toFixed(0)}KB)
                            <span class="remove-file" data-index="${i2}">×</span>
                        `;
                        filePreview.appendChild(newTag2);
                        newTag2.querySelector('.remove-file').addEventListener('click', (e) => {
                            const idx = parseInt(e.target.dataset.index);
                            uploadedFiles.splice(idx, 1);
                            filePreview.innerHTML = '';
                            // Re-render semua
                            uploadedFiles.forEach((f3, i3) => {
                                const tag3 = document.createElement('div');
                                tag3.className = 'file-tag';
                                tag3.innerHTML = `
                                    📎 ${f3.name} (${(f3.size / 1024).toFixed(0)}KB)
                                    <span class="remove-file" data-index="${i3}">×</span>
                                `;
                                filePreview.appendChild(tag3);
                                tag3.querySelector('.remove-file').addEventListener('click', (e) => {
                                    const idx = parseInt(e.target.dataset.index);
                                    uploadedFiles.splice(idx, 1);
                                    filePreview.innerHTML = '';
                                    // Re-render lagi...
                                    // Simpel: reload file input
                                    handleFileUpload(e);
                                });
                            });
                        });
                    });
                });
            });
        });
    });
    fileInput.value = '';
}

// Auto-resize textarea
messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
});
