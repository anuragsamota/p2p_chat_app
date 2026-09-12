/**
 * PeerWave - Modern P2P WebRTC Chat Application
 * PeerJS Mesh Architecture with Structured Messaging, File Transfer, and Real-time Presence
 */

// ==========================================
// 1. Constants & Configuration
// ==========================================
const CONFIG = {
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ],
    STORAGE_KEYS: {
        USERNAME: 'peerwave_username',
        THEME: 'peerwave_theme',
        SOUND: 'peerwave_sound_enabled'
    },
    MAX_FILE_SIZE_MB: 20, // WebRTC DataChannel limit recommendation
    DEFAULT_THEME: 'night'
};

const AVATAR_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
    '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'
];

// ==========================================
// 2. Application State
// ==========================================
const state = {
    peer: null,
    myId: null,
    user: {
        name: localStorage.getItem(CONFIG.STORAGE_KEYS.USERNAME) || generateDefaultUsername(),
        avatarColor: getRandomColor()
    },
    // Map of peerId -> { connection, name, avatarColor, isTyping }
    peers: new Map(),
    // Message history
    messages: [],
    pendingFile: null,
    soundEnabled: localStorage.getItem(CONFIG.STORAGE_KEYS.SOUND) !== 'false',
    localTypingTimeout: null,
    audioCtx: null
};

// ==========================================
// 3. DOM Elements
// ==========================================
const DOM = {
    // Navbar
    connStatusIndicator: document.getElementById('conn-status-indicator'),
    connStatusText: document.getElementById('conn-status-text'),
    peerCountText: document.getElementById('peer-count-text'),
    soundToggleBtn: document.getElementById('sound-toggle-btn'),
    soundOnIcon: document.getElementById('sound-on-icon'),
    soundOffIcon: document.getElementById('sound-off-icon'),
    profileEditBtn: document.getElementById('profile-edit-btn'),
    userAvatarPill: document.getElementById('user-avatar-pill'),
    userNameDisplay: document.getElementById('user-name-display'),
    mobileMenuBtn: document.getElementById('mobile-menu-btn'),

    // Sidebar & Drawer
    sidebarPanel: document.getElementById('sidebar-panel'),
    sidebarBackdrop: document.getElementById('sidebar-backdrop'),
    sidebarCloseBtn: document.getElementById('sidebar-close-btn'),
    connId: document.getElementById('conn-id'),
    myPeerStatus: document.getElementById('my-peer-status'),
    copyBtn: document.getElementById('copy-btn'),
    shareLinkBtn: document.getElementById('share-link-btn'),
    showQrBtn: document.getElementById('show-qr-btn'),
    connectForm: document.getElementById('connect-form'),
    peerIdInput: document.getElementById('peers-id-inp'),
    pasteIdBtn: document.getElementById('paste-id-btn'),
    joinPeerBtn: document.getElementById('join-peer-btn'),
    joinBtnSpinner: document.getElementById('join-btn-spinner'),
    joinBtnText: document.getElementById('join-btn-text'),
    connectedPeers: document.getElementById('connected-peers'),
    noPeersPlaceholder: document.getElementById('no-peers-placeholder'),
    activePeersPill: document.getElementById('active-peers-pill'),
    exportChatBtn: document.getElementById('export-chat-btn'),
    clearChatBtn: document.getElementById('clear-chat-btn'),

    // Main Chat
    chatDiv: document.getElementById('chat-div'),
    emptyChatState: document.getElementById('empty-chat-state'),
    emptyInviteBtn: document.getElementById('empty-invite-btn'),
    scrollBottomBtn: document.getElementById('scroll-bottom-btn'),
    typingIndicator: document.getElementById('typing-indicator'),
    fileDropzone: document.getElementById('file-dropzone'),

    // Input Bar
    filePreviewBar: document.getElementById('file-preview-bar'),
    filePreviewName: document.getElementById('file-preview-name'),
    filePreviewSize: document.getElementById('file-preview-size'),
    fileCancelBtn: document.getElementById('file-cancel-btn'),
    fileInput: document.getElementById('file-inp'),
    attachFileBtn: document.getElementById('attach-file-btn'),
    messageInput: document.getElementById('msg-inp'),
    sendMessageBtn: document.getElementById('send-msg-btn'),

    // Modals
    qrModal: document.getElementById('qr-modal'),
    qrcodeContainer: document.getElementById('qrcode-container'),
    profileModal: document.getElementById('profile-modal'),
    profileForm: document.getElementById('profile-form'),
    profileNameInp: document.getElementById('profile-name-inp'),
    profileCancelBtn: document.getElementById('profile-cancel-btn'),
    imageModal: document.getElementById('image-modal'),
    modalImagePreview: document.getElementById('modal-image-preview'),

    // Toasts
    toastContainer: document.getElementById('toast-container')
};

// ==========================================
// 4. Utility Functions
// ==========================================
function generateDefaultUsername() {
    const adjectives = ['Swift', 'Bright', 'Cosmic', 'Silent', 'Cyber', 'Neon', 'Echo', 'Solar'];
    const nouns = ['Fox', 'Falcon', 'Wave', 'Pioneer', 'Spark', 'Knight', 'Orbit', 'Drifter'];
    const randAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randNum = Math.floor(100 + Math.random() * 900);
    return `${randAdj}${randNoun}_${randNum}`;
}

