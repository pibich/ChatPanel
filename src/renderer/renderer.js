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
  botList:
    'Nightbot, StreamElements, Moobot, Streamlabs, Fossabot, Wizebot, Stay_Hydrated_Bot, BotRix, PhantomBot, Sery_Bot, PokemonCommunityGame, SoundAlerts',
  hideCommands: true,
  soundSuperchat: true,
  soundChat: false,
  lastStreamUrl: '',
  lastTiktokUrl: '',
  lastTwitchUrl: ''
};

let settings = loadSettings();
let allMessages = [];
let activeFilter = 'all'; // 'all' | 'vip' | 'superchat'
let platformStates = {
  youtube: { state: 'disconnected', channelTitle: '', message: 'Belum Terhubung' },
  tiktok: { state: 'disconnected', channelTitle: '', message: 'Belum Terhubung' },
  twitch: { state: 'disconnected', channelTitle: '', message: 'Belum Terhubung' }
};
let platformStats = {
  youtube: { viewerCount: 0, likeCount: 0 },
  tiktok: { viewerCount: 0 },
  twitch: { viewerCount: 0 }
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

const twitchInput = document.getElementById('twitchInput');
const btnConnectTwitch = document.getElementById('btnConnectTwitch');
const twStatusText = document.getElementById('twStatusText');

const totalViewerCountEl = document.getElementById('totalViewerCount');
const platformViewerBadgesEl = document.getElementById('platformViewerBadges');
const ytLikeCountEl = document.getElementById('ytLikeCount');
const ytLikeBadgeEl = document.getElementById('ytLikeBadge');

const btnOpenConnect = document.getElementById('btnOpenConnect');
const btnClearChat = document.getElementById('btnClearChat');
const filterPills = document.querySelectorAll('.filter-pill');
const settingsTabs = document.querySelectorAll('.settings-tab');
const settingsPanes = document.querySelectorAll('.settings-pane');

// Log & Error Toast Elements
const logErrorBadge = document.getElementById('logErrorBadge');
const logEmptyState = document.getElementById('logEmptyState');
const logEntriesList = document.getElementById('logEntriesList');
const btnCopyLogs = document.getElementById('btnCopyLogs');
const btnOpenLogFile = document.getElementById('btnOpenLogFile');
const btnClearLogs = document.getElementById('btnClearLogs');

const errorToast = document.getElementById('errorToast');
const toastTitle = document.getElementById('toastTitle');
const toastTime = document.getElementById('toastTime');
const toastMessage = document.getElementById('toastMessage');
const btnViewLogFromToast = document.getElementById('btnViewLogFromToast');
const btnCloseToast = document.getElementById('btnCloseToast');

let diagnosticLogs = [];
let toastTimer = null;

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
  if (settings.lastTwitchUrl && twitchInput && !twitchInput.value) {
    twitchInput.value = settings.lastTwitchUrl;
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

// Built-in popular bots across YouTube, TikTok & Twitch so they are always caught when Hide Bots is enabled
const BUILTIN_KNOWN_BOTS = [
  'nightbot',
  'streamelements',
  'moobot',
  'streamlabs',
  'fossabot',
  'wizebot',
  'stay_hydrated_bot',
  'botrix',
  'botrixoficial',
  'phantombot',
  'sery_bot',
  'pokemoncommunitygame',
  'soundalerts',
  'kofistreambot',
  'own3d',
  'pretzelrocks',
  'songlistbot',
  'lurkxx',
  'creatisbot',
  'frostytoolsdotcom',
  ' Kickbot'
];

function normalizeBotHandle(str) {
  return String(str || '')
    .normalize('NFKD')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Strip zero-width spaces
    .trim()
    .replace(/^@+/, '') // Strip leading @
    .toLowerCase();
}

function normalizeBotAlnum(str) {
  return normalizeBotHandle(str).replace(/[\s_.-]+/g, '');
}

function getBlockedBotPatterns() {
  const userEntries = (settings.botList || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const combined = [...BUILTIN_KNOWN_BOTS, ...userEntries];
  const exactHandles = new Set();
  const alnumHandles = new Set();

  for (const item of combined) {
    const clean = normalizeBotHandle(item);
    const alnum = normalizeBotAlnum(item);
    if (clean) exactHandles.add(clean);
    if (alnum) alnumHandles.add(alnum);
  }

  return { exactHandles, alnumHandles };
}

function isBotAuthor(msg) {
  const { exactHandles, alnumHandles } = getBlockedBotPatterns();
  const candidates = [msg.authorName, msg.authorUsername].filter(Boolean);

  for (const rawName of candidates) {
    const clean = normalizeBotHandle(rawName);
    const alnum = normalizeBotAlnum(rawName);
    if (!clean) continue;

    // 1. Direct match on normalized handle or alphanumeric-collapsed handle
    if (exactHandles.has(clean) || (alnum && alnumHandles.has(alnum))) {
      return true;
    }

    // 2. Substring / prefix match for bots with suffixes like "Nightbot [Mod]", "StreamElements_Bot"
    for (const botAlnum of alnumHandles) {
      if (botAlnum.length >= 5 && alnum.includes(botAlnum)) {
        return true;
      }
    }
  }

  return false;
}

function shouldDisplayMessage(msg) {
  // 1. Check Bot Filter FIRST (applies even if the bot has Moderator / VIP badge!)
  if (settings.hideBots && isBotAuthor(msg)) {
    return false;
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
  const plat = platform === 'tiktok' ? 'tiktok' : platform === 'twitch' ? 'twitch' : 'youtube';
  span.className = `platform-mini-icon plat-${plat}`;
  span.title = plat === 'tiktok' ? 'TikTok Live' : plat === 'twitch' ? 'Twitch Live' : 'YouTube Live';

  if (plat === 'tiktok') {
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>`;
  } else if (plat === 'twitch') {
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>`;
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

  // Super Chat / TikTok Gift / Twitch Cheer Top Banner
  if (msg.type === 'superchat' || msg.type === 'supersticker') {
    const banner = document.createElement('div');
    banner.className = 'superchat-banner';
    const label =
      msg.platform === 'tiktok'
        ? '🎁 TIKTOK GIFT'
        : msg.platform === 'twitch'
        ? '💎 TWITCH CHEER'
        : '★ SUPER CHAT';
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

// Connect / Disconnect Twitch Live
async function triggerConnectTwitch() {
  if (platformStates.twitch.state === 'connected' || platformStates.twitch.state === 'connecting') {
    await window.chatPanelAPI.disconnectChat('twitch');
    return;
  }
  const target = twitchInput.value.trim();
  if (!target) {
    twStatusText.textContent = 'Masukkan username Twitch dulu';
    twitchInput.focus();
    return;
  }
  settings.lastTwitchUrl = target;
  saveSettings();
  await window.chatPanelAPI.connectChat('twitch', target);
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

if (btnConnectTwitch) {
  btnConnectTwitch.addEventListener('click', triggerConnectTwitch);
}
if (twitchInput) {
  twitchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') triggerConnectTwitch();
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

function switchSettingsTab(targetTabId) {
  settingsTabs.forEach((tab) => {
    const isMatch = tab.dataset.tab === targetTabId;
    tab.classList.toggle('active', isMatch);
    tab.setAttribute('aria-selected', isMatch ? 'true' : 'false');
  });
  settingsPanes.forEach((pane) => {
    const isMatch = pane.id === targetTabId;
    pane.classList.toggle('hidden', !isMatch);
    pane.classList.toggle('active', isMatch);
  });
  if (targetTabId === 'tabLogs' && logErrorBadge) {
    logErrorBadge.classList.add('hidden');
  }
}

settingsTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    switchSettingsTab(tab.dataset.tab);
  });
});

function openSettingsDrawer(focusStreamInput = false) {
  settingsDrawer.classList.remove('hidden');
  btnSettings.classList.add('active');
  if (focusStreamInput) {
    switchSettingsTab('tabConnect');
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

function formatNumberCount(num) {
  const n = Number(num) || 0;
  return n.toLocaleString('id-ID');
}

let lastRenderedLikes = 0;

function updateLiveStatsUI() {
  const ytViewers = Number(platformStats.youtube.viewerCount) || 0;
  const ttViewers = Number(platformStats.tiktok.viewerCount) || 0;
  const twViewers = Number(platformStats.twitch.viewerCount) || 0;
  const totalViewers = ytViewers + ttViewers + twViewers;

  if (totalViewerCountEl) {
    totalViewerCountEl.textContent = formatNumberCount(totalViewers);
  }

  if (platformViewerBadgesEl) {
    platformViewerBadgesEl.innerHTML = '';
    const activeBadges = [];
    if (platformStates.youtube.state === 'connected' || ytViewers > 0) {
      activeBadges.push({ cls: 'yt', label: 'YT', val: ytViewers });
    }
    if (platformStates.tiktok.state === 'connected' || ttViewers > 0) {
      activeBadges.push({ cls: 'tt', label: 'TT', val: ttViewers });
    }
    if (platformStates.twitch.state === 'connected' || twViewers > 0) {
      activeBadges.push({ cls: 'tw', label: 'TW', val: twViewers });
    }

    for (const b of activeBadges) {
      const pill = document.createElement('span');
      pill.className = `plat-viewer-pill ${b.cls}`;
      pill.textContent = `${b.label} ${formatNumberCount(b.val)}`;
      platformViewerBadgesEl.appendChild(pill);
    }
  }

  if (ytLikeCountEl) {
    const likes = Number(platformStats.youtube.likeCount) || 0;
    ytLikeCountEl.textContent = formatNumberCount(likes);
    if (ytLikeBadgeEl && likes !== lastRenderedLikes && likes > 0) {
      lastRenderedLikes = likes;
      ytLikeBadgeEl.classList.add('pulse-like');
      setTimeout(() => ytLikeBadgeEl.classList.remove('pulse-like'), 500);
    }
  }
}

function refreshGlobalStatusHeader() {
  const yt = platformStates.youtube;
  const tt = platformStates.tiktok;
  const tw = platformStates.twitch;

  const activeTags = [];
  if (yt.state === 'connected') activeTags.push({ code: 'YT', title: yt.channelTitle });
  if (tt.state === 'connected') activeTags.push({ code: 'TT', title: tt.channelTitle });
  if (tw.state === 'connected') activeTags.push({ code: 'TW', title: tw.channelTitle });

  const isAnyConnecting =
    yt.state === 'connecting' || tt.state === 'connecting' || tw.state === 'connecting';
  const isAnyError = yt.state === 'error' || tt.state === 'error' || tw.state === 'error';

  if (activeTags.length > 1) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = `${activeTags.map((a) => a.code).join(' + ')} Live`;
  } else if (activeTags.length === 1) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = `${activeTags[0].code}: ${activeTags[0].title || 'Live'}`;
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

  btnOpenConnect.title = `YT: ${yt.message} | TT: ${tt.message} | TW: ${tw.message}`;
}

window.chatPanelAPI.onChatStatus((status) => {
  const plat =
    status.platform === 'tiktok' ? 'tiktok' : status.platform === 'twitch' ? 'twitch' : 'youtube';
  const state = status.state || 'disconnected';

  platformStates[plat] = {
    state,
    channelTitle: status.channelTitle || '',
    message: status.message || 'Belum Terhubung'
  };

  if (state === 'disconnected' || state === 'error') {
    platformStats[plat].viewerCount = 0;
    if (plat === 'youtube') {
      platformStats.youtube.likeCount = 0;
    }
    updateLiveStatsUI();
  }

  if (plat === 'youtube') {
    if (ytStatusText) {
      ytStatusText.textContent = status.message || 'Belum Terhubung';
      ytStatusText.classList.toggle('live', state === 'connected');
      ytStatusText.classList.toggle('error', state === 'error');
    }
    if (state === 'connected') {
      btnConnect.textContent = 'Disconnect';
      btnConnect.classList.add('connected');
    } else if (state === 'connecting') {
      btnConnect.textContent = '...';
    } else {
      btnConnect.textContent = 'Connect';
      btnConnect.classList.remove('connected');
    }
  } else if (plat === 'tiktok') {
    if (ttStatusText) {
      ttStatusText.textContent = status.message || 'Belum Terhubung';
      ttStatusText.classList.toggle('live', state === 'connected');
      ttStatusText.classList.toggle('error', state === 'error');
    }
    if (state === 'connected') {
      btnConnectTiktok.textContent = 'Disconnect';
      btnConnectTiktok.classList.add('connected');
    } else if (state === 'connecting') {
      btnConnectTiktok.textContent = '...';
    } else {
      btnConnectTiktok.textContent = 'Connect';
      btnConnectTiktok.classList.remove('connected');
    }
  } else if (plat === 'twitch') {
    if (twStatusText) {
      twStatusText.textContent = status.message || 'Belum Terhubung';
      twStatusText.classList.toggle('live', state === 'connected');
      twStatusText.classList.toggle('error', state === 'error');
    }
    if (state === 'connected') {
      btnConnectTwitch.textContent = 'Disconnect';
      btnConnectTwitch.classList.add('connected');
    } else if (state === 'connecting') {
      btnConnectTwitch.textContent = '...';
    } else {
      btnConnectTwitch.textContent = 'Connect';
      btnConnectTwitch.classList.remove('connected');
    }
  }

  if (state === 'error' && status.message) {
    showErrorToast(plat, status.message);
  }

  refreshGlobalStatusHeader();
  updateLiveStatsUI();
});

// ==================== DIAGNOSTIC LOGGING & ERROR POPUP TOAST ====================

function formatLogTimestamp(ts) {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function showErrorToast(platform, message) {
  if (!errorToast) return;
  const platNames = { youtube: 'YouTube Live', tiktok: 'TikTok Live', twitch: 'Twitch Live' };
  const label = platNames[platform] || 'Koneksi Live';

  if (toastTitle) toastTitle.textContent = `Error ${label}`;
  if (toastTime) toastTime.textContent = formatLogTimestamp(Date.now());
  if (toastMessage) toastMessage.textContent = message;

  errorToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    errorToast.classList.add('hidden');
  }, 9000);
}

if (btnCloseToast) {
  btnCloseToast.addEventListener('click', () => {
    errorToast.classList.add('hidden');
    clearTimeout(toastTimer);
  });
}

if (btnViewLogFromToast) {
  btnViewLogFromToast.addEventListener('click', () => {
    errorToast.classList.add('hidden');
    clearTimeout(toastTimer);
    settingsDrawer.classList.remove('hidden');
    btnSettings.classList.add('active');
    switchSettingsTab('tabLogs');
  });
}

function addDiagnosticLogEntry(entry) {
  const item = {
    platform: entry.platform || 'system',
    level: entry.level || 'info',
    message: entry.message || '',
    details: entry.details || '',
    timestamp: entry.timestamp || Date.now()
  };

  diagnosticLogs.unshift(item);
  if (diagnosticLogs.length > 120) {
    diagnosticLogs.pop();
  }

  if (logEmptyState) logEmptyState.classList.add('hidden');

  if (logEntriesList) {
    const row = document.createElement('div');
    row.className = `log-entry level-${item.level}`;

    const meta = document.createElement('div');
    meta.className = 'log-entry-meta';
    meta.innerHTML = `<span class="log-time">${formatLogTimestamp(item.timestamp)}</span><span class="log-plat-tag">${escapeHtml(item.platform)}</span><span class="log-level-tag">${escapeHtml(item.level)}</span>`;
    row.appendChild(meta);

    const msgEl = document.createElement('div');
    msgEl.className = 'log-msg';
    msgEl.textContent = item.message;
    row.appendChild(msgEl);

    if (item.details && item.details !== item.message) {
      const detEl = document.createElement('div');
      detEl.className = 'log-details';
      detEl.textContent = item.details;
      row.appendChild(detEl);
    }

    logEntriesList.prepend(row);
    while (logEntriesList.children.length > 120) {
      logEntriesList.removeChild(logEntriesList.lastChild);
    }
  }

  if (item.level === 'error' && logErrorBadge) {
    const isLogsTabOpen =
      !settingsDrawer.classList.contains('hidden') &&
      document.getElementById('tabLogs')?.classList.contains('active');
    if (!isLogsTabOpen) {
      logErrorBadge.classList.remove('hidden');
    }
  }
}

if (window.chatPanelAPI.onChatLog) {
  window.chatPanelAPI.onChatLog((entry) => {
    addDiagnosticLogEntry(entry);
  });
}

if (btnCopyLogs) {
  btnCopyLogs.addEventListener('click', async () => {
    const text = diagnosticLogs
      .map(
        (l) =>
          `[${formatLogTimestamp(l.timestamp)}] [${l.level.toUpperCase()}] [${l.platform.toUpperCase()}] ${l.message}${l.details ? ` | ${l.details}` : ''}`
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text || 'Tidak ada log.');
      const span = btnCopyLogs.querySelector('span');
      if (span) {
        const prev = span.textContent;
        span.textContent = 'Copied!';
        setTimeout(() => {
          span.textContent = prev;
        }, 1500);
      }
    } catch (e) {
      // Ignore clipboard error
    }
  });
}

if (btnOpenLogFile) {
  btnOpenLogFile.addEventListener('click', () => {
    if (window.chatPanelAPI.openLogFile) {
      window.chatPanelAPI.openLogFile();
    }
  });
}

if (btnClearLogs) {
  btnClearLogs.addEventListener('click', () => {
    diagnosticLogs = [];
    if (logEntriesList) logEntriesList.innerHTML = '';
    if (logEmptyState) logEmptyState.classList.remove('hidden');
    if (logErrorBadge) logErrorBadge.classList.add('hidden');
    if (window.chatPanelAPI.clearLogFile) {
      window.chatPanelAPI.clearLogFile();
    }
  });
}

if (window.chatPanelAPI.onChatStats) {
  window.chatPanelAPI.onChatStats((stats) => {
    const plat =
      stats.platform === 'tiktok' ? 'tiktok' : stats.platform === 'twitch' ? 'twitch' : 'youtube';
    if (typeof stats.viewerCount === 'number' && !isNaN(stats.viewerCount)) {
      platformStats[plat].viewerCount = stats.viewerCount;
    }
    if (plat === 'youtube' && typeof stats.likeCount === 'number' && !isNaN(stats.likeCount)) {
      platformStats.youtube.likeCount = stats.likeCount;
    }
    if (stats.channelTitle && platformStates[plat]) {
      platformStates[plat].channelTitle = stats.channelTitle;
      refreshGlobalStatusHeader();
    }
    updateLiveStatsUI();
  });
}

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
    platform: 'twitch',
    authorName: 'TwitchGamer_ID',
    type: 'text',
    roles: { isOwner: false, isModerator: false, isMember: true, memberLabel: 'Twitch Subscriber' },
    plainText: 'Hadir dari Twitch! Stream-nya lancar jaya 60fps 💜'
  },
  {
    platform: 'youtube',
    authorName: 'Nightbot',
    type: 'text',
    roles: { isOwner: false, isModerator: true, isMember: false },
    plainText: 'Jangan lupa subscribe dan nyalakan lonceng notifikasi ya guys!'
  },
  {
    platform: 'twitch',
    authorName: 'StreamElements',
    type: 'text',
    roles: { isOwner: false, isModerator: true, isMember: false },
    plainText: 'Follow social media streamer di deskripsi channel!'
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
    platform: 'twitch',
    authorName: 'ProViewer_TW',
    type: 'superchat',
    purchaseAmount: '💎 500 Bits',
    roles: { isOwner: false, isModerator: false, isMember: true },
    plainText: 'Cheer500 Semangat push rank malam ini bang!'
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
    plainText: 'Thank you semuanya yang udah mampir dari YouTube, TikTok, maupun Twitch!'
  },
  {
    platform: 'twitch',
    authorName: 'Sarah_TV',
    type: 'membership',
    roles: { isOwner: false, isModerator: false, isMember: true },
    plainText: 'Berlangganan (Tier 1 Sub) di Twitch selama 3 bulan!'
  }
];

let demoIdx = 0;

btnSimulate.addEventListener('click', () => {
  // Simulate live viewer counts & YouTube like count if currently 0 (offline test mode)
  const isAllOffline =
    platformStates.youtube.state !== 'connected' &&
    platformStates.tiktok.state !== 'connected' &&
    platformStates.twitch.state !== 'connected';

  if (isAllOffline) {
    platformStats.youtube.viewerCount = (platformStats.youtube.viewerCount || 120) + Math.floor(Math.random() * 15);
    platformStats.youtube.likeCount = (platformStats.youtube.likeCount || 85) + Math.floor(Math.random() * 8);
    platformStats.tiktok.viewerCount = (platformStats.tiktok.viewerCount || 240) + Math.floor(Math.random() * 20);
    platformStats.twitch.viewerCount = (platformStats.twitch.viewerCount || 65) + Math.floor(Math.random() * 10);
    updateLiveStatsUI();
  }

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
