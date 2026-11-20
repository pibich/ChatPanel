/**
 * Renderer Logic for ChatPanel Overlay
 */

const STORAGE_KEY = 'chat_panel_overlay_settings_v1';
const MAX_MESSAGES = 250;

// Default user preferences
const defaultSettings = {
  opacity: 82,
  fontSize: 14,
  showAvatars: true,
  showTimestamp: true,
  compactMode: false,
  textOutline: true,
  hideBots: true,
  botList: 'Nightbot, StreamElements, Moobot, Streamlabs, Fossabot, Wizebot, Stay_Hydrated_Bot',
  hideCommands: true,
  soundSuperchat: true,
  soundChat: false,
  lastStreamUrl: '',
  lastTiktokUrl: ''
};

let settings = loadSettings();
let allMessages = [];
let activeFilter = 'all'; // 'all' | 'vip' | 'superchat'
let platformStates = {
  youtube: { state: 'disconnected', channelTitle: '', message: 'Belum Terhubung' },
  tiktok: { state: 'disconnected', channelTitle: '', message: 'Belum Terhubung' }
};
let isAutoScrollPaused = false;
let unreadWhilePaused = 0;
let isClickThroughLocked = false;
let audioCtx = null;

// DOM Elements
const appEl = document.getElementById('app');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const quickOpacitySlider = document.getElementById('quickOpacitySlider');
const btnSimulate = document.getElementById('btnSimulate');
const btnPinTop = document.getElementById('btnPinTop');
const btnLockOverlay = document.getElementById('btnLockOverlay');
const iconUnlock = document.getElementById('iconUnlock');
const iconLock = document.getElementById('iconLock');
const lockNotice = document.getElementById('lockNotice');
const btnSettings = document.getElementById('btnSettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const settingsDrawer = document.getElementById('settingsDrawer');
const btnMinimize = document.getElementById('btnMinimize');
const btnClose = document.getElementById('btnClose');

const streamUrlInput = document.getElementById('streamUrlInput');
const btnConnect = document.getElementById('btnConnect');
const ytStatusText = document.getElementById('ytStatusText');

const tiktokInput = document.getElementById('tiktokInput');
const btnConnectTiktok = document.getElementById('btnConnectTiktok');
const ttStatusText = document.getElementById('ttStatusText');

const btnOpenConnect = document.getElementById('btnOpenConnect');
const btnClearChat = document.getElementById('btnClearChat');
const filterPills = document.querySelectorAll('.filter-pill');

const pinnedMessageBar = document.getElementById('pinnedMessageBar');
const pinnedMessageContent = document.getElementById('pinnedMessageContent');
const btnUnpinMessage = document.getElementById('btnUnpinMessage');

const chatContainer = document.getElementById('chatContainer');
const chatList = document.getElementById('chatList');
const emptyState = document.getElementById('emptyState');
const btnResumeScroll = document.getElementById('btnResumeScroll');
const unreadCountEl = document.getElementById('unreadCount');

// Settings Inputs
const opacityRange = document.getElementById('opacityRange');
const opacityVal = document.getElementById('opacityVal');
const fontSizeRange = document.getElementById('fontSizeRange');
const fontSizeVal = document.getElementById('fontSizeVal');
const chkShowAvatars = document.getElementById('chkShowAvatars');
const chkShowTimestamp = document.getElementById('chkShowTimestamp');
const chkCompactMode = document.getElementById('chkCompactMode');
const chkTextOutline = document.getElementById('chkTextOutline');
const chkHideBots = document.getElementById('chkHideBots');
const botListInput = document.getElementById('botListInput');
const chkHideCommands = document.getElementById('chkHideCommands');
const chkSoundSuperchat = document.getElementById('chkSoundSuperchat');
const chkSoundChat = document.getElementById('chkSoundChat');

// ==================== INITIALIZATION ====================

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...defaultSettings, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return { ...defaultSettings };
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function applySettingsToUI() {
  // Opacity
  const alpha = (settings.opacity / 100).toFixed(2);
  document.documentElement.style.setProperty('--bg-opacity', alpha);
  opacityRange.value = settings.opacity;
  quickOpacitySlider.value = settings.opacity;
  opacityVal.textContent = `${settings.opacity}%`;

  // Font Size
  document.documentElement.style.setProperty('--chat-font-size', `${settings.fontSize}px`);
  fontSizeRange.value = settings.fontSize;
  fontSizeVal.textContent = `${settings.fontSize}px`;

  // Toggles
  chkShowAvatars.checked = settings.showAvatars;
  chkShowTimestamp.checked = settings.showTimestamp;
  chkCompactMode.checked = settings.compactMode;
  chkTextOutline.checked = settings.textOutline;
  chkHideBots.checked = settings.hideBots;
  botListInput.value = settings.botList;
  chkHideCommands.checked = settings.hideCommands;
  chkSoundSuperchat.checked = settings.soundSuperchat;
  chkSoundChat.checked = settings.soundChat;

  if (settings.lastStreamUrl && !streamUrlInput.value) {
    streamUrlInput.value = settings.lastStreamUrl;
  }
  if (settings.lastTiktokUrl && tiktokInput && !tiktokInput.value) {
    tiktokInput.value = settings.lastTiktokUrl;
  }

  appEl.classList.toggle('hide-avatars', !settings.showAvatars);
  appEl.classList.toggle('hide-timestamps', !settings.showTimestamp);
  appEl.classList.toggle('compact-mode', settings.compactMode);
  appEl.classList.toggle('text-outline', settings.textOutline);
}

applySettingsToUI();

// ==================== SOUND SYNTHESIZER (NO EXTERNAL ASSETS NEEDED) ====================

function playTone(type = 'chat') {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'superchat') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.11); // A5
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.06);
    }
  } catch (e) {
    // Ignore audio context errors
  }
}