function getRandomColor() {
    return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length > 1) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function generateUUID() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
}

// ==========================================
// 5. Sound Synthesizer (Web Audio API)
// ==========================================
function initAudio() {
    if (!state.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            state.audioCtx = new AudioContext();
        }
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
    }
}

function playSound(type = 'message') {
    if (!state.soundEnabled) return;
    try {
        initAudio();
        if (!state.audioCtx) return;

        const ctx = state.audioCtx;
        const now = ctx.currentTime;

        if (type === 'message') {
            // Pleasant double chime for incoming message
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();

            osc1.type = 'sine';
            osc2.type = 'sine';

            osc1.frequency.setValueAtTime(587.33, now); // D5
            osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

            osc2.frequency.setValueAtTime(880, now + 0.15);
            osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.3); // D6

            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);

            osc1.start(now);
            osc1.stop(now + 0.15);
            osc2.start(now + 0.15);
            osc2.stop(now + 0.35);
        } else if (type === 'send') {
            // Soft pop for sent message
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(320, now);
            osc.frequency.exponentialRampToValueAtTime(640, now + 0.08);

            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.09);
        } else if (type === 'join') {
            // Warm upward chord for peer joined
            const freqs = [440, 554.37, 659.25]; // A major
            freqs.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + idx * 0.08);

                gain.gain.setValueAtTime(0.06, now + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(now + idx * 0.08);
                osc.stop(now + idx * 0.08 + 0.25);
            });
        }
    } catch (e) {
        console.warn('Audio playback error:', e);
    }
}

// ==========================================
// 6. Toast Notifications
// ==========================================
function showToast(message, type = 'info', duration = 3200) {
    const alertColors = {
        info: 'alert-info',
        success: 'alert-success',
        warning: 'alert-warning',
        error: 'alert-error'
    };

    const toast = document.createElement('div');
    toast.className = `alert ${alertColors[type] || 'alert-info'} shadow-lg py-2 px-3 text-xs flex items-center gap-2 pointer-events-auto animate-message max-w-sm`;
    
    // Icon
    let iconSvg = '';
    if (type === 'success') {
        iconSvg = '<svg class="w-4 h-4 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
    } else if (type === 'error') {
        iconSvg = '<svg class="w-4 h-4 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
    } else {
        iconSvg = '<svg class="w-4 h-4 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
    }

    toast.innerHTML = `${iconSvg}<span class="truncate font-medium">${escapeHtml(message)}</span>`;
    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ==========================================
// 7. PeerJS Core & WebRTC Mesh Engine
// ==========================================
function initializePeer() {
    updateConnectionStatus('connecting', 'Connecting...');
    
    try {
        state.peer = new Peer({
            config: {
                iceServers: CONFIG.ICE_SERVERS
            },
            debug: 1
        });

        // Peer opened and received local ID
        state.peer.on('open', (id) => {
            state.myId = id;
            DOM.connId.innerText = id;
            DOM.copyBtn.disabled = false;
            DOM.shareLinkBtn.disabled = false;
            DOM.showQrBtn.disabled = false;
            updateConnectionStatus('ready', 'Online');
            DOM.myPeerStatus.innerText = 'online';
            DOM.myPeerStatus.className = 'badge badge-xs badge-success';
            
            showToast('Connected to P2P network!', 'success');

            // Check if invited via URL query param
            checkForInviteParam();
        });

        // Incoming connection from a remote peer
        state.peer.on('connection', (connection) => {
            handleNewConnection(connection);
        });

        // Peer disconnected from signaling server (can still communicate with existing peers)
        state.peer.on('disconnected', () => {
            updateConnectionStatus('disconnected', 'Reconnecting...');
            DOM.myPeerStatus.innerText = 'reconnecting';
            DOM.myPeerStatus.className = 'badge badge-xs badge-warning';
            // Attempt auto-reconnect to signaling server
            setTimeout(() => {
                if (state.peer && !state.peer.destroyed) {
                    state.peer.reconnect();
                }
            }, 3000);
        });

        // Critical error handling
        state.peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            setJoinButtonLoading(false);
            
            if (err.type === 'peer-unavailable') {
                showToast('Peer not found. Check the ID and try again.', 'error');
            } else if (err.type === 'unavailable-id') {
                showToast('Peer ID already in use.', 'error');
            } else if (err.type === 'network' || err.type === 'server-error') {
                updateConnectionStatus('error', 'Network Error');
                showToast('Signaling server error. Reconnecting...', 'error');
            } else {
                showToast(`P2P error: ${err.message || err.type}`, 'error');
            }
        });

    } catch (err) {
        console.error('Failed to initialize PeerJS:', err);
        updateConnectionStatus('error', 'Init Failed');
        showToast('WebRTC is not supported or was blocked.', 'error');
    }
}

