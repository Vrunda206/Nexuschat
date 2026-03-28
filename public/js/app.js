// ╔══════════════════════════════════════════════════════╗
// ║           NexusChat — Frontend Application           ║
// ╚══════════════════════════════════════════════════════╝

// ── STATE ──────────────────────────────────────────────────
const state = {
  token:        null,
  user:         null,
  socket:       null,
  currentRoom:  'general',
  recentMessages: [],
  pendingFile:  null,
  typingTimer:  null,
  notificationsEnabled: true,
  unreadCounts: {},
  isCurrentTab: true,
};

const ROOM_ICONS = {
  general: '💼', tech: '💻', random: '📈', announcements: '📢'
};
const ROOM_NAMES = {
  general: 'Operations', tech: 'Engineering', random: 'Management', announcements: 'Announcements'
};

// ── ON LOAD ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const savedToken = localStorage.getItem('nexuschat_token');
  const savedUser  = localStorage.getItem('nexuschat_user');

  if (savedToken && savedUser) {
    state.token = savedToken;
    state.user  = JSON.parse(savedUser);
    showApp();
    initSocket();
  }

  // Emoji picker: click emojis
  const emojiGrid = document.querySelector('.emoji-grid');
  if (emojiGrid) {
    emojiGrid.addEventListener('click', (e) => {
      const char = e.target.textContent.trim();
      if (char.length > 0 && char !== emojiGrid.textContent.trim()) {
        const input = document.getElementById('message-input');
        input.value += char;
        input.focus();
        closeEmojiPicker();
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.emoji-btn') && !e.target.closest('.emoji-picker')) {
      closeEmojiPicker();
    }
  });

  // Page visibility for notifications
  document.addEventListener('visibilitychange', () => {
    state.isCurrentTab = !document.hidden;
  });
});