// ==================== BOT & MESSAGE FILTERING ====================

function getBlockedBotsSet() {
  return new Set(
    (settings.botList || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function shouldDisplayMessage(msg) {
  // 1. Check Bot Filter
  if (settings.hideBots) {
    const authorLower = (msg.authorName || '').trim().toLowerCase();
    const bots = getBlockedBotsSet();
    if (bots.has(authorLower)) {
      return false;
    }
  }

  // 2. Check Command Filter (!command)
  if (settings.hideCommands) {
    const text = (msg.plainText || '').trim();
    if (text.startsWith('!') && text.length > 1) {
      return false;
    }
  }

  // 3. Check Role / Tab Filter
  if (activeFilter === 'vip') {
    const isVip =
      msg.roles?.isOwner ||
      msg.roles?.isModerator ||
      msg.roles?.isMember ||
      msg.type === 'superchat' ||
      msg.type === 'supersticker' ||
      msg.type === 'membership';
    if (!isVip) return false;
  } else if (activeFilter === 'superchat') {
    const isPaid = msg.type === 'superchat' || msg.type === 'supersticker' || msg.type === 'membership';
    if (!isPaid) return false;
  }

  return true;
}

// ==================== CHAT RENDERING ====================

function formatTime(ts) {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function createAvatarDataUri(name) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const colors = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const bg = colors[Math.abs(hash) % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="16" font-weight="bold">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function createPlatformIcon(platform) {
  const span = document.createElement('span');
  const plat = platform === 'tiktok' ? 'tiktok' : 'youtube';
  span.className = `platform-mini-icon plat-${plat}`;
  span.title = plat === 'tiktok' ? 'TikTok Live' : 'YouTube Live';

  if (plat === 'tiktok') {
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>`;
  } else {
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.56A3.02 3.02 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.12 2.14c1.88.56 9.38.56 9.38.56s7.5 0 9.38-.56a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8zM9.55 15.57V8.43L15.82 12l-6.27 3.57z"/></svg>`;
  }
  return span;
}

function createRoleIcon(roleType, titleText) {
  const badge = document.createElement('span');
  badge.className = `role-icon icon-${roleType}`;
  badge.title = titleText;

  if (roleType === 'owner') {
    badge.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg>`;
  } else if (roleType === 'mod') {
    badge.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>`;
  } else if (roleType === 'member') {
    badge.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
  }
  return badge;
}

function createChatElement(msg) {
  const item = document.createElement('div');
  item.className = 'chat-item';
  item.dataset.id = msg.id;

  // Role classes
  if (msg.roles?.isOwner) {
    item.classList.add('role-owner');
  } else if (msg.roles?.isModerator) {
    item.classList.add('role-mod');
  } else if (msg.roles?.isMember) {
    item.classList.add('role-member');
  }

  if (msg.type && msg.type !== 'text') {
    item.classList.add(`type-${msg.type}`);
  }

  // Super Chat / TikTok Gift Top Banner
  if (msg.type === 'superchat' || msg.type === 'supersticker') {
    const banner = document.createElement('div');
    banner.className = 'superchat-banner';
    const label = msg.platform === 'tiktok' ? '🎁 TIKTOK GIFT' : '★ SUPER CHAT';
    banner.innerHTML = `<span>${label}</span><span>${escapeHtml(msg.purchaseAmount || 'DONASI')}</span>`;
    item.appendChild(banner);
  }

  const rowWrap = document.createElement('div');
  rowWrap.className = 'chat-row';

  // Avatar
  const avatarImg = document.createElement('img');
  avatarImg.className = 'chat-avatar';
  avatarImg.src = msg.avatarUrl || createAvatarDataUri(msg.authorName || 'U');
  avatarImg.alt = msg.authorName;
  avatarImg.onerror = () => {
    avatarImg.src = createAvatarDataUri(msg.authorName || 'U');
  };
  rowWrap.appendChild(avatarImg);

  // Body
  const body = document.createElement('div');
  body.className = 'chat-body';

  const meta = document.createElement('span');
  meta.className = 'chat-meta';

  // Timestamp
  const timeEl = document.createElement('span');
  timeEl.className = 'chat-time';
  timeEl.textContent = formatTime(msg.timestamp);
  meta.appendChild(timeEl);

  // Platform Icon (YouTube or TikTok)
  meta.appendChild(createPlatformIcon(msg.platform));

  // Icon-only Badges (Owner, Moderator, Member)
  if (msg.roles?.isOwner) {
    meta.appendChild(createRoleIcon('owner', 'Channel Owner'));
  }
  if (msg.roles?.isModerator) {
    meta.appendChild(createRoleIcon('mod', 'Moderator'));
  }
  if (msg.roles?.isMember) {
    if (msg.roles.memberBadgeUrl) {
      const badgeImg = document.createElement('img');
      badgeImg.className = 'member-custom-badge';
      badgeImg.src = msg.roles.memberBadgeUrl;
      badgeImg.title = msg.roles.memberLabel || 'Member';
      meta.appendChild(badgeImg);
    } else {
      meta.appendChild(createRoleIcon('member', msg.roles.memberLabel || 'Member'));
    }
  }

  // Author Name (colored by role)
  const authorEl = document.createElement('span');
  authorEl.className = 'author-name';
  if (msg.roles?.isOwner) authorEl.classList.add('owner');
  else if (msg.roles?.isModerator) authorEl.classList.add('mod');
  else if (msg.roles?.isMember) authorEl.classList.add('member');
  authorEl.textContent = msg.type === 'membership' ? msg.authorName : `${msg.authorName}:`;
  meta.appendChild(authorEl);

  body.appendChild(meta);

  // Message content (text & custom emojis)
  const msgContent = document.createElement('span');
  msgContent.className = msg.type === 'membership' ? 'chat-text membership-text' : 'chat-text';

  if (Array.isArray(msg.parts) && msg.parts.length > 0) {
    for (const part of msg.parts) {
      if (part.type === 'emoji' && part.url) {
        const em = document.createElement('img');
        em.className = 'chat-emoji';
        em.src = part.url;
        em.alt = part.alt || '';
        em.title = part.alt || '';
        msgContent.appendChild(em);
      } else {
        msgContent.appendChild(document.createTextNode(part.text || ''));
      }
    }
  } else {
    msgContent.textContent = msg.plainText || '';
  }

  body.appendChild(msgContent);
  rowWrap.appendChild(body);
  item.appendChild(rowWrap);

  // Click to Pin message at top
  item.title = 'Klik untuk menyematkan (Pin) pesan ini di atas';
  item.addEventListener('click', () => {
    pinMessage(msg);
  });

  return item;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pinMessage(msg) {
  pinnedMessageContent.innerHTML = '';
  const authorSpan = document.createElement('strong');
  authorSpan.style.marginRight = '6px';
  authorSpan.style.color = msg.roles?.isOwner
    ? 'var(--color-owner)'
    : msg.roles?.isModerator
    ? 'var(--color-mod)'
    : msg.roles?.isMember
    ? '#4ade80'
    : '#fff';
  authorSpan.textContent = `${msg.authorName}:`;

  const textSpan = document.createElement('span');
  textSpan.textContent = msg.plainText || '';

  pinnedMessageContent.appendChild(authorSpan);
  pinnedMessageContent.appendChild(textSpan);
  pinnedMessageBar.classList.remove('hidden');
}

btnUnpinMessage.addEventListener('click', () => {
  pinnedMessageBar.classList.add('hidden');
});

function handleIncomingChat(msg) {
  allMessages.push(msg);
  if (allMessages.length > MAX_MESSAGES) {
    allMessages.shift();
  }

  if (!shouldDisplayMessage(msg)) {
    return;
  }

  emptyState.classList.add('hidden');

  const el = createChatElement(msg);
  chatList.appendChild(el);

  while (chatList.children.length > MAX_MESSAGES) {
    chatList.removeChild(chatList.firstChild);
  }

  // Audio Notification
  if (
    settings.soundSuperchat &&
    (msg.type === 'superchat' || msg.type === 'supersticker' || msg.type === 'membership')
  ) {
    playTone('superchat');
  } else if (settings.soundChat) {
    playTone('chat');
  }

  if (!isAutoScrollPaused) {
    scrollToBottom();
  } else {
    unreadWhilePaused++;
    unreadCountEl.textContent = unreadWhilePaused;
    btnResumeScroll.classList.remove('hidden');
  }
}

function rerenderAllMessages() {
  chatList.innerHTML = '';
  const filtered = allMessages.filter((m) => shouldDisplayMessage(m));
  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    for (const msg of filtered) {
      chatList.appendChild(createChatElement(msg));
    }
    scrollToBottom();
  }
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ==================== AUTO-SCROLL PAUSE ON HOVER / SCROLL UP ====================

chatContainer.addEventListener('scroll', () => {
  const distanceFromBottom =
    chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
  if (distanceFromBottom > 45) {
    isAutoScrollPaused = true;
  } else {
    isAutoScrollPaused = false;
    unreadWhilePaused = 0;
    btnResumeScroll.classList.add('hidden');
  }
});

btnResumeScroll.addEventListener('click', () => {
  isAutoScrollPaused = false;
  unreadWhilePaused = 0;
  btnResumeScroll.classList.add('hidden');
  scrollToBottom();
});

// ==================== WINDOW CONTROLS & IPC ====================

btnPinTop.addEventListener('click', async () => {
  const newState = await window.chatPanelAPI.toggleAlwaysOnTop();
  updatePinTopUI(newState);
});

function updatePinTopUI(state) {
  btnPinTop.classList.toggle('active', state);
}

btnLockOverlay.addEventListener('click', async () => {
  const newState = await window.chatPanelAPI.toggleClickThrough();
  updateClickThroughUI(newState);
});

function updateClickThroughUI(locked) {
  isClickThroughLocked = locked;
  appEl.classList.toggle('locked-mode', locked);
  btnLockOverlay.classList.toggle('locked-active', locked);
  iconUnlock.classList.toggle('hidden', locked);
  iconLock.classList.toggle('hidden', !locked);
  lockNotice.classList.toggle('hidden', !locked);
}

// Allow unlocking via mouse hover on the Lock button even when click-through is active
btnLockOverlay.addEventListener('mouseenter', () => {
  if (isClickThroughLocked) {
    window.chatPanelAPI.setIgnoreMouseEvents(false);
  }
});

btnLockOverlay.addEventListener('mouseleave', () => {
  if (isClickThroughLocked) {
    window.chatPanelAPI.setIgnoreMouseEvents(true);
  }
});

btnMinimize.addEventListener('click', () => {
  window.chatPanelAPI.minimizeWindow();
});

btnClose.addEventListener('click', () => {
  window.chatPanelAPI.closeWindow();
});

// Connect / Disconnect YouTube Live
async function triggerConnectYoutube() {
  if (platformStates.youtube.state === 'connected' || platformStates.youtube.state === 'connecting') {
    await window.chatPanelAPI.disconnectChat('youtube');
    return;
  }
  const target = streamUrlInput.value.trim();
  if (!target) {
    ytStatusText.textContent = 'Masukkan URL / Video ID YouTube dulu';
    streamUrlInput.focus();
    return;
  }
  settings.lastStreamUrl = target;
  saveSettings();
  await window.chatPanelAPI.connectChat('youtube', target);
}

// Connect / Disconnect TikTok Live
async function triggerConnectTiktok() {
  if (platformStates.tiktok.state === 'connected' || platformStates.tiktok.state === 'connecting') {
    await window.chatPanelAPI.disconnectChat('tiktok');
    return;
  }
  const target = tiktokInput.value.trim();
  if (!target) {
    ttStatusText.textContent = 'Masukkan @username TikTok dulu';
    tiktokInput.focus();
    return;
  }
  settings.lastTiktokUrl = target;
  saveSettings();
  await window.chatPanelAPI.connectChat('tiktok', target);
}

btnConnect.addEventListener('click', triggerConnectYoutube);
streamUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') triggerConnectYoutube();
});

if (btnConnectTiktok) {
  btnConnectTiktok.addEventListener('click', triggerConnectTiktok);
}
if (tiktokInput) {
  tiktokInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') triggerConnectTiktok();
  });
}

btnClearChat.addEventListener('click', () => {
  allMessages = [];
  chatList.innerHTML = '';
  emptyState.classList.remove('hidden');
  settingsDrawer.classList.add('hidden');
  btnSettings.classList.remove('active');
});

// Filter Pills
filterPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    filterPills.forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    activeFilter = pill.dataset.filter;
    rerenderAllMessages();
  });
});