function updateConnectionStatus(status, text) {
    DOM.connStatusText.innerText = text;
    if (status === 'ready') {
        DOM.connStatusIndicator.className = 'w-2.5 h-2.5 rounded-full bg-success';
    } else if (status === 'connecting' || status === 'disconnected') {
        DOM.connStatusIndicator.className = 'w-2.5 h-2.5 rounded-full bg-warning animate-pulse';
    } else {
        DOM.connStatusIndicator.className = 'w-2.5 h-2.5 rounded-full bg-error';
    }
}

// Connect to an external peer ID
function connectToRemotePeer(targetId) {
    targetId = targetId.trim();

    // If a full invite link was pasted, extract the ?join= parameter
    if (targetId.includes('?join=')) {
        try {
            const url = new URL(targetId);
            const joinId = url.searchParams.get('join');
            if (joinId) targetId = joinId;
        } catch (e) {
            // Not a valid URL, keep as is
        }
    }

    if (!targetId) {
        showToast('Please enter a valid Peer ID', 'warning');
        return;
    }

    if (targetId === state.myId) {
        showToast('You cannot connect to your own Peer ID', 'warning');
        return;
    }

    if (state.peers.has(targetId)) {
        showToast('Already connected to this peer', 'info');
        return;
    }

    setJoinButtonLoading(true);

    try {
        const connection = state.peer.connect(targetId, {
            reliable: true
        });

        handleNewConnection(connection, true);

        // Connection timeout failsafe
        const timeout = setTimeout(() => {
            if (!state.peers.has(targetId) || !state.peers.get(targetId).isOpen) {
                setJoinButtonLoading(false);
            }
        }, 8000);

        connection.on('open', () => clearTimeout(timeout));
    } catch (err) {
        console.error('Error connecting to peer:', err);
        setJoinButtonLoading(false);
        showToast('Failed to initiate connection', 'error');
    }
}

// Attach lifecycle events to a DataConnection
function handleNewConnection(connection, isInitiator = false) {
    const peerId = connection.peer;

    // Guard against duplicate handling
    if (state.peers.has(peerId) && state.peers.get(peerId).connection === connection) {
        return;
    }

    const peerData = {
        connection: connection,
        name: 'Peer_' + peerId.slice(0, 4),
        avatarColor: getRandomColor(),
        isOpen: false,
        isTyping: false
    };

    state.peers.set(peerId, peerData);

    // When connection is opened
    connection.on('open', () => {
        peerData.isOpen = true;
        setJoinButtonLoading(false);
        DOM.peerIdInput.value = '';

        // Handshake: exchange user info
        sendPayloadToPeer(connection, {
            type: 'HANDSHAKE',
            name: state.user.name,
            avatarColor: state.user.avatarColor
        });

        playSound('join');
        showToast(`Connected to ${peerData.name}!`, 'success');
        addSystemMessage(`${peerData.name} joined the chat`);
        renderPeersList();
    });

    // When data is received
    connection.on('data', (data) => {
        handleIncomingData(peerId, data);
    });

    // When connection is closed
    connection.on('close', () => {
        cleanupPeer(peerId, `${peerData.name} disconnected`);
    });

    // When connection encounters error
    connection.on('error', (err) => {
        console.warn(`Connection error with ${peerId}:`, err);
        cleanupPeer(peerId, `Lost connection to ${peerData.name}`);
    });
}

function cleanupPeer(peerId, reason = '') {
    if (state.peers.has(peerId)) {
        const p = state.peers.get(peerId);
        state.peers.delete(peerId);
        if (reason) {
            addSystemMessage(reason);
            showToast(reason, 'info');
        }
        renderPeersList();
        updateTypingIndicator();
    }
}

function setJoinButtonLoading(isLoading) {
    if (isLoading) {
        DOM.joinBtnSpinner.classList.remove('hidden');
        DOM.joinBtnText.innerText = 'Connecting...';
        DOM.joinPeerBtn.disabled = true;
    } else {
        DOM.joinBtnSpinner.classList.add('hidden');
        DOM.joinBtnText.innerText = 'Connect to Peer';
        DOM.joinPeerBtn.disabled = false;
    }
}

// Broadcast payload to all open peer connections
function broadcastPayload(payload) {
    state.peers.forEach((peer) => {
        if (peer.isOpen && peer.connection.open) {
            try {
                peer.connection.send(payload);
            } catch (err) {
                console.error(`Failed to send to ${peer.name}:`, err);
            }
        }
    });
}

function sendPayloadToPeer(connection, payload) {
    if (connection && connection.open) {
        try {
            connection.send(payload);
        } catch (err) {
            console.error('Failed to send payload:', err);
        }
    }
}

