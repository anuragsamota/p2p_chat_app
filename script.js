/**
 * PeerWave - Enterprise P2P WebRTC Chat Application
 * Features:
 * - Dual-Layer Persistent Identity (Static Peer ID + Permanent User ID across sessions)
 * - 5GB+ Streaming File Transfers with Flow Control & Real-time Progress (Speed, ETA, Bytes)
 * - Rich Inline Media Previews (HTML5 Video player, Audio player, Image viewer)
 * - Universal Media Lightbox Modal (Images & Videos)
 * - Delivery Receipts (✓ Sent, ✓✓ Delivered) & Chat Date Dividers
 * - Quick Emoji Toolbar
 * - LocalStorage Chat, Contacts, Settings & Profile Persistence
 * - Online Status, Periodic Heartbeats & Last-Seen Tracking
 * - Mesh Chat Synchronization on Connection/Reconnect
 * - Full JSON Backup Export and Import
 * - Progressive Web App (PWA) with Service Worker
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
        PROFILE: 'peerwave_profile',
        SETTINGS: 'peerwave_settings',
        CHAT: 'peerwave_chat_history',
        CONTACTS: 'peerwave_contacts',
        PERSISTENT_PEER_ID: 'peerwave_persistent_peer_id'
    },
    CHUNK_SIZE: 64 * 1024, // 64 KB binary chunks
    MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024 * 1024, // 5 GB
    DEFAULT_THEME: 'night',
    HEARTBEAT_INTERVAL_MS: 12000
};

const AVATAR_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'
];

// ==========================================
// 2. Storage Service (Persistent Store)
// ==========================================
const Storage = {
    getProfile() {
        try {
            const data = localStorage.getItem('peerwave_user_profile') || localStorage.getItem(CONFIG.STORAGE_KEYS.PROFILE);
            if (data) {
                const parsed = JSON.parse(data);
                if (parsed && parsed.name) {
                    if (!parsed.userId) {
                        parsed.userId = 'usr_' + generateUUID();
                    }
                    this.saveProfile(parsed);
                    return parsed;
                }
            }
        } catch (e) {
            console.error('Error reading profile from storage:', e);
        }
        // Fallback to legacy key or default
        const legacyName = localStorage.getItem('peerwave_username');
        const defaultProfile = {
            userId: 'usr_' + generateUUID(),
            name: legacyName || generateDefaultUsername(),
            avatarColor: getRandomColor(),
            bio: 'Available for P2P messaging',
            createdAt: Date.now()
        };
        // Immediately persist to localStorage so it never changes on reload
        this.saveProfile(defaultProfile);
        return defaultProfile;
    },
    saveProfile(profile) {
        try {
            localStorage.setItem('peerwave_user_profile', JSON.stringify(profile));
            localStorage.setItem(CONFIG.STORAGE_KEYS.PROFILE, JSON.stringify(profile));
            localStorage.setItem('peerwave_username', profile.name);
        } catch (e) {
            console.error('Error saving profile to storage:', e);
        }
    },
    getPersistentPeerId() {
        let id = localStorage.getItem(CONFIG.STORAGE_KEYS.PERSISTENT_PEER_ID);
        if (!id) {
            id = 'pw_' + Math.random().toString(36).substring(2, 10);
            localStorage.setItem(CONFIG.STORAGE_KEYS.PERSISTENT_PEER_ID, id);
        }
        return id;
    },
    getSettings() {
        try {
            const data = localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS);
            if (data) return JSON.parse(data);
        } catch (e) {
            console.error('Error reading settings:', e);
        }
        return {
            theme: CONFIG.DEFAULT_THEME,
            soundEnabled: true,
            autoReconnect: true
        };
    },
    saveSettings(settings) {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
        } catch (e) {
            console.error('Error saving settings:', e);
        }
    },
    getChatHistory() {
        try {
            const data = localStorage.getItem(CONFIG.STORAGE_KEYS.CHAT);
            if (data) return JSON.parse(data);
        } catch (e) {
            console.error('Error reading chat from storage:', e);
        }
        return [];
    },
    saveChatHistory(messages) {
        try {
            const sanitized = messages.slice(-500).map(m => {
                if (m.type === 'FILE' || m.fileName) {
                    return {
                        id: m.id,
                        type: 'FILE',
                        isSelf: m.isSelf,
                        senderId: m.senderId,
                        senderUserId: m.senderUserId,
                        senderName: m.senderName,
                        avatarColor: m.avatarColor,
                        fileName: m.fileName,
                        fileType: m.fileType,
                        fileSize: m.fileSize,
                        timestamp: m.timestamp,
                        delivered: m.delivered || false,
                        reactions: m.reactions || {}
                    };
                }
                return m;
            });
            localStorage.setItem(CONFIG.STORAGE_KEYS.CHAT, JSON.stringify(sanitized));
        } catch (e) {
            console.warn('LocalStorage quota reached or storage failed:', e);
        }
    },
    getContacts() {
        try {
            const data = localStorage.getItem(CONFIG.STORAGE_KEYS.CONTACTS);
            if (data) return JSON.parse(data);
        } catch (e) {
            console.error('Error reading contacts from storage:', e);
        }
        return [];
    },
    saveContacts(contacts) {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEYS.CONTACTS, JSON.stringify(contacts));
        } catch (e) {
            console.error('Error saving contacts:', e);
        }
    }
};

// ==========================================
// 3. Application State
// ==========================================
const state = {
    peer: null,
    myId: null,
    user: Storage.getProfile(),
    settings: Storage.getSettings(),
    peers: new Map(), // Active connections: peerId -> { connection, userId, name, avatarColor, bio, isTyping }
    contacts: Storage.getContacts(), // Persistent contacts: [{ id, userId, name, avatarColor, bio, lastSeen, isOnline }]
    messages: Storage.getChatHistory(),
    transfers: new Map(), // Streaming transfers
    pendingFile: null,
    localTypingTimeout: null,
    audioCtx: null,
    activeTab: 'active',
    lastRenderedDate: null,
    activeCall: null,
    incomingCall: null,
    callAudioInterval: null,
    voiceRecorder: null
};

Storage.saveProfile(state.user);
Storage.saveSettings(state.settings);

// ==========================================
// 4. DOM Elements
// ==========================================
const DOM = {
    // Clean Header (Connected Peer Focus)
    mobileMenuBtn: document.getElementById('mobile-menu-btn'),
    headerPeerCard: document.getElementById('header-peer-card'),
    headerPeerAvatar: document.getElementById('header-peer-avatar'),
    headerPeerStatusDot: document.getElementById('header-peer-status-dot'),
    headerPeerName: document.getElementById('header-peer-name'),
    headerPeerStatusText: document.getElementById('header-peer-status-text'),
    voiceCallHeaderBtn: document.getElementById('voice-call-header-btn'),
    videoCallHeaderBtn: document.getElementById('video-call-header-btn'),
    syncNowHeaderBtn: document.getElementById('sync-now-header-btn'),

    // Dropdown Menu Items
    menuEditProfileBtn: document.getElementById('menu-edit-profile-btn'),
    menuBackupBtn: document.getElementById('menu-backup-btn'),
    menuPwaInstallItem: document.getElementById('menu-pwa-install-item'),
    pwaInstallBtn: document.getElementById('pwa-install-btn'),
    soundToggleBtn: document.getElementById('sound-toggle-btn'),
    soundOnIcon: document.getElementById('sound-on-icon'),
    soundOffIcon: document.getElementById('sound-off-icon'),
    soundStatusPill: document.getElementById('sound-status-pill'),

    // Self Profile in Sidebar
    selfSidebarAvatar: document.getElementById('self-sidebar-avatar'),
    selfSidebarName: document.getElementById('self-sidebar-name'),
    selfSidebarBio: document.getElementById('self-sidebar-bio'),
    selfSidebarEditBtn: document.getElementById('self-sidebar-edit-btn'),

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

    // Tabs & Lists
    tabBtnActive: document.getElementById('tab-btn-active'),
    tabBtnContacts: document.getElementById('tab-btn-contacts'),
    activeTabBadge: document.getElementById('active-tab-badge'),
    contactsTabBadge: document.getElementById('contacts-tab-badge'),
    activePeersContainer: document.getElementById('active-peers-container'),
    savedContactsContainer: document.getElementById('saved-contacts-container'),
    connectedPeers: document.getElementById('connected-peers'),
    savedContactsList: document.getElementById('saved-contacts-list'),
    noPeersPlaceholder: document.getElementById('no-peers-placeholder'),
    noContactsPlaceholder: document.getElementById('no-contacts-placeholder'),

    // Sidebar Footer
    exportChatBtn: document.getElementById('export-chat-btn'),
    syncNowBtn: document.getElementById('sync-now-btn'),
    clearChatBtn: document.getElementById('clear-chat-btn'),

    // Main Chat
    chatDiv: document.getElementById('chat-div'),
    emptyChatState: document.getElementById('empty-chat-state'),
    emptyInviteBtn: document.getElementById('empty-invite-btn'),
    scrollBottomBtn: document.getElementById('scroll-bottom-btn'),
    typingIndicator: document.getElementById('typing-indicator'),
    fileDropzone: document.getElementById('file-dropzone'),

    // Input Bar & Quick Emoji & Voice Note
    filePreviewBar: document.getElementById('file-preview-bar'),
    filePreviewName: document.getElementById('file-preview-name'),
    filePreviewSize: document.getElementById('file-preview-size'),
    fileCancelBtn: document.getElementById('file-cancel-btn'),
    quickEmojiBar: document.getElementById('quick-emoji-bar'),
    fileInput: document.getElementById('file-inp'),
    attachFileBtn: document.getElementById('attach-file-btn'),
    voiceRecordingBar: document.getElementById('voice-recording-bar'),
    voiceRecordingTimer: document.getElementById('voice-recording-timer'),
    voiceCancelBtn: document.getElementById('voice-cancel-btn'),
    voiceSendBtn: document.getElementById('voice-send-btn'),
    voiceNoteBtn: document.getElementById('voice-note-btn'),
    messageInput: document.getElementById('msg-inp'),
    sendMessageBtn: document.getElementById('send-msg-btn'),

    // Modals
    qrModal: document.getElementById('qr-modal'),
    qrcodeContainer: document.getElementById('qrcode-container'),
    profileModal: document.getElementById('profile-modal'),
    profileForm: document.getElementById('profile-form'),
    profileNameInp: document.getElementById('profile-name-inp'),
    profileBioInp: document.getElementById('profile-bio-inp'),
    profileCancelBtn: document.getElementById('profile-cancel-btn'),
    backupModal: document.getElementById('backup-modal'),
    exportBackupBtn: document.getElementById('export-backup-btn'),
    importBackupFile: document.getElementById('import-backup-file'),
    importBackupBtn: document.getElementById('import-backup-btn'),
    modalSyncBtn: document.getElementById('modal-sync-btn'),

    // Media Modal
    mediaModal: document.getElementById('media-modal'),
    mediaModalBadge: document.getElementById('media-modal-badge'),
    mediaModalTitle: document.getElementById('media-modal-title'),
    mediaModalDownload: document.getElementById('media-modal-download'),
    mediaModalCloseBtn: document.getElementById('media-modal-close-btn'),
    modalImagePreview: document.getElementById('modal-image-preview'),
    modalVideoPreview: document.getElementById('modal-video-preview'),

    // Incoming Call Modal
    incomingCallModal: document.getElementById('incoming-call-modal'),
    incomingCallerAvatar: document.getElementById('incoming-caller-avatar'),
    incomingCallerName: document.getElementById('incoming-caller-name'),
    incomingCallType: document.getElementById('incoming-call-type'),
    incomingCallIconVideo: document.getElementById('incoming-call-icon-video'),
    incomingCallIconVoice: document.getElementById('incoming-call-icon-voice'),
    incomingCallTypeText: document.getElementById('incoming-call-type-text'),
    incomingDeclineBtn: document.getElementById('incoming-decline-btn'),
    incomingAcceptBtn: document.getElementById('incoming-accept-btn'),

    // Active Call Overlay
    activeCallOverlay: document.getElementById('active-call-overlay'),
    callPeerAvatarSm: document.getElementById('call-peer-avatar-sm'),
    callPeerName: document.getElementById('call-peer-name'),
    callStatusBadge: document.getElementById('call-status-badge'),
    callDurationTimer: document.getElementById('call-duration-timer'),
    callCollapseBtn: document.getElementById('call-collapse-btn'),
    remoteVideo: document.getElementById('remote-video'),
    callVoiceStage: document.getElementById('call-voice-stage'),
    callVoiceAvatar: document.getElementById('call-voice-avatar'),
    callStatusText: document.getElementById('call-status-text'),
    localVideoPip: document.getElementById('local-video-pip'),
    localVideo: document.getElementById('local-video'),
    callToggleMicBtn: document.getElementById('call-toggle-mic-btn'),
    callMicOnIcon: document.getElementById('call-mic-on-icon'),
    callMicOffIcon: document.getElementById('call-mic-off-icon'),
    callToggleCamBtn: document.getElementById('call-toggle-cam-btn'),
    callCamOnIcon: document.getElementById('call-cam-on-icon'),
    callCamOffIcon: document.getElementById('call-cam-off-icon'),
    callShareScreenBtn: document.getElementById('call-share-screen-btn'),
    callEndBtn: document.getElementById('call-end-btn'),

    // Toasts
    toastContainer: document.getElementById('toast-container')
};

// ==========================================
// 5. Utility Functions
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
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function formatDateDivider(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }
}

function formatLastSeen(timestamp, isOnline) {
    if (isOnline) {
        return '<span class="text-success font-medium flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-success"></span>Online</span>';
    }
    if (!timestamp) return '<span class="opacity-50">Never seen</span>';

    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return 'Last seen just now';
    if (diffMin < 60) return `Last seen ${diffMin}m ago`;
    if (diffHours < 24) return `Last seen ${diffHours}h ago`;
    if (diffDays === 1) return 'Last seen yesterday';
    return `Last seen ${new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function formatETA(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return 'Calculating...';
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const remSec = Math.ceil(seconds % 60);
    return `${mins}m ${remSec}s`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
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

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// ==========================================
// 6. Audio Synthesizer (Web Audio API)
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
    if (!state.settings.soundEnabled) return;
    try {
        initAudio();
        if (!state.audioCtx) return;

        const ctx = state.audioCtx;
        const now = ctx.currentTime;

        if (type === 'message') {
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();

            osc1.type = 'sine';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(587.33, now);
            osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15);

            osc2.frequency.setValueAtTime(880, now + 0.15);
            osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.3);

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
        } else if (type === 'join' || type === 'complete') {
            const freqs = [440, 554.37, 659.25, 880];
            freqs.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + idx * 0.06);

                gain.gain.setValueAtTime(0.05, now + idx * 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.2);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(now + idx * 0.06);
                osc.stop(now + idx * 0.06 + 0.2);
            });
        }
    } catch (e) {
        console.warn('Audio error:', e);
    }
}

function startRingtone() {
    stopCallAudio();
    if (!state.settings.soundEnabled) return;
    try {
        initAudio();
        if (!state.audioCtx) return;

        const playTonePair = () => {
            if (!state.callAudioInterval) return;
            try {
                const ctx = state.audioCtx;
                const now = ctx.currentTime;
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                const gain = ctx.createGain();

                osc1.type = 'sine';
                osc2.type = 'sine';
                osc1.frequency.setValueAtTime(440, now);
                osc2.frequency.setValueAtTime(480, now);

                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(ctx.destination);

                osc1.start(now);
                osc2.start(now);
                osc1.stop(now + 1.2);
                osc2.stop(now + 1.2);
            } catch (e) {}
        };

        state.callAudioInterval = setInterval(playTonePair, 2500);
        playTonePair();
    } catch (e) {}
}

function startRingback() {
    stopCallAudio();
    if (!state.settings.soundEnabled) return;
    try {
        initAudio();
        if (!state.audioCtx) return;

        const playRingbackBeep = () => {
            if (!state.callAudioInterval) return;
            try {
                const ctx = state.audioCtx;
                const now = ctx.currentTime;
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                const gain = ctx.createGain();

                osc1.type = 'sine';
                osc2.type = 'sine';
                osc1.frequency.setValueAtTime(440, now);
                osc2.frequency.setValueAtTime(480, now);

                gain.gain.setValueAtTime(0.04, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(ctx.destination);

                osc1.start(now);
                osc2.start(now);
                osc1.stop(now + 1.0);
                osc2.stop(now + 1.0);
            } catch (e) {}
        };

        state.callAudioInterval = setInterval(playRingbackBeep, 3500);
        playRingbackBeep();
    } catch (e) {}
}

function stopCallAudio() {
    if (state.callAudioInterval) {
        clearInterval(state.callAudioInterval);
        state.callAudioInterval = null;
    }
}

// ==========================================
// 7. Toast Notifications
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
// 8. Dual-Layer Contact Management
// ==========================================
function upsertContact(peerId, data) {
    if (!peerId || peerId === state.myId) return;

    // Match by permanent userId FIRST, or fallback to peerId
    let contact = state.contacts.find(c => (data.userId && c.userId === data.userId) || c.id === peerId);

    if (!contact) {
        contact = {
            id: peerId, // current active transport peerId
            userId: data.userId || ('usr_' + peerId),
            name: data.name || ('Peer_' + peerId.slice(0, 4)),
            avatarColor: data.avatarColor || getRandomColor(),
            bio: data.bio || '',
            lastSeen: data.lastSeen || Date.now(),
            isOnline: Boolean(data.isOnline)
        };
        state.contacts.push(contact);
    } else {
        // Update active transport ID and details
        contact.id = peerId;
        if (data.userId) contact.userId = data.userId;
        if (data.name) contact.name = data.name;
        if (data.avatarColor) contact.avatarColor = data.avatarColor;
        if (data.bio !== undefined) contact.bio = data.bio;
        if (data.lastSeen) contact.lastSeen = data.lastSeen;
        if (data.isOnline !== undefined) contact.isOnline = data.isOnline;
    }

    Storage.saveContacts(state.contacts);
    renderContactsList();
}

function updateContactOnlineStatus(peerId, isOnline) {
    const contact = state.contacts.find(c => c.id === peerId);
    if (contact) {
        contact.isOnline = isOnline;
        contact.lastSeen = Date.now();
        Storage.saveContacts(state.contacts);
        renderContactsList();
    }
}

function removeContact(peerId) {
    state.contacts = state.contacts.filter(c => c.id !== peerId);
    Storage.saveContacts(state.contacts);
    renderContactsList();
    showToast('Contact removed', 'info');
}

// ==========================================
// 9. PeerJS Core & WebRTC Mesh Engine
// ==========================================
function initializePeer(preferredId = null) {
    updateConnectionStatus('connecting', 'Connecting...');
    const peerIdToUse = preferredId || Storage.getPersistentPeerId();

    try {
        state.peer = new Peer(peerIdToUse, {
            config: {
                iceServers: CONFIG.ICE_SERVERS
            },
            debug: 1
        });

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
            setupHeartbeat();
            checkForInviteParam();
        });

        state.peer.on('connection', (connection) => {
            handleNewConnection(connection);
        });

        state.peer.on('call', (mediaConnection) => {
            handleIncomingMediaCall(mediaConnection);
        });

        state.peer.on('disconnected', () => {
            updateConnectionStatus('disconnected', 'Reconnecting...');
            DOM.myPeerStatus.innerText = 'reconnecting';
            DOM.myPeerStatus.className = 'badge badge-xs badge-warning';

            state.peers.forEach((peer, peerId) => {
                updateContactOnlineStatus(peerId, false);
            });

            setTimeout(() => {
                if (state.peer && !state.peer.destroyed) {
                    state.peer.reconnect();
                }
            }, 3000);
        });

        state.peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            setJoinButtonLoading(false);

            if (err.type === 'unavailable-id') {
                // If persistent ID is currently taken (e.g. multi-tab), append session suffix
                const fallbackSessionId = Storage.getPersistentPeerId() + '_' + Math.random().toString(36).slice(2, 6);
                console.log('Static ID in use. Falling back to session ID:', fallbackSessionId);
                initializePeer(fallbackSessionId);
            } else if (err.type === 'peer-unavailable') {
                showToast('Peer not found. Check the ID and try again.', 'error');
            } else if (err.type === 'network' || err.type === 'server-error') {
                updateConnectionStatus('error', 'Network Error');
                showToast('Signaling server lost. Reconnecting...', 'error');
            } else {
                showToast(`P2P error: ${err.message || err.type}`, 'error');
            }
        });

    } catch (err) {
        console.error('Failed to initialize PeerJS:', err);
        updateConnectionStatus('error', 'Init Failed');
        showToast('WebRTC initialization failed.', 'error');
    }
}

function updateConnectionStatus(status, text) {
    if (DOM.myPeerStatus) {
        DOM.myPeerStatus.innerText = (text || status).toLowerCase();
        if (status === 'ready' || status === 'online') {
            DOM.myPeerStatus.className = 'badge badge-xs badge-success';
        } else if (status === 'connecting' || status === 'reconnecting') {
            DOM.myPeerStatus.className = 'badge badge-xs badge-warning';
        } else {
            DOM.myPeerStatus.className = 'badge badge-xs badge-error';
        }
    }
}

function connectToRemotePeer(targetId) {
    targetId = targetId.trim();

    if (targetId.includes('?join=')) {
        try {
            const url = new URL(targetId);
            const joinId = url.searchParams.get('join');
            if (joinId) targetId = joinId;
        } catch (e) {}
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

        const timeout = setTimeout(() => {
            if (!state.peers.has(targetId) || !state.peers.get(targetId).isOpen) {
                setJoinButtonLoading(false);
            }
        }, 9000);

        connection.on('open', () => clearTimeout(timeout));
    } catch (err) {
        console.error('Error connecting to peer:', err);
        setJoinButtonLoading(false);
        showToast('Failed to initiate connection', 'error');
    }
}

function handleNewConnection(connection, isInitiator = false) {
    const peerId = connection.peer;

    if (state.peers.has(peerId) && state.peers.get(peerId).connection === connection) {
        return;
    }

    const peerData = {
        connection: connection,
        userId: null,
        name: 'Peer_' + peerId.slice(0, 4),
        avatarColor: getRandomColor(),
        bio: '',
        isOpen: false,
        isTyping: false
    };

    state.peers.set(peerId, peerData);

    connection.on('open', () => {
        peerData.isOpen = true;
        setJoinButtonLoading(false);
        DOM.peerIdInput.value = '';

        // Initial contact record
        upsertContact(peerId, {
            name: peerData.name,
            avatarColor: peerData.avatarColor,
            isOnline: true,
            lastSeen: Date.now()
        });

        // Dual-Layer Handshake: send permanent userId, name, and latestMsgTime
        const latestTime = getLatestLocalMessageTimestamp();
        sendPayloadToPeer(connection, {
            type: 'HANDSHAKE',
            userId: state.user.userId,
            name: state.user.name,
            avatarColor: state.user.avatarColor,
            bio: state.user.bio || '',
            latestMsgTime: latestTime
        });

        playSound('join');
        showToast(`Connected to ${peerData.name}!`, 'success');
        addSystemMessage(`${peerData.name} joined the mesh`);
        renderPeersList();
        renderContactsList();
    });

    connection.on('data', (data) => {
        handleIncomingData(peerId, data);
    });

    connection.on('close', () => {
        cleanupPeer(peerId, `${peerData.name} disconnected`);
    });

    connection.on('error', (err) => {
        console.warn(`Connection error with ${peerId}:`, err);
        cleanupPeer(peerId, `Lost connection to ${peerData.name}`);
    });
}

function cleanupPeer(peerId, reason = '') {
    if (state.peers.has(peerId)) {
        const p = state.peers.get(peerId);
        state.peers.delete(peerId);
        updateContactOnlineStatus(peerId, false);

        if (reason) {
            addSystemMessage(reason);
            showToast(reason, 'info');
        }
        renderPeersList();
        renderContactsList();
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

function broadcastPayload(payload) {
    state.peers.forEach((peer) => {
        if (peer.isOpen && peer.connection && peer.connection.open) {
            try {
                peer.connection.send(payload);
            } catch (err) {
                console.error(`Failed to broadcast to ${peer.name}:`, err);
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
// 10. Heartbeat & Presence
// ==========================================
function setupHeartbeat() {
    setInterval(() => {
        if (state.peers.size > 0) {
            broadcastPayload({
                type: 'HEARTBEAT',
                timestamp: Date.now()
            });
        }
    }, CONFIG.HEARTBEAT_INTERVAL_MS);
}

// ==========================================
// 11. Mesh Chat Message Synchronization
// ==========================================
function getLatestLocalMessageTimestamp() {
    if (state.messages.length === 0) return 0;
    return state.messages[state.messages.length - 1].timestamp || 0;
}

function getMessagesSince(sinceTimestamp) {
    return state.messages.filter(m => m.timestamp > sinceTimestamp && !m.isSystem);
}

function triggerMeshSync() {
    if (state.peers.size === 0) {
        showToast('No active peers connected to sync with.', 'info');
        return;
    }

    const latestTime = getLatestLocalMessageTimestamp();
    broadcastPayload({
        type: 'SYNC_REQUEST',
        sinceTimestamp: latestTime
    });

    showToast('Sync request sent to mesh...', 'info');
}

// ==========================================
// 12. Message Protocol & Handling
// ==========================================
function handleIncomingData(senderId, data) {
    if (!data || typeof data !== 'object') {
        data = { type: 'CHAT', text: String(data), timestamp: Date.now() };
    }

    const peer = state.peers.get(senderId);
    const senderName = (peer && peer.name) || 'Peer_' + senderId.slice(0, 4);
    const avatarColor = (peer && peer.avatarColor) || '#3b82f6';

    switch (data.type) {
        case 'HANDSHAKE':
            if (data.userId) peer.userId = data.userId;
            if (data.name) peer.name = data.name;
            if (data.avatarColor) peer.avatarColor = data.avatarColor;
            if (data.bio) peer.bio = data.bio;

            // Upsert contact matched by userId
            upsertContact(senderId, {
                userId: data.userId,
                name: peer.name,
                avatarColor: peer.avatarColor,
                bio: peer.bio,
                isOnline: true,
                lastSeen: Date.now()
            });

            renderPeersList();
            renderContactsList();

            // Sync check
            if (data.latestMsgTime !== undefined) {
                const missed = getMessagesSince(data.latestMsgTime);
                if (missed.length > 0 && peer.connection) {
                    sendPayloadToPeer(peer.connection, {
                        type: 'SYNC_OFFER',
                        messages: missed
                    });
                }
            }
            break;

        case 'DELIVERY_ACK':
            if (data.messageId) {
                const targetMsg = state.messages.find(m => m.id === data.messageId);
                if (targetMsg) {
                    targetMsg.delivered = true;
                    Storage.saveChatHistory(state.messages);
                    const checkEl = document.getElementById(`delivery-${data.messageId}`);
                    if (checkEl) {
                        checkEl.className = 'delivery-check delivered';
                        checkEl.innerText = '✓✓';
                    }
                }
            }
            break;

        case 'SYNC_REQUEST':
            if (peer && peer.connection) {
                const missed = getMessagesSince(data.sinceTimestamp || 0);
                if (missed.length > 0) {
                    sendPayloadToPeer(peer.connection, {
                        type: 'SYNC_OFFER',
                        messages: missed
                    });
                }
            }
            break;

        case 'SYNC_OFFER':
            if (Array.isArray(data.messages) && data.messages.length > 0) {
                let addedCount = 0;
                data.messages.forEach(msg => {
                    if (!state.messages.some(m => m.id === msg.id)) {
                        state.messages.push(msg);
                        addedCount++;
                        if (msg.type === 'FILE') {
                            renderFileMessage(msg, false);
                        } else {
                            renderChatMessage(msg, false);
                        }
                    }
                });

                if (addedCount > 0) {
                    state.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                    Storage.saveChatHistory(state.messages);
                    smartScrollToBottom();
                    showToast(`Synced ${addedCount} messages with ${senderName}!`, 'success');
                }
            }
            break;

        case 'PROFILE_UPDATE':
            if (data.name) {
                const oldName = peer.name;
                peer.name = data.name;
                if (data.avatarColor) peer.avatarColor = data.avatarColor;
                if (data.bio !== undefined) peer.bio = data.bio;

                upsertContact(senderId, {
                    userId: data.userId || peer.userId,
                    name: peer.name,
                    avatarColor: peer.avatarColor,
                    bio: peer.bio,
                    isOnline: true,
                    lastSeen: Date.now()
                });

                renderPeersList();
                renderContactsList();
                addSystemMessage(`${oldName} updated their profile`);
            }
            break;

        case 'HEARTBEAT':
            if (peer) {
                upsertContact(senderId, { isOnline: true, lastSeen: Date.now() });
                if (peer.connection) {
                    sendPayloadToPeer(peer.connection, { type: 'HEARTBEAT_ACK', timestamp: Date.now() });
                }
            }
            break;

        case 'HEARTBEAT_ACK':
            upsertContact(senderId, { isOnline: true, lastSeen: Date.now() });
            break;

        case 'CHAT':
            peer.isTyping = false;
            updateTypingIndicator();

            const incomingMsg = {
                id: data.id || generateUUID(),
                isSelf: false,
                senderId: senderId,
                senderUserId: (peer && peer.userId) || senderId,
                senderName: senderName,
                avatarColor: avatarColor,
                text: data.text,
                timestamp: data.timestamp || Date.now(),
                reactions: {}
            };

            state.messages.push(incomingMsg);
            Storage.saveChatHistory(state.messages);
            renderChatMessage(incomingMsg);
            playSound('message');

            // Send delivery acknowledgment back to sender
            if (peer && peer.connection) {
                sendPayloadToPeer(peer.connection, {
                    type: 'DELIVERY_ACK',
                    messageId: incomingMsg.id
                });
            }
            break;

        // 5GB Streaming Protocol Packets
        case 'FILE_START':
            peer.isTyping = false;
            updateTypingIndicator();
            handleIncomingFileStart(senderId, senderName, avatarColor, data);

            if (peer && peer.connection) {
                sendPayloadToPeer(peer.connection, {
                    type: 'DELIVERY_ACK',
                    messageId: data.fileId
                });
            }
            break;

        case 'FILE_CHUNK':
            handleIncomingFileChunk(data);
            break;

        case 'FILE_END':
            handleIncomingFileEnd(data.fileId);
            break;

        case 'FILE_CANCEL':
            handleIncomingFileCancel(data.fileId);
            break;

        case 'TYPING':
            peer.isTyping = Boolean(data.isTyping);
            updateTypingIndicator();
            break;

        case 'VOICE_NOTE':
            if (data.message) {
                const voiceMsg = {
                    ...data.message,
                    isSelf: false,
                    senderId: senderId,
                    senderUserId: (peer && peer.userId) || senderId,
                    senderName: senderName,
                    avatarColor: avatarColor,
                    timestamp: data.message.timestamp || Date.now()
                };
                state.messages.push(voiceMsg);
                Storage.saveChatHistory(state.messages);
                renderVoiceNoteMessage(voiceMsg);
                playSound('message');

                if (peer && peer.connection) {
                    sendPayloadToPeer(peer.connection, {
                        type: 'DELIVERY_ACK',
                        messageId: voiceMsg.id
                    });
                }
            }
            break;

        case 'CALL_REJECT':
            if (state.activeCall) {
                endActiveCall(`Call declined by ${senderName}`);
            }
            break;

        case 'CALL_HANGUP':
            if (state.activeCall) {
                endActiveCall(`Call ended by ${senderName}`);
            }
            break;

        case 'REACTION':
            handleIncomingReaction(data.messageId, data.emoji, senderName);
            break;

        default:
            console.log('Unhandled packet type:', data.type);
    }
}

function handleSendMessage() {
    initAudio();
    const text = DOM.messageInput.value.trim();

    if (state.pendingFile) {
        streamFileToMesh(state.pendingFile);
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

    broadcastPayload(messageObj);
    broadcastTyping(false);

    const localMsg = {
        id: messageObj.id,
        isSelf: true,
        senderId: state.myId,
        senderUserId: state.user.userId,
        senderName: state.user.name,
        avatarColor: state.user.avatarColor,
        text: text,
        timestamp: messageObj.timestamp,
        delivered: false,
        reactions: {}
    };

    state.messages.push(localMsg);
    Storage.saveChatHistory(state.messages);
    renderChatMessage(localMsg);

    playSound('send');
    DOM.messageInput.value = '';
    DOM.messageInput.focus();
}

// ==========================================
// 13. 5GB+ Chunked Streaming File Engine
// ==========================================
async function streamFileToMesh(file) {
    if (file.size > CONFIG.MAX_FILE_SIZE_BYTES) {
        showToast(`File exceeds limit! Maximum size is ${formatFileSize(CONFIG.MAX_FILE_SIZE_BYTES)}.`, 'error');
        return;
    }

    if (state.peers.size === 0) {
        showToast('Cannot transfer file: No peers connected.', 'error');
        return;
    }

    const fileId = generateUUID();
    const chunkSize = CONFIG.CHUNK_SIZE;
    const totalChunks = Math.ceil(file.size / chunkSize);

    const transfer = {
        fileId: fileId,
        file: file,
        totalChunks: totalChunks,
        sentChunks: 0,
        bytesSent: 0,
        totalBytes: file.size,
        startTime: Date.now(),
        cancelled: false
    };

    state.transfers.set(fileId, transfer);

    broadcastPayload({
        type: 'FILE_START',
        fileId: fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        totalChunks: totalChunks,
        chunkSize: chunkSize,
        timestamp: Date.now()
    });

    const localFileMsg = {
        id: fileId,
        type: 'FILE',
        isSelf: true,
        senderId: state.myId,
        senderUserId: state.user.userId,
        senderName: state.user.name,
        avatarColor: state.user.avatarColor,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        timestamp: Date.now(),
        delivered: false,
        isStreaming: true
    };

    state.messages.push(localFileMsg);
    Storage.saveChatHistory(state.messages);
    renderFileProgressCard(localFileMsg, true);

    playSound('send');

    try {
        for (let i = 0; i < totalChunks; i++) {
            if (transfer.cancelled) {
                showToast(`Upload for ${file.name} cancelled.`, 'info');
                break;
            }

            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const slice = file.slice(start, end);
            const arrayBuffer = await slice.arrayBuffer();
            const base64Chunk = arrayBufferToBase64(arrayBuffer);

            broadcastPayload({
                type: 'FILE_CHUNK',
                fileId: fileId,
                chunkIndex: i,
                totalChunks: totalChunks,
                data: base64Chunk
            });

            transfer.sentChunks++;
            transfer.bytesSent += (end - start);

            updateTransferProgressUI(fileId, transfer.bytesSent, transfer.totalBytes, transfer.startTime, true);
            await checkBackpressure();
        }

        if (!transfer.cancelled) {
            broadcastPayload({
                type: 'FILE_END',
                fileId: fileId
            });

            completeFileTransferUI(fileId, file.name, file.size, file.type, URL.createObjectURL(file), true);
            state.transfers.delete(fileId);
            playSound('complete');
            showToast(`Finished uploading ${file.name}!`, 'success');
        }
    } catch (err) {
        console.error('Error during chunked file upload:', err);
        showToast('File transfer error occurred.', 'error');
    }
}

async function checkBackpressure() {
    let maxBuffered = 0;
    state.peers.forEach(peer => {
        if (peer.connection && peer.connection.dataChannel) {
            maxBuffered = Math.max(maxBuffered, peer.connection.dataChannel.bufferedAmount || 0);
        }
    });

    if (maxBuffered > 1.5 * 1024 * 1024) {
        await new Promise(resolve => setTimeout(resolve, 35));
    }
}

function handleIncomingFileStart(senderId, senderName, avatarColor, header) {
    const fileId = header.fileId;
    const transfer = {
        fileId: fileId,
        fileName: header.fileName,
        fileSize: header.fileSize,
        fileType: header.fileType,
        totalChunks: header.totalChunks,
        receivedChunks: 0,
        bytesReceived: 0,
        totalBytes: header.fileSize,
        startTime: Date.now(),
        chunks: new Array(header.totalChunks),
        cancelled: false
    };

    state.transfers.set(fileId, transfer);

    const incomingFileMsg = {
        id: fileId,
        type: 'FILE',
        isSelf: false,
        senderId: senderId,
        senderName: senderName,
        avatarColor: avatarColor,
        fileName: header.fileName,
        fileType: header.fileType,
        fileSize: header.fileSize,
        timestamp: header.timestamp || Date.now(),
        isStreaming: true
    };

    state.messages.push(incomingFileMsg);
    Storage.saveChatHistory(state.messages);
    renderFileProgressCard(incomingFileMsg, false);
    playSound('message');
}

function handleIncomingFileChunk(packet) {
    const transfer = state.transfers.get(packet.fileId);
    if (!transfer || transfer.cancelled) return;

    try {
        const buffer = base64ToArrayBuffer(packet.data);
        transfer.chunks[packet.chunkIndex] = buffer;
        transfer.receivedChunks++;
        transfer.bytesReceived += buffer.byteLength;

        updateTransferProgressUI(packet.fileId, transfer.bytesReceived, transfer.totalBytes, transfer.startTime, false);
    } catch (e) {
        console.error('Failed to unpack chunk:', e);
    }
}

function handleIncomingFileEnd(fileId) {
    const transfer = state.transfers.get(fileId);
    if (!transfer || transfer.cancelled) return;

    try {
        const blob = new Blob(transfer.chunks, { type: transfer.fileType });
        const downloadUrl = URL.createObjectURL(blob);

        completeFileTransferUI(fileId, transfer.fileName, transfer.fileSize, transfer.fileType, downloadUrl, false);
        transfer.chunks = null;
        state.transfers.delete(fileId);

        playSound('complete');
        showToast(`Downloaded ${transfer.fileName} (${formatFileSize(transfer.fileSize)})!`, 'success');
    } catch (e) {
        console.error('Failed to assemble file blob:', e);
        showToast('Error assembling incoming file.', 'error');
    }
}

function handleIncomingFileCancel(fileId) {
    const transfer = state.transfers.get(fileId);
    if (transfer) {
        transfer.cancelled = true;
        transfer.chunks = null;
        state.transfers.delete(fileId);
    }
    const card = document.getElementById(`transfer-card-${fileId}`);
    if (card) {
        card.innerHTML = `<span class="text-xs text-error font-medium">Transfer cancelled by peer</span>`;
    }
}

function cancelTransfer(fileId) {
    const transfer = state.transfers.get(fileId);
    if (transfer) {
        transfer.cancelled = true;
        transfer.chunks = null;
        state.transfers.delete(fileId);
    }

    broadcastPayload({
        type: 'FILE_CANCEL',
        fileId: fileId
    });

    const card = document.getElementById(`transfer-card-${fileId}`);
    if (card) {
        card.innerHTML = `<span class="text-xs text-error font-medium">Transfer cancelled</span>`;
    }

    showToast('Transfer cancelled', 'info');
}

// ==========================================
// 14. UI Rendering (Chat, Media & Progress)
// ==========================================
function checkAndRenderDateDivider(timestamp) {
    if (!timestamp) return;
    const msgDateStr = new Date(timestamp).toDateString();
    if (state.lastRenderedDate !== msgDateStr) {
        state.lastRenderedDate = msgDateStr;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.innerHTML = `<span class="date-divider-pill">${formatDateDivider(timestamp)}</span>`;
        DOM.chatDiv.appendChild(divider);
    }
}

function renderChatMessage(msg, shouldScroll = true) {
    hideEmptyChatState();
    checkAndRenderDateDivider(msg.timestamp);

    const isSelf = msg.isSelf;
    const timeStr = formatTime(msg.timestamp);
    const bubbleClass = isSelf ? 'chat-bubble-primary' : 'chat-bubble-secondary';
    const chatAlignment = isSelf ? 'chat-end' : 'chat-start';
    const initial = getInitials(msg.senderName);

    const msgElement = document.createElement('div');
    msgElement.className = `chat ${chatAlignment} animate-message group`;
    msgElement.dataset.messageId = msg.id;

    const deliveryCheckHtml = isSelf ? `
        <span id="delivery-${msg.id}" class="delivery-check ${msg.delivered ? 'delivered' : 'sent'}" title="${msg.delivered ? 'Delivered to mesh' : 'Sent'}">
            ${msg.delivered ? '✓✓' : '✓'}
        </span>
    ` : '';

    msgElement.innerHTML = `
        <div class="chat-image avatar placeholder">
            <div class="w-8 h-8 rounded-full text-white font-bold text-xs shadow-sm flex items-center justify-center" style="background-color: ${msg.avatarColor}">
                <span>${escapeHtml(initial)}</span>
            </div>
        </div>
        <div class="chat-header text-[11px] opacity-70 mb-1 flex items-center gap-1.5">
            <span class="font-semibold">${escapeHtml(msg.senderName)}</span>
            <time class="text-[10px] opacity-60">${timeStr}</time>
            ${deliveryCheckHtml}
        </div>
        <div class="chat-bubble ${bubbleClass} text-sm break-words max-w-[85%] sm:max-w-md shadow-sm relative">
            <div class="chat-text-content select-text">${escapeHtml(msg.text)}</div>
            <div class="reactions-wrapper flex flex-wrap gap-1 mt-1 empty:hidden"></div>
        </div>
        <div class="chat-footer opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex items-center gap-1">
            <button class="btn btn-ghost btn-circle btn-xs hover:bg-base-200" onclick="toggleReactionPicker('${msg.id}')" title="React with emoji">
                <span class="text-xs">😀</span>
            </button>
        </div>
    `;

    DOM.chatDiv.appendChild(msgElement);
    if (shouldScroll) smartScrollToBottom();
}

function renderFileProgressCard(msg, isSender) {
    hideEmptyChatState();
    checkAndRenderDateDivider(msg.timestamp);

    const isSelf = msg.isSelf;
    const timeStr = formatTime(msg.timestamp);
    const bubbleClass = isSelf ? 'chat-bubble-primary' : 'chat-bubble-secondary';
    const chatAlignment = isSelf ? 'chat-end' : 'chat-start';
    const initial = getInitials(msg.senderName);
    const modeLabel = isSender ? 'Uploading' : 'Downloading';

    const msgElement = document.createElement('div');
    msgElement.className = `chat ${chatAlignment} animate-message`;
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
        <div class="chat-bubble ${bubbleClass} text-sm break-words max-w-[88%] sm:max-w-md shadow-sm relative">
            <div id="transfer-card-${msg.id}" class="flex flex-col gap-2 p-1.5 min-w-[240px]">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 truncate">
                        <span class="badge badge-warning badge-xs font-mono font-semibold">${modeLabel}</span>
                        <span class="font-semibold text-xs truncate max-w-[140px]">${escapeHtml(msg.fileName)}</span>
                    </div>
                    <button class="btn btn-ghost btn-circle btn-xs text-error" onclick="cancelTransfer('${msg.id}')" title="Cancel Transfer">✕</button>
                </div>
                <div class="w-full bg-base-300 rounded-full h-2.5 overflow-hidden">
                    <div id="progress-bar-${msg.id}" class="bg-primary h-2.5 rounded-full transfer-progress-striped transition-all duration-150" style="width: 0%"></div>
                </div>
                <div class="flex items-center justify-between text-[10px] opacity-80 font-mono">
                    <span id="progress-percent-${msg.id}" class="font-bold">0%</span>
                    <span id="progress-bytes-${msg.id}">0 B / ${formatFileSize(msg.fileSize)}</span>
                    <span id="progress-speed-${msg.id}">...</span>
                </div>
                <div class="flex items-center justify-between text-[10px] opacity-70 font-mono pt-0.5 border-t border-base-content/10">
                    <span>ETA: <strong id="progress-eta-${msg.id}">Calculating...</strong></span>
                </div>
            </div>
            <div class="reactions-wrapper flex flex-wrap gap-1 mt-1 empty:hidden"></div>
        </div>
    `;

    DOM.chatDiv.appendChild(msgElement);
    smartScrollToBottom();
}

function updateTransferProgressUI(fileId, bytesTransferred, totalBytes, startTime, isSender) {
    const bar = document.getElementById(`progress-bar-${fileId}`);
    const percentEl = document.getElementById(`progress-percent-${fileId}`);
    const bytesEl = document.getElementById(`progress-bytes-${fileId}`);
    const speedEl = document.getElementById(`progress-speed-${fileId}`);
    const etaEl = document.getElementById(`progress-eta-${fileId}`);
    if (!bar || !percentEl || !bytesEl || !speedEl || !etaEl) return;

    const percent = Math.min(100, Math.round((bytesTransferred / totalBytes) * 100));
    bar.style.width = `${percent}%`;
    percentEl.innerText = `${percent}%`;
    bytesEl.innerText = `${formatFileSize(bytesTransferred)} / ${formatFileSize(totalBytes)}`;

    const elapsedSeconds = (Date.now() - startTime) / 1000;
    if (elapsedSeconds > 0.5) {
        const rateBytesPerSec = bytesTransferred / elapsedSeconds;
        speedEl.innerText = `${formatFileSize(rateBytesPerSec)}/s`;

        const remainingBytes = totalBytes - bytesTransferred;
        const etaSeconds = rateBytesPerSec > 0 ? remainingBytes / rateBytesPerSec : 0;
        etaEl.innerText = formatETA(etaSeconds);
    }
}

function completeFileTransferUI(fileId, fileName, fileSize, fileType, downloadUrl, isSender) {
    const card = document.getElementById(`transfer-card-${fileId}`);
    if (!card) return;

    const isImage = fileType && fileType.startsWith('image/');
    const isVideo = fileType && fileType.startsWith('video/');
    const isAudio = fileType && fileType.startsWith('audio/');

    if (isVideo && downloadUrl) {
        card.innerHTML = `
            <div class="flex flex-col gap-2">
                <div class="relative group">
                    <video src="${downloadUrl}" controls preload="metadata" playsinline class="rounded-lg max-h-64 w-full bg-black/50 shadow"></video>
                </div>
                <div class="flex items-center justify-between pt-1 border-t border-base-content/10 text-xs">
                    <span class="truncate max-w-[150px] opacity-80 font-medium">${escapeHtml(fileName)}</span>
                    <div class="flex items-center gap-1">
                        <button type="button" class="btn btn-ghost btn-xs gap-1" onclick="openMediaLightbox('${downloadUrl}', 'video', '${escapeHtml(fileName)}')">
                            Enlarge
                        </button>
                        <a href="${downloadUrl}" download="${escapeHtml(fileName)}" class="btn btn-primary btn-xs gap-1 shadow-sm">
                            Save
                        </a>
                    </div>
                </div>
            </div>
        `;
    } else if (isImage && downloadUrl) {
        card.innerHTML = `
            <div class="flex flex-col gap-2">
                <img src="${downloadUrl}" alt="${escapeHtml(fileName)}" class="rounded-lg max-h-60 max-w-full object-cover cursor-pointer hover:opacity-95 transition-opacity shadow" onclick="openMediaLightbox('${downloadUrl}', 'image', '${escapeHtml(fileName)}')" />
                <div class="flex items-center justify-between pt-1 border-t border-base-content/10 text-xs">
                    <span class="truncate max-w-[150px] opacity-80 font-medium">${escapeHtml(fileName)}</span>
                    <a href="${downloadUrl}" download="${escapeHtml(fileName)}" class="btn btn-primary btn-xs gap-1 shadow-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Save (${formatFileSize(fileSize)})
                    </a>
                </div>
            </div>
        `;
    } else if (isAudio && downloadUrl) {
        card.innerHTML = `
            <div class="flex flex-col gap-1.5 p-1">
                <div class="flex items-center gap-2">
                    <span class="badge badge-accent badge-xs">Audio</span>
                    <span class="font-medium text-xs truncate max-w-[170px]">${escapeHtml(fileName)}</span>
                </div>
                <audio src="${downloadUrl}" controls class="w-full mt-1"></audio>
                <div class="flex justify-end mt-1">
                    <a href="${downloadUrl}" download="${escapeHtml(fileName)}" class="btn btn-ghost btn-xs gap-1">
                        Download (${formatFileSize(fileSize)})
                    </a>
                </div>
            </div>
        `;
    } else {
        card.innerHTML = `
            <div class="flex items-center gap-3 p-1">
                <div class="w-10 h-10 rounded-lg bg-base-300/40 flex items-center justify-center shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                </div>
                <div class="flex flex-col min-w-0">
                    <span class="font-medium text-xs truncate max-w-[170px]">${escapeHtml(fileName)}</span>
                    <span class="text-[10px] opacity-70">${formatFileSize(fileSize)} • Completed</span>
                </div>
                ${downloadUrl ? `
                    <a href="${downloadUrl}" download="${escapeHtml(fileName)}" class="btn btn-circle btn-xs btn-primary ml-auto shadow" title="Download File">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                    </a>
                ` : ''}
            </div>
        `;
    }
}

function renderFileMessage(msg, shouldScroll = true) {
    hideEmptyChatState();
    checkAndRenderDateDivider(msg.timestamp);

    const isSelf = msg.isSelf;
    const timeStr = formatTime(msg.timestamp);
    const bubbleClass = isSelf ? 'chat-bubble-primary' : 'chat-bubble-secondary';
    const chatAlignment = isSelf ? 'chat-end' : 'chat-start';
    const initial = getInitials(msg.senderName);

    const msgElement = document.createElement('div');
    msgElement.className = `chat ${chatAlignment} animate-message`;
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
            </div>
            <div class="reactions-wrapper flex flex-wrap gap-1 mt-1 empty:hidden"></div>
        </div>
    `;

    DOM.chatDiv.appendChild(msgElement);
    if (shouldScroll) smartScrollToBottom();
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

function renderVoiceNoteMessage(msg, shouldScroll = true) {
    hideEmptyChatState();
    checkAndRenderDateDivider(msg.timestamp);

    const isSelf = msg.isSelf;
    const timeStr = formatTime(msg.timestamp);
    const bubbleClass = isSelf ? 'chat-bubble-primary' : 'chat-bubble-secondary';
    const chatAlignment = isSelf ? 'chat-end' : 'chat-start';
    const initial = getInitials(msg.senderName);
    const duration = msg.duration || 0;
    const initialDurationStr = formatDuration(duration);

    const msgElement = document.createElement('div');
    msgElement.className = `chat ${chatAlignment} animate-message group`;
    msgElement.dataset.messageId = msg.id;

    const deliveryCheckHtml = isSelf ? `
        <span id="delivery-${msg.id}" class="delivery-check ${msg.delivered ? 'delivered' : 'sent'}" title="${msg.delivered ? 'Delivered' : 'Sent'}">
            ${msg.delivered ? '✓✓' : '✓'}
        </span>
    ` : '';

    msgElement.innerHTML = `
        <div class="chat-image avatar placeholder relative">
            <div class="w-8 h-8 rounded-full text-white font-bold text-xs shadow-sm flex items-center justify-center" style="background-color: ${msg.avatarColor}">
                <span>${escapeHtml(initial)}</span>
            </div>
            <span class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-base-200 text-[9px] flex items-center justify-center shadow-xs border border-base-300">🎙️</span>
        </div>
        <div class="chat-header text-[11px] opacity-70 mb-1 flex items-center gap-1.5">
            <span class="font-semibold">${escapeHtml(msg.senderName)}</span>
            <time class="text-[10px] opacity-60">${timeStr}</time>
            ${deliveryCheckHtml}
        </div>
        <div class="chat-bubble ${bubbleClass} text-sm break-words shadow-sm relative">
            <div class="voice-note-bubble py-1">
                <!-- Audio Element -->
                <audio id="audio-${msg.id}" src="${msg.audioData}" preload="metadata" class="hidden"></audio>

                <!-- Play/Pause Button -->
                <button type="button" id="play-btn-${msg.id}" class="btn btn-circle btn-sm btn-ghost bg-base-100/20 hover:bg-base-100/30 text-current shrink-0" title="Play / Pause">
                    <svg id="play-icon-${msg.id}" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 ml-0.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                    </svg>
                    <svg id="pause-icon-${msg.id}" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 hidden" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                </button>

                <!-- Scrubber & Time -->
                <div class="flex flex-col flex-1 min-w-0 gap-1">
                    <input type="range" id="scrubber-${msg.id}" min="0" max="${duration || 10}" step="0.1" value="0" class="voice-note-scrubber w-full" />
                    <div class="flex items-center justify-between text-[10px] opacity-80 font-mono">
                        <span id="time-current-${msg.id}">0:00</span>
                        <span id="time-total-${msg.id}">${initialDurationStr}</span>
                    </div>
                </div>

                <!-- Speed Button (1x, 1.5x, 2x) -->
                <button type="button" id="speed-btn-${msg.id}" class="badge badge-neutral badge-xs font-mono font-bold cursor-pointer py-2 hover:opacity-80 shrink-0" title="Change speed">
                    1x
                </button>
            </div>
            <div class="reactions-wrapper flex flex-wrap gap-1 mt-1 empty:hidden"></div>
        </div>
        <div class="chat-footer opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex items-center gap-1">
            <button class="btn btn-ghost btn-circle btn-xs hover:bg-base-200" onclick="toggleReactionPicker('${msg.id}')" title="React with emoji">
                <span class="text-xs">😀</span>
            </button>
        </div>
    `;

    DOM.chatDiv.appendChild(msgElement);
    attachVoiceNoteListeners(msg.id, duration);
    if (shouldScroll) smartScrollToBottom();
}

function attachVoiceNoteListeners(id, defaultDuration) {
    const audio = document.getElementById(`audio-${id}`);
    const playBtn = document.getElementById(`play-btn-${id}`);
    const playIcon = document.getElementById(`play-icon-${id}`);
    const pauseIcon = document.getElementById(`pause-icon-${id}`);
    const scrubber = document.getElementById(`scrubber-${id}`);
    const timeCurrent = document.getElementById(`time-current-${id}`);
    const timeTotal = document.getElementById(`time-total-${id}`);
    const speedBtn = document.getElementById(`speed-btn-${id}`);

    if (!audio || !playBtn || !scrubber) return;

    audio.addEventListener('loadedmetadata', () => {
        if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
            scrubber.max = audio.duration;
            timeTotal.innerText = formatDuration(audio.duration);
        }
    });

    audio.addEventListener('timeupdate', () => {
        scrubber.value = audio.currentTime;
        timeCurrent.innerText = formatDuration(audio.currentTime);
    });

    audio.addEventListener('ended', () => {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        scrubber.value = 0;
        timeCurrent.innerText = '0:00';
    });

    playBtn.addEventListener('click', () => {
        if (audio.paused) {
            audio.play().then(() => {
                playIcon.classList.add('hidden');
                pauseIcon.classList.remove('hidden');
            }).catch(e => console.warn('Audio play failed:', e));
        } else {
            audio.pause();
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
        }
    });

    scrubber.addEventListener('input', () => {
        audio.currentTime = parseFloat(scrubber.value);
        timeCurrent.innerText = formatDuration(audio.currentTime);
    });

    const speeds = [1, 1.5, 2];
    let speedIndex = 0;
    speedBtn.addEventListener('click', () => {
        speedIndex = (speedIndex + 1) % speeds.length;
        const newSpeed = speeds[speedIndex];
        audio.playbackRate = newSpeed;
        speedBtn.innerText = `${newSpeed}x`;
    });
}

function restoreChatFromStorage() {
    if (!state.messages || state.messages.length === 0) return;

    hideEmptyChatState();
    DOM.chatDiv.innerHTML = '';
    state.lastRenderedDate = null;

    state.messages.forEach(msg => {
        if (msg.type === 'VOICE_NOTE') {
            renderVoiceNoteMessage(msg, false);
        } else if (msg.type === 'FILE' || msg.fileName) {
            renderFileMessage(msg, false);
        } else {
            renderChatMessage(msg, false);
        }
    });

    smartScrollToBottom();
}

// Reactions handling
window.toggleReactionPicker = function(messageId) {
    const emojis = ['👍', '❤️', '😂', '🎉', '🔥', '🚀'];
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

// Universal Media Lightbox (Images & Videos)
window.openMediaLightbox = function(url, type, name = 'Media Attachment') {
    DOM.mediaModalTitle.innerText = name;
    DOM.mediaModalDownload.href = url;
    DOM.mediaModalDownload.download = name;

    if (type === 'video') {
        DOM.mediaModalBadge.innerText = 'Video';
        DOM.modalImagePreview.classList.add('hidden');
        DOM.modalVideoPreview.classList.remove('hidden');
        DOM.modalVideoPreview.src = url;
        DOM.modalVideoPreview.play().catch(() => {});
    } else {
        DOM.mediaModalBadge.innerText = 'Image';
        DOM.modalVideoPreview.classList.add('hidden');
        DOM.modalVideoPreview.pause();
        DOM.modalVideoPreview.src = '';
        DOM.modalImagePreview.classList.remove('hidden');
        DOM.modalImagePreview.src = url;
    }

    DOM.mediaModal.showModal();
};

// ==========================================
// 15. Peers & Contacts List Rendering
// ==========================================
function updateHeaderPeerInfo() {
    if (!DOM.headerPeerName || !DOM.headerPeerAvatar || !DOM.headerPeerStatusDot || !DOM.headerPeerStatusText) return;

    const count = state.peers.size;

    if (count === 0) {
        DOM.headerPeerAvatar.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
        `;
        DOM.headerPeerAvatar.style.backgroundColor = '';
        DOM.headerPeerAvatar.style.color = '';
        DOM.headerPeerStatusDot.className = 'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-base-content/20 border-2 border-base-200';
        DOM.headerPeerName.innerText = 'Direct P2P Chat';
        DOM.headerPeerStatusText.innerText = 'Waiting for peer to connect...';
        DOM.headerPeerStatusText.className = 'text-[11px] text-base-content/60 truncate';
    } else if (count === 1) {
        const singlePeer = state.peers.values().next().value;
        if (singlePeer) {
            const initial = getInitials(singlePeer.name || 'Peer');
            DOM.headerPeerAvatar.innerHTML = `<span>${escapeHtml(initial)}</span>`;
            DOM.headerPeerAvatar.style.backgroundColor = singlePeer.avatarColor || '#3b82f6';
            DOM.headerPeerAvatar.style.color = '#ffffff';
            DOM.headerPeerStatusDot.className = 'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-success border-2 border-base-200 status-dot-online';
            DOM.headerPeerName.innerText = singlePeer.name || 'Connected Peer';

            if (singlePeer.isTyping) {
                DOM.headerPeerStatusText.innerText = 'typing...';
                DOM.headerPeerStatusText.className = 'text-[11px] text-primary font-medium truncate animate-pulse';
            } else {
                DOM.headerPeerStatusText.innerText = singlePeer.bio ? `Online • ${singlePeer.bio}` : 'Online';
                DOM.headerPeerStatusText.className = 'text-[11px] text-success truncate';
            }
        }
    } else {
        DOM.headerPeerAvatar.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
        `;
        DOM.headerPeerAvatar.style.backgroundColor = '';
        DOM.headerPeerAvatar.style.color = '';
        DOM.headerPeerStatusDot.className = 'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-success border-2 border-base-200 status-dot-online';
        DOM.headerPeerName.innerText = `Mesh Room (${count} peers)`;

        const typingPeer = Array.from(state.peers.values()).find(p => p.isTyping);
        if (typingPeer) {
            DOM.headerPeerStatusText.innerText = `${typingPeer.name} is typing...`;
            DOM.headerPeerStatusText.className = 'text-[11px] text-primary font-medium truncate animate-pulse';
        } else {
            DOM.headerPeerStatusText.innerText = `${count} devices online`;
            DOM.headerPeerStatusText.className = 'text-[11px] text-success truncate';
        }
    }
}

function renderPeersList() {
    DOM.connectedPeers.innerHTML = '';
    const count = state.peers.size;

    if (DOM.activeTabBadge) DOM.activeTabBadge.innerText = count;
    updateHeaderPeerInfo();

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
                <div class="relative">
                    <div class="w-8 h-8 rounded-full text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm" style="background-color: ${peer.avatarColor}">
                        <span>${escapeHtml(initial)}</span>
                    </div>
                    <span class="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-success border-2 border-base-100 status-dot-online"></span>
                </div>
                <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-semibold truncate leading-tight">${escapeHtml(peer.name)}</span>
                    </div>
                    <span class="text-[10px] opacity-60 truncate">${escapeHtml(peer.bio || 'Online')}</span>
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

function renderContactsList() {
    DOM.savedContactsList.innerHTML = '';
    const count = state.contacts.length;
    DOM.contactsTabBadge.innerText = count;

    if (count === 0) {
        DOM.savedContactsList.appendChild(DOM.noContactsPlaceholder);
        return;
    }

    const sorted = [...state.contacts].sort((a, b) => {
        if (a.isOnline === b.isOnline) {
            return (b.lastSeen || 0) - (a.lastSeen || 0);
        }
        return a.isOnline ? -1 : 1;
    });

    sorted.forEach((contact) => {
        const item = document.createElement('div');
        item.className = 'card bg-base-100 p-2.5 shadow-sm border border-base-300 flex flex-row items-center justify-between gap-2';

        const initial = getInitials(contact.name);
        const isOnline = Boolean(contact.isOnline && state.peers.has(contact.id));
        const lastSeenHtml = formatLastSeen(contact.lastSeen, isOnline);

        item.innerHTML = `
            <div class="flex items-center gap-2 min-w-0">
                <div class="relative">
                    <div class="w-8 h-8 rounded-full text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm" style="background-color: ${contact.avatarColor}">
                        <span>${escapeHtml(initial)}</span>
                    </div>
                    <span class="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-success border-2 border-base-100 status-dot-online' : 'bg-base-content/30 border-2 border-base-100'}"></span>
                </div>
                <div class="flex flex-col min-w-0">
                    <span class="text-xs font-semibold truncate leading-tight">${escapeHtml(contact.name)}</span>
                    <span class="text-[10px] leading-tight">${lastSeenHtml}</span>
                </div>
            </div>
            <div class="flex items-center gap-1">
                ${!isOnline ? `
                    <button class="btn btn-outline btn-primary btn-xs" onclick="quickConnect('${contact.id}')" title="Connect to this contact">
                        Connect
                    </button>
                ` : ''}
                <button class="btn btn-ghost btn-circle btn-xs text-base-content/60 hover:text-primary" onclick="copyPeerId('${contact.id}')" title="Copy ID">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                </button>
                <button class="btn btn-ghost btn-circle btn-xs text-error/60 hover:text-error" onclick="removeContact('${contact.id}')" title="Remove Contact">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        `;

        DOM.savedContactsList.appendChild(item);
    });
}

window.quickConnect = function(id) {
    DOM.peerIdInput.value = id;
    connectToRemotePeer(id);
};

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

function switchSidebarTab(tab) {
    state.activeTab = tab;
    if (tab === 'active') {
        DOM.tabBtnActive.classList.add('tab-active');
        DOM.tabBtnContacts.classList.remove('tab-active');
        DOM.activePeersContainer.classList.remove('hidden');
        DOM.savedContactsContainer.classList.add('hidden');
    } else {
        DOM.tabBtnContacts.classList.add('tab-active');
        DOM.tabBtnActive.classList.remove('tab-active');
        DOM.savedContactsContainer.classList.remove('hidden');
        DOM.activePeersContainer.classList.add('hidden');
    }
}

function updateTypingIndicator() {
    const typingNames = [];
    state.peers.forEach((peer) => {
        if (peer.isTyping) {
            typingNames.push(peer.name);
        }
    });

    updateHeaderPeerInfo();

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

function smartScrollToBottom() {
    const threshold = 140;
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
// 16. File Drop & Attachment Handling
// ==========================================
function setupFileHandling() {
    DOM.attachFileBtn.addEventListener('click', () => {
        DOM.fileInput.click();
    });

    DOM.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            setPendingFile(e.target.files[0]);
        }
    });

    DOM.fileCancelBtn.addEventListener('click', () => {
        clearPendingFile();
    });

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
    if (file.size > CONFIG.MAX_FILE_SIZE_BYTES) {
        showToast(`Selected file exceeds maximum limit of 5GB.`, 'error');
        return;
    }
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
// 17. Sharing, Links & QR Code
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
// 18. User Profile Management
// ==========================================
function updateUserProfileUI() {
    if (DOM.selfSidebarName) DOM.selfSidebarName.innerText = state.user.name;
    if (DOM.selfSidebarBio) DOM.selfSidebarBio.innerText = state.user.bio || 'Available for P2P messaging';
    if (DOM.selfSidebarAvatar) {
        DOM.selfSidebarAvatar.innerText = getInitials(state.user.name);
        DOM.selfSidebarAvatar.style.backgroundColor = state.user.avatarColor || '#3b82f6';
    }
}

function handleSaveProfile(e) {
    e.preventDefault();
    const newName = DOM.profileNameInp.value.trim();
    const newBio = DOM.profileBioInp.value.trim();
    if (!newName) return;

    state.user.name = newName;
    state.user.bio = newBio;
    Storage.saveProfile(state.user);
    updateUserProfileUI();

    broadcastPayload({
        type: 'PROFILE_UPDATE',
        userId: state.user.userId,
        name: state.user.name,
        avatarColor: state.user.avatarColor,
        bio: state.user.bio
    });

    DOM.profileModal.close();
    showToast('Profile updated!', 'success');
}

// ==========================================
// 19. Backup Export & Import Service
// ==========================================
function exportFullBackup() {
    const backupBundle = {
        app: 'PeerWave',
        version: 3,
        exportTimestamp: Date.now(),
        profile: state.user,
        settings: state.settings,
        contacts: state.contacts,
        chat: state.messages
    };

    const json = JSON.stringify(backupBundle, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `peerwave_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Full backup downloaded!', 'success');
}

function importFullBackup() {
    const file = DOM.importBackupFile.files && DOM.importBackupFile.files[0];
    if (!file) {
        showToast('Please select a valid .json backup file.', 'warning');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid JSON format');
            }

            if (data.profile) {
                state.user = { ...state.user, ...data.profile };
                Storage.saveProfile(state.user);
                updateUserProfileUI();
            }

            if (data.settings) {
                state.settings = { ...state.settings, ...data.settings };
                Storage.saveSettings(state.settings);
                initTheme();
                updateSoundUI();
            }

            if (Array.isArray(data.contacts)) {
                state.contacts = data.contacts;
                Storage.saveContacts(state.contacts);
                renderContactsList();
            }

            if (Array.isArray(data.chat)) {
                state.messages = data.chat;
                Storage.saveChatHistory(state.messages);
                restoreChatFromStorage();
            }

            DOM.backupModal.close();
            DOM.importBackupFile.value = '';
            showToast('Backup restored successfully!', 'success');
        } catch (err) {
            console.error('Failed to restore backup:', err);
            showToast('Failed to import backup. Corrupted or invalid JSON.', 'error');
        }
    };
    reader.readAsText(file);
}

// ==========================================
// 20. Chat Export & Clear
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
            output += `[${time}] ${msg.senderName} shared file: ${msg.fileName} (${formatFileSize(msg.fileSize)})\n`;
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
    if (confirm('Are you sure you want to clear your local chat messages?')) {
        state.messages = [];
        state.lastRenderedDate = null;
        Storage.saveChatHistory([]);
        DOM.chatDiv.innerHTML = '';
        if (DOM.emptyChatState) {
            DOM.emptyChatState.classList.remove('hidden');
            DOM.chatDiv.appendChild(DOM.emptyChatState);
        }
        showToast('Chat history cleared', 'info');
    }
}

// ==========================================
// 21. Theme & Sound Preferences
// ==========================================
function initTheme() {
    const theme = state.settings.theme || CONFIG.DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', theme);

    document.querySelectorAll('.theme-select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const chosenTheme = btn.dataset.theme;
            document.documentElement.setAttribute('data-theme', chosenTheme);
            state.settings.theme = chosenTheme;
            Storage.saveSettings(state.settings);
            if (document.activeElement) document.activeElement.blur();
        });
    });
}

function updateSoundUI() {
    if (state.settings.soundEnabled) {
        if (DOM.soundOnIcon) DOM.soundOnIcon.classList.remove('hidden');
        if (DOM.soundOffIcon) DOM.soundOffIcon.classList.add('hidden');
        if (DOM.soundStatusPill) {
            DOM.soundStatusPill.innerText = 'ON';
            DOM.soundStatusPill.className = 'badge badge-xs badge-success';
        }
    } else {
        if (DOM.soundOnIcon) DOM.soundOnIcon.classList.add('hidden');
        if (DOM.soundOffIcon) DOM.soundOffIcon.classList.remove('hidden');
        if (DOM.soundStatusPill) {
            DOM.soundStatusPill.innerText = 'OFF';
            DOM.soundStatusPill.className = 'badge badge-xs badge-ghost opacity-60';
        }
    }
}

function toggleSound() {
    state.settings.soundEnabled = !state.settings.soundEnabled;
    Storage.saveSettings(state.settings);
    updateSoundUI();
    showToast(state.settings.soundEnabled ? 'Sound enabled' : 'Sound muted', 'info');
    if (state.settings.soundEnabled) {
        playSound('message');
    }
}

// ==========================================
// 22. Quick Emoji Bar Setup
// ==========================================
function setupQuickEmojiBar() {
    if (!DOM.quickEmojiBar) return;
    DOM.quickEmojiBar.querySelectorAll('.emoji-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            DOM.messageInput.value += btn.innerText;
            DOM.messageInput.focus();
        });
    });
}

// ==========================================
// 23. Voice Notes Recording Engine
// ==========================================
async function startVoiceRecording() {
    if (state.voiceRecorder) return;
    initAudio();

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        let options = { mimeType: 'audio/webm;codecs=opus' };
        if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            if (MediaRecorder.isTypeSupported('audio/webm')) {
                options = { mimeType: 'audio/webm' };
            } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
                options = { mimeType: 'audio/ogg;codecs=opus' };
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                options = { mimeType: 'audio/mp4' };
            } else {
                options = {};
            }
        }

        const recorder = new MediaRecorder(stream, options);
        const chunks = [];

        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        const startTime = Date.now();
        DOM.voiceRecordingBar.classList.remove('hidden');
        DOM.voiceRecordingBar.classList.add('flex');
        DOM.voiceRecordingTimer.innerText = '0:00';

        const timerInterval = setInterval(() => {
            const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            DOM.voiceRecordingTimer.innerText = formatDuration(elapsedSec);
        }, 500);

        state.voiceRecorder = {
            mediaRecorder: recorder,
            stream: stream,
            chunks: chunks,
            startTime: startTime,
            timerInterval: timerInterval
        };

        recorder.start(100);
        showToast('Recording voice note...', 'info', 1800);
    } catch (err) {
        console.error('Failed to access microphone:', err);
        showToast('Microphone access denied or unavailable.', 'error');
    }
}

function cancelVoiceRecording() {
    if (!state.voiceRecorder) return;
    clearInterval(state.voiceRecorder.timerInterval);
    state.voiceRecorder.mediaRecorder.ondataavailable = null;
    state.voiceRecorder.mediaRecorder.onstop = null;
    if (state.voiceRecorder.mediaRecorder.state !== 'inactive') {
        state.voiceRecorder.mediaRecorder.stop();
    }
    state.voiceRecorder.stream.getTracks().forEach(t => t.stop());
    state.voiceRecorder = null;
    DOM.voiceRecordingBar.classList.add('hidden');
    DOM.voiceRecordingBar.classList.remove('flex');
    showToast('Voice note cancelled', 'info');
}

function sendVoiceRecording() {
    if (!state.voiceRecorder) return;
    const { mediaRecorder, stream, chunks, startTime, timerInterval } = state.voiceRecorder;
    clearInterval(timerInterval);
    const durationSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));

    mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result;
            const voiceMsg = {
                id: generateUUID(),
                type: 'VOICE_NOTE',
                isSelf: true,
                senderId: state.myId,
                senderUserId: state.user.userId,
                senderName: state.user.name,
                avatarColor: state.user.avatarColor,
                audioData: dataUrl,
                duration: durationSec,
                timestamp: Date.now(),
                delivered: false
            };

            state.messages.push(voiceMsg);
            Storage.saveChatHistory(state.messages);
            renderVoiceNoteMessage(voiceMsg);
            playSound('send');

            broadcastPayload({
                type: 'VOICE_NOTE',
                message: voiceMsg
            });
        };
        reader.readAsDataURL(blob);
    };

    if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    state.voiceRecorder = null;
    DOM.voiceRecordingBar.classList.add('hidden');
    DOM.voiceRecordingBar.classList.remove('flex');
}

// ==========================================
// 24. WebRTC Video & Voice Calling Engine
// ==========================================
let isCallMinimized = false;

function toggleMinimizeCall() {
    isCallMinimized = !isCallMinimized;
    if (isCallMinimized) {
        DOM.activeCallOverlay.classList.remove('p-4', 'md:p-6');
        DOM.activeCallOverlay.classList.add('bottom-4', 'right-4', 'w-80', 'h-96', 'rounded-3xl', 'shadow-2xl', 'p-3', 'border', 'border-primary/40');
    } else {
        DOM.activeCallOverlay.classList.remove('bottom-4', 'right-4', 'w-80', 'h-96', 'rounded-3xl', 'shadow-2xl', 'p-3', 'border', 'border-primary/40');
        DOM.activeCallOverlay.classList.add('p-4', 'md:p-6');
    }
}

function openActiveCallUI(peer, callType, isIncoming) {
    DOM.callPeerName.innerText = peer.name || 'Connected Peer';
    DOM.callPeerAvatarSm.innerText = getInitials(peer.name || 'Peer');
    DOM.callPeerAvatarSm.style.backgroundColor = peer.avatarColor || '#3b82f6';

    DOM.callVoiceAvatar.innerText = getInitials(peer.name || 'Peer');
    DOM.callVoiceAvatar.style.backgroundColor = peer.avatarColor || '#3b82f6';

    DOM.callDurationTimer.innerText = '00:00';
    DOM.callMicOnIcon.classList.remove('hidden');
    DOM.callMicOffIcon.classList.add('hidden');
    DOM.callToggleMicBtn.classList.remove('btn-error');

    DOM.callCamOnIcon.classList.remove('hidden');
    DOM.callCamOffIcon.classList.add('hidden');
    DOM.callToggleCamBtn.classList.remove('btn-error');
    DOM.localVideoPip.classList.remove('opacity-30');

    if (callType === 'video') {
        DOM.callToggleCamBtn.classList.remove('hidden');
        DOM.callShareScreenBtn.classList.remove('hidden');
    } else {
        DOM.callToggleCamBtn.classList.add('hidden');
        DOM.callShareScreenBtn.classList.add('hidden');
    }

    DOM.activeCallOverlay.classList.remove('hidden');
}

async function startCall(callType = 'voice') {
    initAudio();
    if (state.activeCall) {
        showToast('A call is already in progress.', 'warning');
        return;
    }
    const count = state.peers.size;
    if (count === 0) {
        showToast('Connect to a peer first to start a call.', 'warning');
        return;
    }

    const [targetPeerId, targetPeer] = state.peers.entries().next().value;
    if (!targetPeerId) return;

    try {
        showToast(`Starting ${callType} call...`, 'info');
        const constraints = {
            audio: true,
            video: callType === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
        };

        const localStream = await navigator.mediaDevices.getUserMedia(constraints);

        openActiveCallUI(targetPeer, callType, false);
        DOM.callStatusText.innerText = `Calling ${targetPeer.name}...`;
        DOM.callStatusBadge.className = 'badge badge-warning badge-xs font-mono';
        DOM.callStatusBadge.innerText = 'Calling';

        if (callType === 'video') {
            DOM.localVideo.srcObject = localStream;
            DOM.localVideoPip.classList.remove('hidden');
        } else {
            DOM.localVideoPip.classList.add('hidden');
        }

        startRingback();

        const mediaConnection = state.peer.call(targetPeerId, localStream, {
            metadata: {
                callType: callType,
                callerName: state.user.name,
                callerAvatarColor: state.user.avatarColor,
                callerUserId: state.user.userId
            }
        });

        state.activeCall = {
            mediaConnection: mediaConnection,
            localStream: localStream,
            remoteStream: null,
            type: callType,
            peerId: targetPeerId,
            peerName: targetPeer.name,
            startTime: null,
            durationInterval: null,
            isMuted: false,
            isCamOff: false,
            isScreenSharing: false
        };

        mediaConnection.on('stream', (remoteStream) => {
            handleRemoteCallStream(remoteStream);
        });

        mediaConnection.on('close', () => {
            endActiveCall('Call ended');
        });

        mediaConnection.on('error', (err) => {
            console.error('MediaConnection error:', err);
            endActiveCall('Call connection failed');
        });

    } catch (err) {
        console.error('Failed to get user media for call:', err);
        showToast('Camera or Microphone access denied / unavailable.', 'error');
        stopCallAudio();
        DOM.activeCallOverlay.classList.add('hidden');
    }
}

function handleIncomingMediaCall(mediaConnection) {
    initAudio();
    if (state.activeCall) {
        mediaConnection.close();
        return;
    }

    const meta = mediaConnection.metadata || {};
    const callerName = meta.callerName || (state.peers.get(mediaConnection.peer) && state.peers.get(mediaConnection.peer).name) || 'Connected Peer';
    const callerAvatarColor = meta.callerAvatarColor || '#3b82f6';
    const callType = meta.callType || 'voice';

    state.incomingCall = {
        mediaConnection: mediaConnection,
        callerPeerId: mediaConnection.peer,
        callerName: callerName,
        callerAvatarColor: callerAvatarColor,
        callType: callType
    };

    DOM.incomingCallerName.innerText = callerName;
    DOM.incomingCallerAvatar.innerText = getInitials(callerName);
    DOM.incomingCallerAvatar.style.backgroundColor = callerAvatarColor;

    if (callType === 'video') {
        DOM.incomingCallIconVideo.classList.remove('hidden');
        DOM.incomingCallIconVoice.classList.add('hidden');
        DOM.incomingCallTypeText.innerText = 'Incoming Video Call...';
    } else {
        DOM.incomingCallIconVideo.classList.add('hidden');
        DOM.incomingCallIconVoice.classList.remove('hidden');
        DOM.incomingCallTypeText.innerText = 'Incoming Voice Call...';
    }

    startRingtone();
    DOM.incomingCallModal.showModal();
}

async function acceptIncomingCall() {
    initAudio();
    if (!state.incomingCall) return;
    const { mediaConnection, callerPeerId, callerName, callerAvatarColor, callType } = state.incomingCall;
    stopCallAudio();
    DOM.incomingCallModal.close();
    state.incomingCall = null;

    try {
        const constraints = {
            audio: true,
            video: callType === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
        };

        const localStream = await navigator.mediaDevices.getUserMedia(constraints);

        openActiveCallUI({ name: callerName, avatarColor: callerAvatarColor }, callType, true);

        if (callType === 'video') {
            DOM.localVideo.srcObject = localStream;
            DOM.localVideoPip.classList.remove('hidden');
        } else {
            DOM.localVideoPip.classList.add('hidden');
        }

        mediaConnection.answer(localStream);

        state.activeCall = {
            mediaConnection: mediaConnection,
            localStream: localStream,
            remoteStream: null,
            type: callType,
            peerId: callerPeerId,
            peerName: callerName,
            startTime: null,
            durationInterval: null,
            isMuted: false,
            isCamOff: false,
            isScreenSharing: false
        };

        mediaConnection.on('stream', (remoteStream) => {
            handleRemoteCallStream(remoteStream);
        });

        mediaConnection.on('close', () => {
            endActiveCall('Call ended');
        });

        mediaConnection.on('error', (err) => {
            console.error('Call media error:', err);
            endActiveCall('Call connection failed');
        });

    } catch (err) {
        console.error('Failed to answer call with media:', err);
        showToast('Could not access camera/mic to answer.', 'error');
        mediaConnection.close();
        endActiveCall('Permissions denied');
    }
}

function declineIncomingCall() {
    stopCallAudio();
    DOM.incomingCallModal.close();
    if (state.incomingCall) {
        const { mediaConnection, callerPeerId, callerName } = state.incomingCall;
        try {
            mediaConnection.close();
        } catch (e) {}

        const p = state.peers.get(callerPeerId);
        if (p && p.connection && p.connection.open) {
            p.connection.send({ type: 'CALL_REJECT' });
        }
        addSystemMessage(`Missed / declined call from ${callerName}`);
        state.incomingCall = null;
    }
}

function handleRemoteCallStream(remoteStream) {
    if (!state.activeCall) return;
    stopCallAudio();
    state.activeCall.remoteStream = remoteStream;

    DOM.callStatusBadge.className = 'badge badge-success badge-xs font-mono';
    DOM.callStatusBadge.innerText = 'Connected';
    DOM.callStatusText.innerText = 'Connected';

    state.activeCall.startTime = Date.now();
    if (state.activeCall.durationInterval) clearInterval(state.activeCall.durationInterval);
    state.activeCall.durationInterval = setInterval(() => {
        if (!state.activeCall || !state.activeCall.startTime) return;
        const elapsedSec = Math.floor((Date.now() - state.activeCall.startTime) / 1000);
        DOM.callDurationTimer.innerText = formatDuration(elapsedSec);
    }, 1000);

    const hasVideo = remoteStream.getVideoTracks().length > 0 && remoteStream.getVideoTracks()[0].enabled;
    if (hasVideo && state.activeCall.type === 'video') {
        DOM.remoteVideo.srcObject = remoteStream;
        DOM.remoteVideo.classList.remove('hidden');
        DOM.callVoiceStage.classList.add('hidden');
    } else {
        DOM.remoteVideo.classList.add('hidden');
        DOM.callVoiceStage.classList.remove('hidden');
        DOM.remoteVideo.srcObject = remoteStream;
    }

    playSound('complete');
    showToast('Call connected', 'success');
}

function endActiveCall(reason = 'Call ended') {
    stopCallAudio();
    if (!state.activeCall) {
        DOM.activeCallOverlay.classList.add('hidden');
        return;
    }

    const { mediaConnection, localStream, startTime, type, peerName, peerId } = state.activeCall;

    if (state.activeCall.durationInterval) {
        clearInterval(state.activeCall.durationInterval);
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
    }

    if (mediaConnection) {
        try { mediaConnection.close(); } catch (e) {}
    }

    DOM.remoteVideo.srcObject = null;
    DOM.localVideo.srcObject = null;
    DOM.activeCallOverlay.classList.add('hidden');

    const p = state.peers.get(peerId);
    if (p && p.connection && p.connection.open) {
        try { p.connection.send({ type: 'CALL_HANGUP' }); } catch (e) {}
    }

    const durationSec = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    const durationStr = formatDuration(durationSec);
    const icon = type === 'video' ? '📹' : '📞';
    addSystemMessage(`${icon} ${type === 'video' ? 'Video' : 'Voice'} call ended • ${durationStr}`);
    showToast(reason, 'info');

    state.activeCall = null;
}

function toggleCallMic() {
    if (!state.activeCall || !state.activeCall.localStream) return;
    const audioTrack = state.activeCall.localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    state.activeCall.isMuted = !state.activeCall.isMuted;
    audioTrack.enabled = !state.activeCall.isMuted;

    if (state.activeCall.isMuted) {
        DOM.callMicOnIcon.classList.add('hidden');
        DOM.callMicOffIcon.classList.remove('hidden');
        DOM.callToggleMicBtn.classList.add('btn-error');
        showToast('Microphone muted', 'info');
    } else {
        DOM.callMicOnIcon.classList.remove('hidden');
        DOM.callMicOffIcon.classList.add('hidden');
        DOM.callToggleMicBtn.classList.remove('btn-error');
        showToast('Microphone unmuted', 'info');
    }
}

function toggleCallCam() {
    if (!state.activeCall || !state.activeCall.localStream) return;
    const videoTrack = state.activeCall.localStream.getVideoTracks()[0];
    if (!videoTrack) {
        showToast('No camera track available', 'warning');
        return;
    }

    state.activeCall.isCamOff = !state.activeCall.isCamOff;
    videoTrack.enabled = !state.activeCall.isCamOff;

    if (state.activeCall.isCamOff) {
        DOM.callCamOnIcon.classList.add('hidden');
        DOM.callCamOffIcon.classList.remove('hidden');
        DOM.callToggleCamBtn.classList.add('btn-error');
        DOM.localVideoPip.classList.add('opacity-30');
        showToast('Camera turned off', 'info');
    } else {
        DOM.callCamOnIcon.classList.remove('hidden');
        DOM.callCamOffIcon.classList.add('hidden');
        DOM.callToggleCamBtn.classList.remove('btn-error');
        DOM.localVideoPip.classList.remove('opacity-30');
        showToast('Camera turned on', 'info');
    }
}

async function toggleCallScreenShare() {
    if (!state.activeCall || !state.activeCall.localStream) return;
    try {
        if (!state.activeCall.isScreenSharing) {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];

            if (state.activeCall.mediaConnection && state.activeCall.mediaConnection.peerConnection) {
                const senders = state.activeCall.mediaConnection.peerConnection.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    videoSender.replaceTrack(screenTrack);
                }
            }

            DOM.localVideo.srcObject = screenStream;
            state.activeCall.isScreenSharing = true;
            DOM.callShareScreenBtn.classList.add('btn-primary');

            screenTrack.onended = () => {
                revertScreenShare();
            };
            showToast('Screen sharing started', 'info');
        } else {
            revertScreenShare();
        }
    } catch (err) {
        console.warn('Screen share cancelled or failed:', err);
    }
}

function revertScreenShare() {
    if (!state.activeCall || !state.activeCall.isScreenSharing) return;
    const originalVideoTrack = state.activeCall.localStream.getVideoTracks()[0];
    if (state.activeCall.mediaConnection && state.activeCall.mediaConnection.peerConnection) {
        const senders = state.activeCall.mediaConnection.peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && originalVideoTrack) {
            videoSender.replaceTrack(originalVideoTrack);
        }
    }
    DOM.localVideo.srcObject = state.activeCall.localStream;
    state.activeCall.isScreenSharing = false;
    DOM.callShareScreenBtn.classList.remove('btn-primary');
    showToast('Screen sharing stopped', 'info');
}

// ==========================================
// 25. Event Listeners & Initialization
// ==========================================
function setupEventListeners() {
    ['click', 'keydown'].forEach(evt => {
        window.addEventListener(evt, () => initAudio(), { once: true });
    });

    DOM.copyBtn.addEventListener('click', () => {
        if (!state.myId) return;
        navigator.clipboard.writeText(state.myId).then(() => {
            showToast('Peer ID copied to clipboard!', 'success');
        });
    });

    DOM.shareLinkBtn.addEventListener('click', () => {
        if (!state.myId) return;
        navigator.clipboard.writeText(getInviteLink()).then(() => {
            showToast('Invite link copied to clipboard!', 'success');
        });
    });

    if (DOM.emptyInviteBtn) {
        DOM.emptyInviteBtn.addEventListener('click', () => {
            if (!state.myId) {
                showToast('Connecting to network...', 'warning');
                return;
            }
            navigator.clipboard.writeText(getInviteLink()).then(() => {
                showToast('Invite link copied to clipboard!', 'success');
            });
        });
    }

    DOM.showQrBtn.addEventListener('click', showQRCodeModal);

    DOM.pasteIdBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                DOM.peerIdInput.value = text.trim();
                DOM.peerIdInput.focus();
            }
        } catch (e) {
            showToast('Paste manually with Ctrl+V / Cmd+V', 'info');
        }
    });

    DOM.connectForm.addEventListener('submit', (e) => {
        e.preventDefault();
        connectToRemotePeer(DOM.peerIdInput.value);
    });

    DOM.tabBtnActive.addEventListener('click', () => switchSidebarTab('active'));
    DOM.tabBtnContacts.addEventListener('click', () => switchSidebarTab('contacts'));

    DOM.sendMessageBtn.addEventListener('click', handleSendMessage);
    DOM.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    DOM.messageInput.addEventListener('input', handleTypingInput);

    DOM.scrollBottomBtn.addEventListener('click', () => {
        DOM.chatDiv.scrollTo({
            top: DOM.chatDiv.scrollHeight,
            behavior: 'smooth'
        });
        DOM.scrollBottomBtn.classList.add('hidden');
    });

    DOM.chatDiv.addEventListener('scroll', () => {
        const threshold = 140;
        const isNearBottom = DOM.chatDiv.scrollHeight - DOM.chatDiv.scrollTop - DOM.chatDiv.clientHeight <= threshold;
        if (isNearBottom) {
            DOM.scrollBottomBtn.classList.add('hidden');
        } else {
            DOM.scrollBottomBtn.classList.remove('hidden');
        }
    });

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

    // Clicking header peer card opens drawer on mobile
    if (DOM.headerPeerCard) {
        DOM.headerPeerCard.style.cursor = 'pointer';
        DOM.headerPeerCard.addEventListener('click', () => {
            if (window.innerWidth < 768) {
                toggleMobileDrawer(true);
            }
        });
    }

    // Call header buttons
    if (DOM.voiceCallHeaderBtn) DOM.voiceCallHeaderBtn.addEventListener('click', () => startCall('voice'));
    if (DOM.videoCallHeaderBtn) DOM.videoCallHeaderBtn.addEventListener('click', () => startCall('video'));

    // Incoming Call buttons
    if (DOM.incomingAcceptBtn) DOM.incomingAcceptBtn.addEventListener('click', acceptIncomingCall);
    if (DOM.incomingDeclineBtn) DOM.incomingDeclineBtn.addEventListener('click', declineIncomingCall);
    if (DOM.incomingCallModal) {
        DOM.incomingCallModal.addEventListener('close', () => {
            if (state.incomingCall) declineIncomingCall();
        });
    }

    // Active Call controls
    if (DOM.callEndBtn) DOM.callEndBtn.addEventListener('click', () => endActiveCall('Call ended'));
    if (DOM.callToggleMicBtn) DOM.callToggleMicBtn.addEventListener('click', toggleCallMic);
    if (DOM.callToggleCamBtn) DOM.callToggleCamBtn.addEventListener('click', toggleCallCam);
    if (DOM.callShareScreenBtn) DOM.callShareScreenBtn.addEventListener('click', toggleCallScreenShare);
    if (DOM.callCollapseBtn) DOM.callCollapseBtn.addEventListener('click', toggleMinimizeCall);

    // Voice Note buttons
    if (DOM.voiceNoteBtn) DOM.voiceNoteBtn.addEventListener('click', startVoiceRecording);
    if (DOM.voiceCancelBtn) DOM.voiceCancelBtn.addEventListener('click', cancelVoiceRecording);
    if (DOM.voiceSendBtn) DOM.voiceSendBtn.addEventListener('click', sendVoiceRecording);

    const openProfileModal = () => {
        DOM.profileNameInp.value = state.user.name;
        DOM.profileBioInp.value = state.user.bio || '';
        DOM.profileModal.showModal();
    };

    if (DOM.menuEditProfileBtn) DOM.menuEditProfileBtn.addEventListener('click', openProfileModal);
    if (DOM.selfSidebarEditBtn) DOM.selfSidebarEditBtn.addEventListener('click', openProfileModal);
    DOM.profileForm.addEventListener('submit', handleSaveProfile);
    DOM.profileCancelBtn.addEventListener('click', () => DOM.profileModal.close());

    if (DOM.menuBackupBtn) DOM.menuBackupBtn.addEventListener('click', () => DOM.backupModal.showModal());
    DOM.exportBackupBtn.addEventListener('click', exportFullBackup);
    DOM.importBackupBtn.addEventListener('click', importFullBackup);
    DOM.modalSyncBtn.addEventListener('click', () => {
        triggerMeshSync();
        DOM.backupModal.close();
    });
    DOM.syncNowBtn.addEventListener('click', triggerMeshSync);
    if (DOM.syncNowHeaderBtn) DOM.syncNowHeaderBtn.addEventListener('click', triggerMeshSync);

    // Stop video when closing media modal
    DOM.mediaModal.addEventListener('close', () => {
        DOM.modalVideoPreview.pause();
        DOM.modalVideoPreview.src = '';
    });

    DOM.soundToggleBtn.addEventListener('click', toggleSound);
    DOM.exportChatBtn.addEventListener('click', exportChatHistory);
    DOM.clearChatBtn.addEventListener('click', clearChat);
}

// ==========================================
// 24. PWA Registration & Install Prompt
// ==========================================
function setupPWA() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then((reg) => {
                    console.log('ServiceWorker registered with scope:', reg.scope);
                })
                .catch((err) => {
                    console.warn('ServiceWorker registration failed:', err);
                });
        });
    }

    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (DOM.menuPwaInstallItem) {
            DOM.menuPwaInstallItem.classList.remove('hidden');
        }
        if (DOM.pwaInstallBtn) {
            DOM.pwaInstallBtn.classList.remove('hidden');
        }
    });

    if (DOM.pwaInstallBtn) {
        DOM.pwaInstallBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const choiceResult = await deferredPrompt.userChoice;
            if (choiceResult && choiceResult.outcome === 'accepted') {
                showToast('Installing PeerWave...', 'success');
            }
            deferredPrompt = null;
            if (DOM.menuPwaInstallItem) DOM.menuPwaInstallItem.classList.add('hidden');
            DOM.pwaInstallBtn.classList.add('hidden');
        });
    }

    window.addEventListener('appinstalled', () => {
        if (DOM.menuPwaInstallItem) DOM.menuPwaInstallItem.classList.add('hidden');
        if (DOM.pwaInstallBtn) DOM.pwaInstallBtn.classList.add('hidden');
        showToast('PeerWave installed successfully!', 'success');
    });
}

// ==========================================
// 25. App Bootstrap
// ==========================================
function tryInitializePeer(retries = 15) {
    if (typeof Peer !== 'undefined') {
        initializePeer();
    } else if (retries > 0) {
        setTimeout(() => tryInitializePeer(retries - 1), 200);
    } else {
        updateConnectionStatus('error', 'Offline / CDN Error');
        showToast('PeerJS library failed to load. Check internet connection.', 'error');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    updateSoundUI();
    updateUserProfileUI();
    updateHeaderPeerInfo();
    renderContactsList();
    restoreChatFromStorage();
    setupEventListeners();
    setupQuickEmojiBar();
    setupFileHandling();
    setupPWA();
    tryInitializePeer();
});