// ==================== SETTINGS LISTENERS ====================

function openSettingsDrawer(focusStreamInput = false) {
  settingsDrawer.classList.remove('hidden');
  btnSettings.classList.add('active');
  if (focusStreamInput) {
    setTimeout(() => streamUrlInput.focus(), 50);
  }
}

btnSettings.addEventListener('click', () => {
  settingsDrawer.classList.toggle('hidden');
  btnSettings.classList.toggle('active', !settingsDrawer.classList.contains('hidden'));
});

if (btnOpenConnect) {
  btnOpenConnect.addEventListener('click', () => {
    openSettingsDrawer(true);
  });
}

btnCloseSettings.addEventListener('click', () => {
  settingsDrawer.classList.add('hidden');
  btnSettings.classList.remove('active');
});

function updateOpacity(val) {
  settings.opacity = Number(val);
  saveSettings();
  applySettingsToUI();
}

quickOpacitySlider.addEventListener('input', (e) => updateOpacity(e.target.value));
opacityRange.addEventListener('input', (e) => updateOpacity(e.target.value));

fontSizeRange.addEventListener('input', (e) => {
  settings.fontSize = Number(e.target.value);
  saveSettings();
  applySettingsToUI();
});

chkShowAvatars.addEventListener('change', (e) => {
  settings.showAvatars = e.target.checked;
  saveSettings();
  applySettingsToUI();
});