// ==========================================
// 8. Message Protocol & Handling
// ==========================================
function handleIncomingData(senderId, data) {
    if (!data || typeof data !== 'object') {
        // Fallback for legacy raw string messages
        data = { type: 'CHAT', text: String(data), timestamp: Date.now() };
    }

    const peer = state.peers.get(senderId);
    const senderName = (peer && peer.name) || 'Peer_' + senderId.slice(0, 4);
    const avatarColor = (peer && peer.avatarColor) || '#3b82f6';

    switch (data.type) {
        case 'HANDSHAKE':
            if (data.name) peer.name = data.name;
            if (data.avatarColor) peer.avatarColor = data.avatarColor;
            renderPeersList();
            break;

        case 'PROFILE_UPDATE':
            if (data.name) {
                const oldName = peer.name;
                peer.name = data.name;
                if (data.avatarColor) peer.avatarColor = data.avatarColor;
                renderPeersList();
                addSystemMessage(`${oldName} changed name to ${data.name}`);
            }
            break;

        case 'CHAT':
            peer.isTyping = false;
            updateTypingIndicator();
            appendChatMessage({
                id: data.id || generateUUID(),
                isSelf: false,
                senderId: senderId,
                senderName: senderName,
                avatarColor: avatarColor,
                text: data.text,
                timestamp: data.timestamp || Date.now(),
                reactions: {}
            });
            playSound('message');
            break;

        case 'FILE':
            peer.isTyping = false;
            updateTypingIndicator();
            appendFileMessage({
                id: data.id || generateUUID(),
                isSelf: false,
                senderId: senderId,
                senderName: senderName,
                avatarColor: avatarColor,
                fileName: data.fileName,
                fileType: data.fileType,
                fileSize: data.fileSize,
                fileData: data.fileData,
                timestamp: data.timestamp || Date.now(),
                reactions: {}
            });
            playSound('message');
            break;

        case 'TYPING':
            peer.isTyping = Boolean(data.isTyping);
            updateTypingIndicator();
            break;

        case 'REACTION':
            handleIncomingReaction(data.messageId, data.emoji, senderName);
            break;

        default:
            console.log('Unknown message type received:', data.type);
    }
}

// Send current text message or file
function handleSendMessage() {
    initAudio();
    const text = DOM.messageInput.value.trim();

    // Check if we have a pending file to send
    if (state.pendingFile) {
        sendFile(state.pendingFile);
        clearPendingFile();
    }

    if (!text) return;

    if (state.peers.size === 0) {
        showToast('No peers connected. Connect with someone to chat!', 'warning');
    }

    const messageObj = {
        type: 'CHAT',
        id: generateUUID(),
        text: text,
        timestamp: Date.now()
    };

    // Broadcast to peers
    broadcastPayload(messageObj);

    // Stop typing indicator
    broadcastTyping(false);

    // Append to local chat
    appendChatMessage({
        id: messageObj.id,
        isSelf: true,
        senderId: state.myId,
        senderName: state.user.name,
        avatarColor: state.user.avatarColor,
        text: text,
        timestamp: messageObj.timestamp,
        reactions: {}
    });

    playSound('send');
    DOM.messageInput.value = '';
    DOM.messageInput.focus();
}

function sendFile(file) {
    if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) {
        showToast(`File is too large! Maximum allowed is ${CONFIG.MAX_FILE_SIZE_MB}MB.`, 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const base64Data = e.target.result;
        const messageObj = {
            type: 'FILE',
            id: generateUUID(),
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            fileData: base64Data,
            timestamp: Date.now()
        };

        // Broadcast file to peers
        broadcastPayload(messageObj);

        // Render in self chat
        appendFileMessage({
            id: messageObj.id,
            isSelf: true,
            senderId: state.myId,
            senderName: state.user.name,
            avatarColor: state.user.avatarColor,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            fileData: base64Data,
            timestamp: messageObj.timestamp,
            reactions: {}
        });

        playSound('send');
    };

    reader.readAsDataURL(file);
}

// ==========================================
// 9. UI Rendering & Chat View
// ==========================================
function appendChatMessage(msg) {
    hideEmptyChatState();
    state.messages.push(msg);

    const isSelf = msg.isSelf;
    const timeStr = formatTime(msg.timestamp);
    const bubbleClass = isSelf ? 'chat-bubble-primary' : 'chat-bubble-secondary';
    const chatAlignment = isSelf ? 'chat-end' : 'chat-start';
    const initial = getInitials(msg.senderName);

    const msgElement = document.createElement('div');
    msgElement.className = `chat ${chatAlignment} animate-message group`;
    msgElement.dataset.messageId = msg.id;

    msgElement.innerHTML = `
        <div class="chat-image avatar placeholder">
            <div class="w-8 h-8 rounded-full text-white font-bold text-xs shadow-sm flex items-center justify-center" style="background-color: ${msg.avatarColor}">
                <span>${escapeHtml(initial)}</span>
            </div>
        </div>
        <div class="chat-header text-[11px] opacity-70 mb-1 flex items-center gap-1.5">
            <span class="font-semibold">${escapeHtml(msg.senderName)}</span>
            <time class="text-[10px] opacity-60">${timeStr}</time>
        </div>
        <div class="chat-bubble ${bubbleClass} text-sm break-words max-w-[85%] sm:max-w-md shadow-sm relative">
            <div class="chat-text-content select-text">${escapeHtml(msg.text)}</div>
            <!-- Reaction Badges -->
            <div class="reactions-wrapper flex flex-wrap gap-1 mt-1 empty:hidden"></div>
        </div>
        <div class="chat-footer opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex items-center gap-1">
            <button class="btn btn-ghost btn-circle btn-xs hover:bg-base-200" onclick="toggleReactionPicker('${msg.id}')" title="React with emoji">
                <span class="text-xs">😀</span>
            </button>
        </div>
    `;

    DOM.chatDiv.appendChild(msgElement);
    smartScrollToBottom();
}