// ── AUTH ───────────────────────────────────────────────────
let currentTab = 'login';

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
  document.getElementById('auth-submit-btn').textContent = tab === 'login' ? 'Login' : 'Create Account';
  document.getElementById('auth-error').classList.add('hidden');
}

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl  = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit-btn');

  if (!username || !password) {
    showAuthError('Please fill all fields');
    return;
  }

  submitBtn.textContent = 'Please wait...';
  submitBtn.disabled = true;

  try {
    const res = await fetch(`/api/auth/${currentTab}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthError(data.error || 'Something went wrong');
      return;
    }

    state.token = data.token;
    state.user  = data.user;
    localStorage.setItem('nexuschat_token', data.token);
    localStorage.setItem('nexuschat_user', JSON.stringify(data.user));

    showApp();
    initSocket();
  } catch {
    showAuthError('Network error. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = currentTab === 'login' ? 'Login' : 'Create Account';
  }
});

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');

  // Set user info in topbar
  document.getElementById('current-username').textContent = state.user.username;
  const avEl = document.getElementById('current-avatar');
  avEl.textContent = state.user.username[0].toUpperCase();
  avEl.className = `avatar av-${state.user.avatar || 'blue'}`;

  // Update message input placeholder
  document.getElementById('message-input').placeholder = `Message ${ROOM_NAMES[state.currentRoom]}...`;
}

function logout() {
  if (state.socket) state.socket.disconnect();
  localStorage.removeItem('nexuschat_token');
  localStorage.removeItem('nexuschat_user');
  state.token = null;
  state.user  = null;
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('messages-container').innerHTML = '';
}

// ── SOCKET.IO ──────────────────────────────────────────────
function initSocket() {
  state.socket = io({ auth: { token: state.token } });

  state.socket.on('connect', () => {
    console.log('✅ Socket connected');
    joinRoom(state.currentRoom, document.querySelector('.room-item.active'));
  });

  state.socket.on('connect_error', (err) => {
    console.error('Socket error:', err.message);
    showToast('Connection error: ' + err.message, 'error');
  });

  // Chat history on join
  state.socket.on('chat_history', (messages) => {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    state.recentMessages = [];

    if (messages.length === 0) {
      container.innerHTML = `<div class="loading" style="color:var(--text3)">No messages yet. Start the conversation!</div>`;
      return;
    }

    let lastDate = '';
    messages.forEach(msg => {
      const msgDate = new Date(msg.createdAt).toLocaleDateString();
      if (msgDate !== lastDate) {
        appendDateDivider(msgDate);
        lastDate = msgDate;
      }
      appendMessage(msg);
    });
    scrollToBottom();
  });

  // Incoming messages
  state.socket.on('receive_message', (msg) => {
    const msgDate = new Date(msg.createdAt).toLocaleDateString();
    appendMessage(msg);

    // Store for AI context (text messages only)
    if (msg.type === 'text') {
      state.recentMessages.push(msg);
      if (state.recentMessages.length > 10) state.recentMessages.shift();
    }

    // Update sidebar preview
    if (msg.type !== 'system' && msg.content) {
      const preview = document.getElementById(`preview-${state.currentRoom}`);
      if (preview) preview.textContent = `${msg.senderName}: ${msg.content}`;
    }

    // Notification for messages from others
    if (msg.senderName !== state.user?.username && msg.type !== 'system') {
      if (!state.isCurrentTab && state.notificationsEnabled) {
        showBrowserNotification(msg);
      }
      if (document.hidden) {
        updateUnreadBadge(state.currentRoom);
      }
    }

    scrollToBottom();
  });

  // Typing indicators
  state.socket.on('user_typing', ({ username }) => {
    if (username !== state.user?.username) {
      document.getElementById('typing-indicator').textContent = `${username} is typing...`;
    }
  });
  state.socket.on('user_stopped_typing', ({ username }) => {
    const el = document.getElementById('typing-indicator');
    if (el.textContent.includes(username)) el.textContent = '';
  });

  // Online users
  state.socket.on('online_users', (users) => {
    renderOnlineUsers(users);
    document.getElementById('room-member-count').textContent =
      `${users.length} member${users.length !== 1 ? 's' : ''} online`;
  });

  // Reactions
  state.socket.on('reaction_updated', ({ messageId, reactions }) => {
    updateReactionsUI(messageId, reactions);
  });

  state.socket.on('disconnect', () => {
    showToast('Disconnected from server', 'warning');
  });
}

// ── ROOMS ──────────────────────────────────────────────────
function joinRoom(room, el) {
  if (state.currentRoom === room && state.socket?.connected) return;

  // Update UI active state
  document.querySelectorAll('.room-item').forEach(r => r.classList.remove('active'));
  if (el) el.classList.add('active');
  
  // Close sidebar on mobile
  const sidebar = document.querySelector('.sidebar');
  if (sidebar && sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
  }

  state.currentRoom = room;
  state.recentMessages = [];

  // Update header
  document.getElementById('room-icon').textContent = ROOM_ICONS[room] || '💬';
  document.getElementById('room-name-display').textContent = `${ROOM_NAMES[room] || room}`;
  document.getElementById('message-input').placeholder = `Message ${ROOM_NAMES[room] || room}...`;

  // Clear unread badge
  const badge = document.getElementById(`badge-${room}`);
  if (badge) { badge.classList.add('hidden'); badge.textContent = '0'; }
  state.unreadCounts[room] = 0;

  // Clear messages and join via socket
  document.getElementById('messages-container').innerHTML =
    `<div class="loading"><div class="spinner"></div>Loading messages...</div>`;

  if (state.socket?.connected) {
    state.socket.emit('join_room', { room });
  }
}

// ── MESSAGES ───────────────────────────────────────────────
function appendMessage(msg) {
  const container = document.getElementById('messages-container');
  const isMe = msg.senderName === state.user?.username;

  // System message
  if (msg.type === 'system') {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.innerHTML = `<span>${msg.content}</span>`;
    container.appendChild(div);
    return;
  }

  const row = document.createElement('div');
  row.className = `msg-row ${isMe ? 'me' : ''}`;
  row.dataset.msgId = msg._id;

  const avatarColor = msg.senderAvatar || getAvatarColor(msg.senderName);
  const initials = msg.senderName ? msg.senderName[0].toUpperCase() : '?';
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let bubbleContent = '';

  if (msg.type === 'image' && msg.file) {
    bubbleContent = `
      <div class="image-bubble">
        <img src="${msg.file.url}" alt="${msg.file.originalName}" onclick="window.open('${msg.file.url}','_blank')">
      </div>`;
  } else if (msg.type === 'audio' && msg.file) {
    bubbleContent = `
      <div class="audio-bubble">
        <audio controls src="${msg.file.url}" style="max-width: 200px; height: 40px; border-radius: 20px;"></audio>
      </div>`;
  } else if (msg.type === 'file' && msg.file) {
    const sizeStr = formatFileSize(msg.file.size);
    bubbleContent = `
      <a class="file-bubble" href="${msg.file.url}" target="_blank" download="${msg.file.originalName}">
        <span class="file-icon">📄</span>
        <div class="file-info">
          <div class="file-name">${escapeHtml(msg.file.originalName)}</div>
          <div class="file-size">${sizeStr}</div>
        </div>
        <span style="font-size:16px">⬇️</span>
      </a>`;
  } else {
    bubbleContent = `<div class="bubble">${escapeHtml(msg.content)}</div>`;
  }

  // Reactions
  const reactionsHtml = msg.reactions?.length
    ? `<div class="bubble-reactions">${msg.reactions.map(r =>
        `<div class="reaction-chip" onclick="addReaction('${msg._id}','${r.emoji}')">${r.emoji}<span class="count">${r.users.length}</span></div>`
      ).join('')}</div>`
    : '';

  row.innerHTML = `
    <div class="avatar av-${avatarColor}">${initials}</div>
    <div class="msg-content">
      <div class="msg-meta">
        ${!isMe ? `<span class="msg-name">${escapeHtml(msg.senderName)}</span>` : ''}
        <span>${time}</span>
      </div>
      ${bubbleContent}
      ${reactionsHtml}
    </div>
    <button class="reaction-add" onclick="quickReact('${msg._id}')" title="React">😊</button>
  `;

  container.appendChild(row);
}

function appendDateDivider(dateStr) {
  const container = document.getElementById('messages-container');
  const div = document.createElement('div');
  div.className = 'date-divider';
  div.textContent = dateStr === new Date().toLocaleDateString() ? 'Today' : dateStr;
  container.appendChild(div);
}

function updateReactionsUI(messageId, reactions) {
  const row = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (!row) return;
  let reactionsDiv = row.querySelector('.bubble-reactions');
  if (!reactionsDiv) {
    reactionsDiv = document.createElement('div');
    reactionsDiv.className = 'bubble-reactions';
    row.querySelector('.msg-content').appendChild(reactionsDiv);
  }
  reactionsDiv.innerHTML = reactions.map(r =>
    `<div class="reaction-chip" onclick="addReaction('${messageId}','${r.emoji}')">${r.emoji}<span class="count">${r.users.length}</span></div>`
  ).join('');
}

function scrollToBottom() {
  const el = document.getElementById('messages-container');
  el.scrollTop = el.scrollHeight;
}

// ── SEND ───────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('message-input');
  const text  = input.value.trim();

  if (!text && !state.pendingFile) return;

  hideSuggestions();

  if (state.pendingFile) {
    await sendFile(text);
  } else {
    state.socket.emit('send_message', {
      room: state.currentRoom,
      content: text,
      type: 'text'
    });
  }

  input.value = '';
  stopTypingSignal();
}

async function sendFile(caption = '') {
  const fileData = state.pendingFile;
  clearFilePreview();

  try {
    const formData = new FormData();
    formData.append('file', fileData);

    const res = await fetch('/api/messages/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      body: formData
    });

    if (!res.ok) { showToast('Upload failed', 'error'); return; }
    const data = await res.json();

    let msgType = 'file';
    let fileIsImage = data.file.isImage;
    if (fileIsImage) msgType = 'image';
    if (data.file.originalName && data.file.originalName.startsWith('Voice_Message')) msgType = 'audio';

    state.socket.emit('send_message', {
      room: state.currentRoom,
      content: caption || data.file.originalName,
      type: msgType,
      file: data.file
    });

    showToast(`${msgType === 'image' ? 'Image' : msgType === 'audio' ? 'Voice message' : 'File'} sent!`, 'success');
  } catch {
    showToast('Upload failed', 'error');
  }
}

function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── TYPING ─────────────────────────────────────────────────
function handleTyping() {
  if (!state.socket) return;
  state.socket.emit('typing', { room: state.currentRoom });
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(stopTypingSignal, 2000);
}
function stopTypingSignal() {
  clearTimeout(state.typingTimer);
  if (state.socket) state.socket.emit('stop_typing', { room: state.currentRoom });
}

// ── FILE HANDLING ──────────────────────────────────────────
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  state.pendingFile = file;

  const preview = document.getElementById('file-preview');
  document.getElementById('file-preview-name').textContent = file.name;
  document.getElementById('file-preview-size').textContent = formatFileSize(file.size);
  preview.classList.remove('hidden');
  document.getElementById('message-input').focus();
}

function clearFilePreview() {
  state.pendingFile = null;
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('file-input').value = '';
}

// ── AI SUGGESTIONS ─────────────────────────────────────────
async function getAISuggestions() {
  const btn = document.querySelector('.ai-btn');
  const lastMsg = state.recentMessages[state.recentMessages.length - 1];

  if (!lastMsg || lastMsg.senderName === state.user?.username) {
    showToast('No recent message to reply to', 'info');
    return;
  }

  btn.classList.add('loading-ai');
  btn.disabled = true;

  try {
    const res = await fetch('/api/messages/ai-suggestions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({
        message: lastMsg.content,
        context: state.recentMessages
      })
    });

    const data = await res.json();
    if (data.suggestions?.length) {
      showSuggestions(data.suggestions);
    } else {
      showToast('No suggestions available', 'info');
    }
  } catch {
    showToast('AI unavailable right now', 'error');
  } finally {
    btn.classList.remove('loading-ai');
    btn.disabled = false;
  }
}

function showSuggestions(suggestions) {
  const bar  = document.getElementById('suggestions-bar');
  const list = document.getElementById('suggestions-list');
  list.innerHTML = suggestions.map(s =>
    `<button class="suggestion-chip" onclick="useSuggestion('${escapeHtml(s)}')">${escapeHtml(s)}</button>`
  ).join('');
  bar.classList.remove('hidden');
}

function hideSuggestions() {
  document.getElementById('suggestions-bar').classList.add('hidden');
}

function useSuggestion(text) {
  document.getElementById('message-input').value = text;
  hideSuggestions();
  sendMessage();
}

// ── REACTIONS ──────────────────────────────────────────────
const QUICK_REACTIONS = ['👍','❤️','😂','😮','🔥','✅'];
let quickReactTarget = null;

function quickReact(messageId) {
  // Simple: cycle through quick reactions on each click
  const emoji = QUICK_REACTIONS[Math.floor(Math.random() * QUICK_REACTIONS.length)];
  addReaction(messageId, emoji);
}

function addReaction(messageId, emoji) {
  if (!state.socket) return;
  state.socket.emit('add_reaction', {
    messageId,
    emoji,
    room: state.currentRoom
  });
}

// ── ONLINE USERS ───────────────────────────────────────────
function renderOnlineUsers(users) {
  const list = document.getElementById('online-users-list');
  if (!users.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text3)">No one else here yet</div>';
    return;
  }
  list.innerHTML = users.map(u => `
    <div class="user-row">
      <div class="avatar av-${u.avatar || 'blue'}" style="width:28px;height:28px;font-size:11px;">${u.username[0].toUpperCase()}</div>
      <div class="user-row-info">
        <div class="user-row-name">${escapeHtml(u.username)} ${u.username === state.user?.username ? '(you)' : ''}</div>
        <div class="user-row-status">Online</div>
      </div>
      <div class="online-dot"></div>
    </div>
  `).join('');
}

// ── SEARCH ─────────────────────────────────────────────────
function searchMessages() {
  const q = document.getElementById('msg-search').value.toLowerCase().trim();
  const rows = document.querySelectorAll('.msg-row');
  rows.forEach(row => {
    const text = row.querySelector('.bubble')?.textContent?.toLowerCase() || '';
    row.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}

// ── MISC UI ────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

function toggleEmojiPicker() {
  document.getElementById('emoji-picker').classList.toggle('hidden');
}
function closeEmojiPicker() {
  document.getElementById('emoji-picker').classList.add('hidden');
}

function toggleDarkMode() {
  document.body.classList.toggle('light-mode');
}

function toggleNotifications() {
  state.notificationsEnabled = !state.notificationsEnabled;
  const btn = document.getElementById('notif-btn');
  btn.textContent = state.notificationsEnabled ? '🔔' : '🔕';
  showToast(state.notificationsEnabled ? 'Notifications on' : 'Notifications off');
}

function updateUnreadBadge(room) {
  state.unreadCounts[room] = (state.unreadCounts[room] || 0) + 1;
  const badge = document.getElementById(`badge-${room}`);
  if (badge) {
    badge.textContent = state.unreadCounts[room];
    badge.classList.remove('hidden');
  }
}

function showBrowserNotification(msg) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`${msg.senderName} in ${ROOM_NAMES[state.currentRoom] || state.currentRoom}`, {
      body: msg.content || 'Sent a file',
      icon: '/favicon.ico'
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
}

// Toast
let toastTimer;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const colors = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#4f8ef7' };
  toast.textContent = message;
  toast.style.borderLeft = `3px solid ${colors[type] || colors.info}`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ── VOICE MESSAGES ─────────────────────────────────────────
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

async function toggleVoiceRecord() {
  const btn = document.getElementById('voice-btn');
  if (!isRecording) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('Voice recording not supported in this browser', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.start();
      audioChunks = [];
      mediaRecorder.addEventListener("dataavailable", event => {
        audioChunks.push(event.data);
      });
      isRecording = true;
      if (btn) {
        btn.style.color = '#ef4444'; // Red processing state
        btn.title = 'Click to finish and send';
      }
      showToast('Recording... click 🎤 button again to send', 'info');
    } catch (err) {
      showToast('Microphone access denied', 'error');
    }
  } else {
    // Stop recording
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder.addEventListener("stop", () => {
        const audioBlob = new window.Blob(audioChunks, { type: 'audio/webm' });
        const file = new File([audioBlob], `Voice_Message_${new Date().getTime()}.webm`, { type: 'audio/webm' });
        state.pendingFile = file;
        sendFile('Voice Message');
        
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        
        isRecording = false;
        if (btn) {
          btn.style.color = '';
          btn.title = 'Click to record, click again to send';
        }
      });
    } else {
      isRecording = false;
      if (btn) {
        btn.style.color = '';
        btn.title = 'Click to record, click again to send';
      }
    }
  }
}

// ── UTILS ──────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const AVATAR_COLORS = ['blue', 'green', 'amber', 'pink'];
function getAvatarColor(username) {
  if (!username) return 'blue';
  const idx = username.charCodeAt(0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}