chkShowTimestamp.addEventListener('change', (e) => {
  settings.showTimestamp = e.target.checked;
  saveSettings();
  applySettingsToUI();
});

chkCompactMode.addEventListener('change', (e) => {
  settings.compactMode = e.target.checked;
  saveSettings();
  applySettingsToUI();
});

chkTextOutline.addEventListener('change', (e) => {
  settings.textOutline = e.target.checked;
  saveSettings();
  applySettingsToUI();
});

chkHideBots.addEventListener('change', (e) => {
  settings.hideBots = e.target.checked;
  saveSettings();
  rerenderAllMessages();
});

botListInput.addEventListener('input', (e) => {
  settings.botList = e.target.value;
  saveSettings();
  rerenderAllMessages();
});

chkHideCommands.addEventListener('change', (e) => {
  settings.hideCommands = e.target.checked;
  saveSettings();
  rerenderAllMessages();
});

chkSoundSuperchat.addEventListener('change', (e) => {
  settings.soundSuperchat = e.target.checked;
  saveSettings();
});

chkSoundChat.addEventListener('change', (e) => {
  settings.soundChat = e.target.checked;
  saveSettings();
});

// ==================== IPC EVENT LISTENERS ====================

function refreshGlobalStatusHeader() {
  const yt = platformStates.youtube;
  const tt = platformStates.tiktok;

  const isYtLive = yt.state === 'connected';
  const isTtLive = tt.state === 'connected';
  const isAnyConnecting = yt.state === 'connecting' || tt.state === 'connecting';
  const isAnyError = yt.state === 'error' || tt.state === 'error';

  if (isYtLive && isTtLive) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'YT + TT Live';
  } else if (isYtLive) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = `YT: ${yt.channelTitle || 'Live'}`;
  } else if (isTtLive) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = `TT: ${tt.channelTitle || 'Live'}`;
  } else if (isAnyConnecting) {
    statusDot.className = 'status-dot connecting';
    statusText.textContent = 'Connecting...';
  } else if (isAnyError) {
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Error';
  } else {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Offline';
  }

  btnOpenConnect.title = `YT: ${yt.message} | TT: ${tt.message}`;
}