function appendFileMessage(msg) {
    hideEmptyChatState();
    state.messages.push(msg);

    const isSelf = msg.isSelf;
    const timeStr = formatTime(msg.timestamp);
    const bubbleClass = isSelf ? 'chat-bubble-primary' : 'chat-bubble-secondary';
    const chatAlignment = isSelf ? 'chat-end' : 'chat-start';
    const initial = getInitials(msg.senderName);
    const isImage = msg.fileType && msg.fileType.startsWith('image/');

    const msgElement = document.createElement('div');
    msgElement.className = `chat ${chatAlignment} animate-message group`;
    msgElement.dataset.messageId = msg.id;

    let contentHtml = '';

    if (isImage) {
        contentHtml = `
            <div class="p-1">
                <img src="${msg.fileData}" alt="${escapeHtml(msg.fileName)}" class="rounded-lg max-h-60 max-w-full object-cover cursor-pointer hover:opacity-95 transition-opacity shadow" onclick="openImageLightbox('${msg.fileData}')" />
                <div class="flex items-center justify-between mt-2 pt-1 border-t border-base-content/10 text-xs">
                    <span class="truncate max-w-[160px] opacity-80">${escapeHtml(msg.fileName)}</span>
                    <a href="${msg.fileData}" download="${escapeHtml(msg.fileName)}" class="btn btn-ghost btn-xs gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Save
                    </a>
                </div>
            </div>
        `;
    } else {
        contentHtml = `
            <div class="flex items-center gap-3 p-1">
                <div class="w-10 h-10 rounded-lg bg-base-300/40 flex items-center justify-center shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                </div>
                <div class="flex flex-col min-w-0">
                    <span class="font-medium text-xs truncate max-w-[180px]">${escapeHtml(msg.fileName)}</span>
                    <span class="text-[10px] opacity-70">${formatFileSize(msg.fileSize)}</span>
                </div>
                <a href="${msg.fileData}" download="${escapeHtml(msg.fileName)}" class="btn btn-circle btn-xs btn-ghost border border-base-content/20 ml-1" title="Download File">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                </a>
            </div>
        `;
    }

    msgElement.innerHTML = `
        <div class="chat-image avatar placeholder">
            <div class="w-8 h-8 rounded-full text-white font-bold text-xs shadow-sm flex items-center justify-center" style="background-color: ${msg.avatarColor}">
                <span>${escapeHtml(initial)}</span>
            </div>
        </div>
        <div class="chat-header text-[11px] opacity-70 mb-1 flex items-center gap-1.5">
            <span class="font-semibold">${escapeHtml(msg.senderName)}</span>
            <time class="text-[10px] opacity-60">${timeStr}</time>
        </div>
        <div class="chat-bubble ${bubbleClass} text-sm break-words max-w-[85%] sm:max-w-md shadow-sm relative">
            ${contentHtml}
            <div class="reactions-wrapper flex flex-wrap gap-1 mt-1 empty:hidden"></div>
        </div>
        <div class="chat-footer opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex items-center gap-1">
            <button class="btn btn-ghost btn-circle btn-xs hover:bg-base-200" onclick="toggleReactionPicker('${msg.id}')" title="React with emoji">
                <span class="text-xs">😀</span>
            </button>
        </div>
    `;

    DOM.chatDiv.appendChild(msgElement);
    smartScrollToBottom();
}

function addSystemMessage(text) {
    hideEmptyChatState();
    const elem = document.createElement('div');
    elem.className = 'flex justify-center my-2 animate-message';
    elem.innerHTML = `
        <span class="badge badge-neutral badge-sm text-[11px] py-2 px-3 opacity-75 font-normal tracking-wide">
            ${escapeHtml(text)}
        </span>
    `;
    DOM.chatDiv.appendChild(elem);
    smartScrollToBottom();
}

function hideEmptyChatState() {
    if (DOM.emptyChatState) {
        DOM.emptyChatState.classList.add('hidden');
    }
}

// Reactions handling
window.toggleReactionPicker = function(messageId) {
    const emojis = ['👍', '❤️', '😂', '🎉', '🔥', '🚀'];
    // Show a small inline popup or toggle standard emoji
    const picker = document.createElement('div');
    picker.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[1px]';
    picker.onclick = (e) => {
        if (e.target === picker) picker.remove();
    };

    const box = document.createElement('div');
    box.className = 'bg-base-200 p-2 rounded-2xl shadow-xl border border-base-300 flex gap-2 animate-message';

    emojis.forEach((emoji) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-circle btn-sm hover:scale-125 transition-transform text-base';
        btn.innerText = emoji;
        btn.onclick = () => {
            sendReaction(messageId, emoji);
            picker.remove();
        };
        box.appendChild(btn);
    });

    picker.appendChild(box);
    document.body.appendChild(picker);
};

function sendReaction(messageId, emoji) {
    const msg = state.messages.find(m => m.id === messageId);
    if (!msg) return;

    // Broadcast reaction
    broadcastPayload({
        type: 'REACTION',
        messageId: messageId,
        emoji: emoji
    });

    applyReactionToUI(messageId, emoji, state.user.name);
}

function handleIncomingReaction(messageId, emoji, senderName) {
    applyReactionToUI(messageId, emoji, senderName);
}

function applyReactionToUI(messageId, emoji, senderName) {
    const msgCard = DOM.chatDiv.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgCard) return;

    const reactionsWrapper = msgCard.querySelector('.reactions-wrapper');
    if (!reactionsWrapper) return;

    let existingBadge = reactionsWrapper.querySelector(`[data-emoji="${emoji}"]`);
    if (existingBadge) {
        const countSpan = existingBadge.querySelector('.reaction-count');
        const currentCount = parseInt(countSpan.innerText, 10) || 1;
        countSpan.innerText = currentCount + 1;
    } else {
        const badge = document.createElement('span');
        badge.className = 'badge badge-xs bg-base-300 border border-base-content/20 gap-1 py-1.5 px-2 cursor-pointer hover:scale-105 transition-transform';
        badge.dataset.emoji = emoji;
        badge.innerHTML = `<span>${emoji}</span> <span class="reaction-count text-[10px] font-bold">1</span>`;
        reactionsWrapper.appendChild(badge);
    }
}

// Lightbox for full size image viewing
window.openImageLightbox = function(src) {
    DOM.modalImagePreview.src = src;
    DOM.imageModal.showModal();
};

// Render the connected peers list in the sidebar
function renderPeersList() {
    DOM.connectedPeers.innerHTML = '';
    const count = state.peers.size;

    DOM.peerCountText.innerText = `${count} connected`;
    DOM.activePeersPill.innerText = count;

    if (count === 0) {
        DOM.connectedPeers.appendChild(DOM.noPeersPlaceholder);
        return;
    }

    state.peers.forEach((peer, peerId) => {
        const item = document.createElement('div');
        item.className = 'card bg-base-100 p-2.5 shadow-sm border border-base-300 flex flex-row items-center justify-between gap-2';

        const initial = getInitials(peer.name);

        item.innerHTML = `
            <div class="flex items-center gap-2 min-w-0">
                <div class="w-7 h-7 rounded-full text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm" style="background-color: ${peer.avatarColor}">
                    <span>${escapeHtml(initial)}</span>
                </div>
                <div class="flex flex-col min-w-0">
                    <span class="text-xs font-semibold truncate leading-tight">${escapeHtml(peer.name)}</span>
                    <span class="font-mono text-[10px] opacity-50 truncate leading-tight">${peerId.slice(0, 8)}...</span>
                </div>
            </div>
            <div class="flex items-center gap-1">
                <button class="btn btn-ghost btn-circle btn-xs text-base-content/60 hover:text-primary" onclick="copyPeerId('${peerId}')" title="Copy Peer ID">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                </button>
                <button class="btn btn-ghost btn-circle btn-xs text-error/60 hover:text-error" onclick="disconnectPeer('${peerId}')" title="Disconnect Peer">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        `;

        DOM.connectedPeers.appendChild(item);
    });
}

window.copyPeerId = function(id) {
    navigator.clipboard.writeText(id).then(() => {
        showToast('Peer ID copied to clipboard', 'info');
    });
};

window.disconnectPeer = function(id) {
    if (state.peers.has(id)) {
        const peer = state.peers.get(id);
        if (peer.connection) peer.connection.close();
        cleanupPeer(id, `Disconnected from ${peer.name}`);
    }
};

// Typing indicator update
function updateTypingIndicator() {
    const typingNames = [];
    state.peers.forEach((peer) => {
        if (peer.isTyping) {
            typingNames.push(peer.name);
        }
    });

    if (typingNames.length === 0) {
        DOM.typingIndicator.innerHTML = '';
        DOM.typingIndicator.style.opacity = '0';
        return;
    }

    let text = '';
    if (typingNames.length === 1) {
        text = `${escapeHtml(typingNames[0])} is typing`;
    } else if (typingNames.length === 2) {
        text = `${escapeHtml(typingNames[0])} and ${escapeHtml(typingNames[1])} are typing`;
    } else {
        text = 'Multiple people are typing';
    }

    DOM.typingIndicator.innerHTML = `
        <span>${text}</span>
        <span class="inline-flex gap-0.5 ml-1">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </span>
    `;
    DOM.typingIndicator.style.opacity = '1';
}

function handleTypingInput() {
    broadcastTyping(true);

    if (state.localTypingTimeout) {
        clearTimeout(state.localTypingTimeout);
    }

    state.localTypingTimeout = setTimeout(() => {
        broadcastTyping(false);
    }, 2500);
}

function broadcastTyping(isTyping) {
    broadcastPayload({
        type: 'TYPING',
        isTyping: isTyping
    });
}

// Auto scroll management
function smartScrollToBottom() {
    const threshold = 120;
    const isNearBottom = DOM.chatDiv.scrollHeight - DOM.chatDiv.scrollTop - DOM.chatDiv.clientHeight <= threshold;

    if (isNearBottom) {
        DOM.chatDiv.scrollTo({
            top: DOM.chatDiv.scrollHeight,
            behavior: 'smooth'
        });
        DOM.scrollBottomBtn.classList.add('hidden');
    } else {
        DOM.scrollBottomBtn.classList.remove('hidden');
    }
}