window.chatPanelAPI.onChatStatus((status) => {
  const plat = status.platform === 'tiktok' ? 'tiktok' : 'youtube';
  const state = status.state || 'disconnected';

  platformStates[plat] = {
    state,
    channelTitle: status.channelTitle || '',
    message: status.message || 'Belum Terhubung'
  };

  if (plat === 'youtube') {
    if (ytStatusText) ytStatusText.textContent = status.message || 'Belum Terhubung';
    if (state === 'connected') {
      btnConnect.textContent = 'Disconnect';
      btnConnect.classList.add('connected');
    } else if (state === 'connecting') {
      btnConnect.textContent = '...';
    } else {
      btnConnect.textContent = 'Connect';
      btnConnect.classList.remove('connected');
    }
  } else {
    if (ttStatusText) ttStatusText.textContent = status.message || 'Belum Terhubung';
    if (state === 'connected') {
      btnConnectTiktok.textContent = 'Disconnect';
      btnConnectTiktok.classList.add('connected');
    } else if (state === 'connecting') {
      btnConnectTiktok.textContent = '...';
    } else {
      btnConnectTiktok.textContent = 'Connect';
      btnConnectTiktok.classList.remove('connected');
    }
  }

  refreshGlobalStatusHeader();
});

window.chatPanelAPI.onChatMessage((msg) => {
  handleIncomingChat(msg);
});