// ==========================================
// 10. File Drop & Attachment Handling
// ==========================================
function setupFileHandling() {
    // Attach button triggers file input
    DOM.attachFileBtn.addEventListener('click', () => {
        DOM.fileInput.click();
    });

    // File selected via input
    DOM.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            setPendingFile(e.target.files[0]);
        }
    });

    // Cancel selected file
    DOM.fileCancelBtn.addEventListener('click', () => {
        clearPendingFile();
    });

    // Drag and drop events on document/main chat
    const dropzone = DOM.fileDropzone;

    ['dragenter', 'dragover'].forEach(eventName => {
        window.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('hidden');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        window.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.target === dropzone || eventName === 'drop') {
                dropzone.classList.add('hidden');
            }
        });
    });

    window.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setPendingFile(e.dataTransfer.files[0]);
        }
    });
}

function setPendingFile(file) {
    state.pendingFile = file;
    DOM.filePreviewName.innerText = file.name;
    DOM.filePreviewSize.innerText = `(${formatFileSize(file.size)})`;
    DOM.filePreviewBar.classList.remove('hidden');
    DOM.filePreviewBar.classList.add('flex');
    DOM.messageInput.focus();
}

function clearPendingFile() {
    state.pendingFile = null;
    DOM.fileInput.value = '';
    DOM.filePreviewBar.classList.add('hidden');
    DOM.filePreviewBar.classList.remove('flex');
}

// ==========================================
// 11. Sharing, Links & QR Code
// ==========================================
function getInviteLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('join', state.myId);
    return url.toString();
}

function checkForInviteParam() {
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get('join');
    if (joinId && joinId !== state.myId) {
        DOM.peerIdInput.value = joinId;
        showToast(`Found invite for peer ${joinId.slice(0, 6)}... Connecting!`, 'info');
        connectToRemotePeer(joinId);
    }
}

function showQRCodeModal() {
    if (!state.myId) {
        showToast('Waiting for Peer ID...', 'warning');
        return;
    }

    const inviteUrl = getInviteLink();
    DOM.qrcodeContainer.innerHTML = '';

    if (window.QRCode) {
        new QRCode(DOM.qrcodeContainer, {
            text: inviteUrl,
            width: 180,
            height: 180,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    } else {
        DOM.qrcodeContainer.innerHTML = `
            <div class="text-xs text-base-content/80 p-4">
                <p class="font-mono break-all">${inviteUrl}</p>
            </div>
        `;
    }

    DOM.qrModal.showModal();
}

// ==========================================
// 12. User Profile Management
// ==========================================
function updateUserProfileUI() {
    DOM.userNameDisplay.innerText = state.user.name;
    DOM.userAvatarPill.innerText = getInitials(state.user.name);
    DOM.userAvatarPill.style.backgroundColor = state.user.avatarColor;
}

function handleSaveProfile(e) {
    e.preventDefault();
    const newName = DOM.profileNameInp.value.trim();
    if (!newName) return;

    state.user.name = newName;
    localStorage.setItem(CONFIG.STORAGE_KEYS.USERNAME, newName);
    updateUserProfileUI();

    // Broadcast updated profile to all connected peers
    broadcastPayload({
        type: 'PROFILE_UPDATE',
        name: state.user.name,
        avatarColor: state.user.avatarColor
    });

    DOM.profileModal.close();
    showToast('Profile updated!', 'success');
}

// ==========================================
// 13. Chat Export & Clear
// ==========================================
function exportChatHistory() {
    if (state.messages.length === 0) {
        showToast('No messages to export', 'info');
        return;
    }

    let output = `PeerWave Chat Export - ${new Date().toLocaleString()}\n`;
    output += `==============================================\n\n`;

    state.messages.forEach((msg) => {
        const time = formatTime(msg.timestamp);
        if (msg.text) {
            output += `[${time}] ${msg.senderName}: ${msg.text}\n`;
        } else if (msg.fileName) {
            output += `[${time}] ${msg.senderName} sent file: ${msg.fileName} (${formatFileSize(msg.fileSize)})\n`;
        }
    });

    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `peerwave_chat_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Chat exported successfully', 'success');
}

function clearChat() {
    if (confirm('Are you sure you want to clear the chat messages?')) {
        state.messages = [];
        DOM.chatDiv.innerHTML = '';
        if (DOM.emptyChatState) {
            DOM.emptyChatState.classList.remove('hidden');
            DOM.chatDiv.appendChild(DOM.emptyChatState);
        }
        showToast('Chat cleared', 'info');
    }
}

// ==========================================
// 14. Theme & Sound Preferences
// ==========================================
function initTheme() {
    const savedTheme = localStorage.getItem(CONFIG.STORAGE_KEYS.THEME) || CONFIG.DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', savedTheme);

    document.querySelectorAll('.theme-select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem(CONFIG.STORAGE_KEYS.THEME, theme);
            // Close dropdown if open
            if (document.activeElement) document.activeElement.blur();
        });
    });
}

function updateSoundUI() {
    if (state.soundEnabled) {
        DOM.soundOnIcon.classList.remove('hidden');
        DOM.soundOffIcon.classList.add('hidden');
    } else {
        DOM.soundOnIcon.classList.add('hidden');
        DOM.soundOffIcon.classList.remove('hidden');
    }
}

function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem(CONFIG.STORAGE_KEYS.SOUND, state.soundEnabled);
    updateSoundUI();
    showToast(state.soundEnabled ? 'Sound enabled' : 'Sound muted', 'info');
    if (state.soundEnabled) {
        playSound('message');
    }
}

// ==========================================
// 15. Event Listeners & Initialization
// ==========================================
function setupEventListeners() {
    // User interaction starts Web Audio context
    ['click', 'keydown'].forEach(evt => {
        window.addEventListener(evt, () => initAudio(), { once: true });
    });

    // Copy ID button
    DOM.copyBtn.addEventListener('click', () => {
        if (!state.myId) return;
        navigator.clipboard.writeText(state.myId).then(() => {
            showToast('Peer ID copied to clipboard!', 'success');
        });
    });

    // Share link button
    DOM.shareLinkBtn.addEventListener('click', () => {
        if (!state.myId) return;
        const link = getInviteLink();
        navigator.clipboard.writeText(link).then(() => {
            showToast('Invite link copied to clipboard!', 'success');
        });
    });

    // Empty state invite button
    if (DOM.emptyInviteBtn) {
        DOM.emptyInviteBtn.addEventListener('click', () => {
            if (!state.myId) {
                showToast('Still connecting to network...', 'warning');
                return;
            }
            navigator.clipboard.writeText(getInviteLink()).then(() => {
                showToast('Invite link copied to clipboard!', 'success');
            });
        });
    }

    // QR Code button
    DOM.showQrBtn.addEventListener('click', showQRCodeModal);

    // Paste ID button
    DOM.pasteIdBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                DOM.peerIdInput.value = text.trim();
                DOM.peerIdInput.focus();
            }
        } catch (e) {
            showToast('Please paste manually using Ctrl+V / Cmd+V', 'info');
        }
    });

    // Connect form submission
    DOM.connectForm.addEventListener('submit', (e) => {
        e.preventDefault();
        connectToRemotePeer(DOM.peerIdInput.value);
    });

    // Send message triggers
    DOM.sendMessageBtn.addEventListener('click', handleSendMessage);
    DOM.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Typing notification
    DOM.messageInput.addEventListener('input', handleTypingInput);

    // Scroll to bottom button
    DOM.scrollBottomBtn.addEventListener('click', () => {
        DOM.chatDiv.scrollTo({
            top: DOM.chatDiv.scrollHeight,
            behavior: 'smooth'
        });
        DOM.scrollBottomBtn.classList.add('hidden');
    });

    DOM.chatDiv.addEventListener('scroll', () => {
        const threshold = 120;
        const isNearBottom = DOM.chatDiv.scrollHeight - DOM.chatDiv.scrollTop - DOM.chatDiv.clientHeight <= threshold;
        if (isNearBottom) {
            DOM.scrollBottomBtn.classList.add('hidden');
        } else {
            DOM.scrollBottomBtn.classList.remove('hidden');
        }
    });

    // Mobile drawer toggle
    const toggleMobileDrawer = (open) => {
        if (open) {
            DOM.sidebarPanel.classList.remove('-translate-x-full');
            DOM.sidebarBackdrop.classList.remove('hidden');
        } else {
            DOM.sidebarPanel.classList.add('-translate-x-full');
            DOM.sidebarBackdrop.classList.add('hidden');
        }
    };

    DOM.mobileMenuBtn.addEventListener('click', () => toggleMobileDrawer(true));
    DOM.sidebarCloseBtn.addEventListener('click', () => toggleMobileDrawer(false));
    DOM.sidebarBackdrop.addEventListener('click', () => toggleMobileDrawer(false));

    // Profile modal
    DOM.profileEditBtn.addEventListener('click', () => {
        DOM.profileNameInp.value = state.user.name;
        DOM.profileModal.showModal();
    });
    DOM.profileForm.addEventListener('submit', handleSaveProfile);
    DOM.profileCancelBtn.addEventListener('click', () => DOM.profileModal.close());

    // Sound toggle
    DOM.soundToggleBtn.addEventListener('click', toggleSound);

    // Export & Clear
    DOM.exportChatBtn.addEventListener('click', exportChatHistory);
    DOM.clearChatBtn.addEventListener('click', clearChat);
}

// ==========================================
// 16. App Bootstrap
// ==========================================
function tryInitializePeer(retries = 15) {
    if (typeof Peer !== 'undefined') {
        initializePeer();
    } else if (retries > 0) {
        setTimeout(() => tryInitializePeer(retries - 1), 200);
    } else {
        updateConnectionStatus('error', 'Offline / CDN Error');
        showToast('PeerJS library failed to load. Check your internet connection.', 'error');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    updateSoundUI();
    updateUserProfileUI();
    setupEventListeners();
    setupFileHandling();
    tryInitializePeer();
});