window.chatPanelAPI.onAlwaysOnTopChanged((state) => {
  updatePinTopUI(state);
});

window.chatPanelAPI.onClickThroughChanged((state) => {
  updateClickThroughUI(state);
});

// ==================== SIMULATION / TEST MODE GENERATOR ====================

const demoSamples = [
  {
    platform: 'youtube',
    authorName: 'RizkyGamer99',
    type: 'text',
    roles: { isOwner: false, isModerator: false, isMember: false },
    plainText: 'Halo bang! Suara mic sama game udah pas banget malam ini 🔥'
  },
  {
    platform: 'tiktok',
    authorName: 'Putri_TikTok',
    type: 'text',
    roles: { isOwner: false, isModerator: false, isMember: true },
    plainText: 'Nonton dari FYP TikTok nih kak, seru banget!'
  },
  {
    platform: 'youtube',
    authorName: 'Nightbot',
    type: 'text',
    roles: { isOwner: false, isModerator: true, isMember: false },
    plainText: 'Jangan lupa subscribe dan nyalakan lonceng notifikasi ya guys!'
  },
  {
    platform: 'youtube',
    authorName: 'Dinda_Chan',
    type: 'text',
    roles: { isOwner: false, isModerator: false, isMember: true, memberLabel: 'Member (6 Bulan)' },
    plainText: 'Absen member baru hadir! Semangat live streamingnya kak 💚'
  },
  {
    platform: 'tiktok',
    authorName: 'Sultan_TikTok88',
    type: 'superchat',
    purchaseAmount: '💎 299 Coins',
    roles: { isOwner: false, isModerator: false, isMember: true },
    plainText: 'Mengirim Corgi x1 🐶'
  },
  {
    platform: 'youtube',
    authorName: 'BudiSantoso',
    type: 'text',
    roles: { isOwner: false, isModerator: false, isMember: false },
    plainText: '!spec'
  },
  {
    platform: 'tiktok',
    authorName: 'Mod_Aldi_TT',
    type: 'text',
    roles: { isOwner: false, isModerator: true, isMember: false },
    plainText: 'Yang di TikTok jangan lupa tap-tap layarnya ya teman-teman!'
  },
  {
    platform: 'youtube',
    authorName: 'Sultan_Andika',
    type: 'superchat',
    purchaseAmount: 'Rp 50.000',
    roles: { isOwner: false, isModerator: false, isMember: true },
    plainText: 'Buat beli kopi malam ini bang! Kapan mabar bareng viewer lagi?'
  },
  {
    platform: 'youtube',
    authorName: 'StreamerOwner',
    type: 'text',
    roles: { isOwner: true, isModerator: false, isMember: false },
    plainText: 'Thank you semuanya yang udah mampir dari YouTube maupun TikTok!'
  },
  {
    platform: 'tiktok',
    authorName: 'Kevin_TT',
    type: 'membership',
    roles: { isOwner: false, isModerator: false, isMember: true },
    plainText: 'Bergabung menjadi Subscriber TikTok Live!'
  }
];

let demoIdx = 0;

btnSimulate.addEventListener('click', () => {
  // Inject a batch on first click if empty, or one by one on subsequent clicks
  if (allMessages.length === 0) {
    demoSamples.forEach((sample, idx) => {
      setTimeout(() => {
        const msg = {
          ...sample,
          id: `sim-${Date.now()}-${idx}`,
          parts: [{ type: 'text', text: sample.plainText }],
          timestamp: Date.now()
        };
        handleIncomingChat(msg);
      }, idx * 140);
    });
  } else {
    const sample = demoSamples[demoIdx % demoSamples.length];
    demoIdx++;
    handleIncomingChat({
      ...sample,
      id: `sim-${Date.now()}-${demoIdx}`,
      parts: [{ type: 'text', text: sample.plainText }],
      timestamp: Date.now()
    });
  }
});
