const { EventEmitter } = require('events');
const tls = require('tls');
let WsClient = null;
try {
  WsClient = require('ws');
} catch (e) {
  // Fallback if ws is unavailable
}

/**
 * TwitchLiveChat - Dual-transport anonymous Twitch IRC client (WebSocket + TLS IRC 6697 fallback).
 * Connects without requiring any OAuth token or API key!
 * Automatically falls back from wss://irc-ws.chat.twitch.tv:443 to TLS irc.chat.twitch.tv:6697
 * if WebSocket is blocked or fails, and emits detailed diagnostic logs.
 */
class TwitchLiveChat extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.tlsSocket = null;
    this.tlsBuffer = '';
    this.channel = null;
    this.displayName = null;
    this.isRunning = false;
    this.isConnected = false;
    this.transportMode = 'ws'; // 'ws' | 'tls'
    this.pingTimer = null;
    this.statsTimer = null;
    this.reconnectTimer = null;
    this.seenMessageIds = new Set();
  }

  emitLog(level, message, details = '') {
    this.emit('log', {
      platform: 'twitch',
      level, // 'info' | 'warn' | 'error'
      message,
      details: details ? String(details) : '',
      timestamp: Date.now()
    });
  }

  /**
   * Extract clean Twitch channel login from input (e.g. @shroud, twitch.tv/shroud, shroud)
   */
  parseChannel(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) {
      throw new Error('Masukkan username Twitch (contoh: shroud) atau URL twitch.tv/username.');
    }

    if (trimmed.includes('twitch.tv/')) {
      const match = trimmed.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
      if (match && match[1]) {
        return match[1].toLowerCase();
      }
    }

    const cleaned = trimmed.replace(/^[@#]/, '').split('/')[0].split('?')[0].trim().toLowerCase();
    if (!cleaned || !/^[a-z0-9_]{2,25}$/.test(cleaned)) {
      throw new Error(`Format username channel Twitch "${trimmed}" tidak valid (hanya huruf, angka, dan underscore).`);
    }

    return cleaned;
  }

  async connect(input) {
    this.disconnect();

    let channel;
    try {
      channel = this.parseChannel(input);
    } catch (err) {
      this.emitLog('error', err.message, `Input: "${input}"`);
      this.emit('status', {
        platform: 'twitch',
        state: 'error',
        message: err.message
      });
      return;
    }

    this.channel = channel;
    this.displayName = channel;
    this.isRunning = true;
    this.isConnected = false;

    this.emitLog('info', `Memulai koneksi ke channel Twitch #${channel}...`);
    this.emit('status', {
      platform: 'twitch',
      state: 'connecting',
      message: `Menghubungkan ke Twitch #${channel}...`
    });

    // Verify channel & fetch initial viewer stats in background
    this.fetchChannelStats().catch((err) => {
      this.emitLog('warn', 'Gagal mengambil statistik GQL Twitch awal', err?.message || String(err));
    });

    // Try WebSocket via 'ws' library first; if unavailable, jump straight to TLS IRC
    if (WsClient) {
      this.openWebSocket();
    } else {
      this.emitLog('info', 'Modul ws tidak ditemukan, menggunakan koneksi langsung TLS IRC (port 6697)...');
      this.openTlsIrc();
    }
  }

  openWebSocket() {
    if (!this.isRunning) return;
    this.cleanupSockets();
    this.transportMode = 'ws';

    try {
      const wsUrl = 'wss://irc-ws.chat.twitch.tv:443';
      this.emitLog('info', `Membuka WebSocket Twitch (${wsUrl})...`);

      const ws = new WsClient(wsUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          Origin: 'https://www.twitch.tv'
        },
        handshakeTimeout: 8000
      });
      this.ws = ws;

      ws.on('open', () => {
        if (!this.isRunning || this.ws !== ws) return;
        this.emitLog('info', `WebSocket terbuka. Mengirim autentikasi anonim & JOIN #${this.channel}...`);

        const anonNick = `justinfan${Math.floor(10000 + Math.random() * 89999)}`;
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
        ws.send('PASS SCHMOOPIIE');
        ws.send(`NICK ${anonNick}`);
        ws.send(`JOIN #${this.channel}`);

        this.startTimers();
      });

      ws.on('message', (data) => {
        if (!this.isRunning || this.ws !== ws) return;
        const rawData = typeof data === 'string' ? data : data.toString('utf8');
        const lines = rawData.split('\r\n').filter(Boolean);
        for (const line of lines) {
          this.handleIrcLine(line);
        }
      });

      ws.on('error', (err) => {
        if (!this.isRunning || this.ws !== ws) return;
        const errDetail = err?.message || err?.code || 'Unknown WebSocket error';
        this.emitLog(
          'warn',
          `WebSocket Twitch mengalami kendala (${errDetail}). Beralih otomatis ke jalur TLS IRC (port 6697)...`,
          err?.stack || errDetail
        );
        // Immediately fallback to TLS IRC socket (port 6697) instead of failing!
        this.openTlsIrc();
      });

      ws.on('close', (code, reason) => {
        if (!this.isRunning || this.ws !== ws) return;
        const reasonStr = reason ? reason.toString() : '';
        if (!this.isConnected) {
          this.emitLog(
            'warn',
            `WebSocket tertutup sebelum terhubung (Code ${code}). Beralih ke jalur TLS IRC...`,
            reasonStr
          );
          this.openTlsIrc();
          return;
        }
        this.emitLog('warn', `Koneksi WebSocket Twitch terputus (Code ${code}). Mencoba menyambung ulang...`, reasonStr);
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (this.isRunning) this.openWebSocket();
        }, 3000);
      });
    } catch (err) {
      this.emitLog('warn', `Gagal menginisialisasi WebSocket (${err.message}), beralih ke TLS IRC...`, err?.stack);
      this.openTlsIrc();
    }
  }

  openTlsIrc() {
    if (!this.isRunning) return;
    this.cleanupSockets();
    this.transportMode = 'tls';

    try {
      this.emitLog('info', 'Menghubungkan ke server Twitch via TLS IRC (irc.chat.twitch.tv:6697)...');
      const socket = tls.connect(
        {
          host: 'irc.chat.twitch.tv',
          port: 6697,
          servername: 'irc.chat.twitch.tv',
          timeout: 10000
        },
        () => {
          if (!this.isRunning || this.tlsSocket !== socket) return;
          this.emitLog('info', `TLS IRC terhubung. Mengirim JOIN #${this.channel}...`);

          const anonNick = `justinfan${Math.floor(10000 + Math.random() * 89999)}`;
          socket.write('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership\r\n');
          socket.write('PASS SCHMOOPIIE\r\n');
          socket.write(`NICK ${anonNick}\r\n`);
          socket.write(`JOIN #${this.channel}\r\n`);

          this.startTimers();
        }
      );

      this.tlsSocket = socket;
      this.tlsBuffer = '';

      socket.on('data', (chunk) => {
        if (!this.isRunning || this.tlsSocket !== socket) return;
        this.tlsBuffer += chunk.toString('utf8');
        const lines = this.tlsBuffer.split('\r\n');
        this.tlsBuffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            this.handleIrcLine(line);
          }
        }
      });

      socket.on('error', (err) => {
        if (!this.isRunning || this.tlsSocket !== socket) return;
        const msg = err?.message || err?.code || 'Koneksi TLS IRC gagal';
        this.emitLog('error', `Gagal terhubung ke server chat Twitch: ${msg}`, err?.stack || String(err));
        this.emit('status', {
          platform: 'twitch',
          state: 'error',
          message: `Error Twitch: ${msg}`
        });
      });

      socket.on('close', () => {
        if (!this.isRunning || this.tlsSocket !== socket) return;
        if (this.isConnected) {
          this.emitLog('warn', 'Koneksi TLS IRC Twitch terputus. Menyambung ulang dalam 4 detik...');
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            if (this.isRunning) this.openTlsIrc();
          }, 4000);
        }
      });
    } catch (err) {
      this.isRunning = false;
      this.emitLog('error', `Exception saat membuka TLS IRC Twitch: ${err.message}`, err?.stack);
      this.emit('status', {
        platform: 'twitch',
        state: 'error',
        message: err.message || 'Gagal membuka koneksi Twitch.'
      });
    }
  }

  sendRawIrc(cmd) {
    try {
      if (this.transportMode === 'ws' && this.ws && this.ws.readyState === 1) {
        this.ws.send(cmd);
      } else if (this.transportMode === 'tls' && this.tlsSocket && !this.tlsSocket.destroyed) {
        this.tlsSocket.write(`${cmd}\r\n`);
      }
    } catch (e) {
      // Ignore write error
    }
  }

  startTimers() {
    clearInterval(this.statsTimer);
    this.statsTimer = setInterval(() => {
      if (this.isRunning) this.fetchChannelStats().catch(() => {});
    }, 15000);

    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.isRunning) {
        this.sendRawIrc('PING :tmi.twitch.tv');
      }
    }, 150000);
  }

  async fetchChannelStats() {
    if (!this.isRunning || !this.channel) return;
    try {
      const query = `query { user(login: "${this.channel}") { id displayName stream { viewersCount title } } }`;
      const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });
      if (!res.ok) return;
      const data = await res.json();
      const user = data?.data?.user;

      if (!user) {
        this.emitLog(
          'warn',
          `Channel Twitch "${this.channel}" tidak ditemukan di database Twitch. Pastikan penulisan username benar.`
        );
        return;
      }

      if (user.displayName) {
        this.displayName = user.displayName;
      }

      const viewersCount = user.stream ? Number(user.stream.viewersCount) || 0 : 0;
      const isLive = Boolean(user.stream);

      this.emit('stats', {
        platform: 'twitch',
        viewerCount: viewersCount,
        isLive,
        channelTitle: this.displayName
      });
    } catch (e) {
      // Ignore transient GQL errors
    }
  }

  handleIrcLine(line) {
    if (line.startsWith('PING')) {
      const payload = line.slice(5) || ':tmi.twitch.tv';
      this.sendRawIrc(`PONG ${payload}`);
      return;
    }

    // Notice from server (e.g. bad auth or msg_channel_suspended)
    if (line.includes(' NOTICE ') && line.includes('msg_channel_suspended')) {
      const errMsg = `Channel Twitch #${this.channel} sedang ditangguhkan (suspended).`;
      this.emitLog('error', errMsg, line);
      this.emit('status', {
        platform: 'twitch',
        state: 'error',
        message: errMsg
      });
      this.disconnect();
      return;
    }

    // Check successful JOIN or ROOMSTATE to confirm connection
    if (line.includes(' JOIN #') || line.includes(' ROOMSTATE #')) {
      if (!this.isConnected) {
        this.isConnected = true;
        this.emitLog(
          'info',
          `Berhasil terhubung ke ruang chat Twitch #${this.displayName || this.channel} (via ${this.transportMode.toUpperCase()}).`
        );
      }
      this.emit('status', {
        platform: 'twitch',
        state: 'connected',
        channelTitle: this.displayName || this.channel,
        message: `TW Live: ${this.displayName || this.channel}`
      });
    }

    if (line.includes(' PRIVMSG #')) {
      const parsed = this.parsePrivMsg(line);
      if (parsed && !this.isDuplicateMsg(parsed.id)) {
        this.emit('chat', parsed);
      }
    } else if (line.includes(' USERNOTICE #')) {
      const parsed = this.parseUserNotice(line);
      if (parsed && !this.isDuplicateMsg(parsed.id)) {
        this.emit('chat', parsed);
      }
    }
  }

  isDuplicateMsg(msgId) {
    if (!msgId) return false;
    if (this.seenMessageIds.has(msgId)) return true;
    this.seenMessageIds.add(msgId);
    if (this.seenMessageIds.size > 2000) {
      const first = this.seenMessageIds.values().next().value;
      this.seenMessageIds.delete(first);
    }
    return false;
  }

  parseTags(tagStr) {
    const tags = {};
    if (!tagStr) return tags;
    const rawTags = tagStr.startsWith('@') ? tagStr.slice(1) : tagStr;
    const parts = rawTags.split(';');
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) {
        tags[part] = '';
      } else {
        const key = part.slice(0, eqIdx);
        const val = part
          .slice(eqIdx + 1)
          .replace(/\\s/g, ' ')
          .replace(/\\:/g, ';')
          .replace(/\\\\/g, '\\')
          .replace(/\\r/g, '\r')
          .replace(/\\n/g, '\n');
        tags[key] = val;
      }
    }
    return tags;
  }

  extractRolesFromTags(tags, loginName) {
    const badgesStr = tags['badges'] || '';
    const isOwner = Boolean(
      badgesStr.includes('broadcaster/') ||
        (this.channel && loginName && loginName.toLowerCase() === this.channel.toLowerCase())
    );
    const isModerator =
      tags['mod'] === '1' || badgesStr.includes('moderator/') || badgesStr.includes('lead_moderator/');
    const isVip = badgesStr.includes('vip/') || tags['vip'] === '1';
    const isSubscriber =
      tags['subscriber'] === '1' || badgesStr.includes('subscriber/') || badgesStr.includes('founder/');

    return {
      isOwner,
      isModerator,
      isMember: isSubscriber || isVip,
      isVerified: badgesStr.includes('partner/'),
      memberBadgeUrl: null,
      memberLabel: isVip ? 'Twitch VIP' : isSubscriber ? 'Twitch Subscriber' : null
    };
  }

  buildPartsWithEmotes(messageText, emotesTag) {
    if (!emotesTag || !messageText) {
      return [{ type: 'text', text: messageText }];
    }

    const replacements = [];
    const emoteGroups = emotesTag.split('/');
    for (const group of emoteGroups) {
      const [emoteId, rangesStr] = group.split(':');
      if (!emoteId || !rangesStr) continue;
      const ranges = rangesStr.split(',');
      for (const range of ranges) {
        const [startStr, endStr] = range.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          replacements.push({
            emoteId,
            start,
            end
          });
        }
      }
    }

    if (replacements.length === 0) {
      return [{ type: 'text', text: messageText }];
    }

    replacements.sort((a, b) => a.start - b.start);

    const chars = Array.from(messageText);
    const parts = [];
    let cursor = 0;

    for (const rep of replacements) {
      if (rep.start < cursor || rep.end >= chars.length) continue;
      if (rep.start > cursor) {
        parts.push({
          type: 'text',
          text: chars.slice(cursor, rep.start).join('')
        });
      }
      const emoteCode = chars.slice(rep.start, rep.end + 1).join('');
      parts.push({
        type: 'emoji',
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${rep.emoteId}/default/dark/1.0`,
        alt: emoteCode
      });
      cursor = rep.end + 1;
    }

    if (cursor < chars.length) {
      parts.push({
        type: 'text',
        text: chars.slice(cursor).join('')
      });
    }

    return parts;
  }

  parsePrivMsg(line) {
    let tagPart = '';
    let rest = line;
    if (rest.startsWith('@')) {
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) return null;
      tagPart = rest.slice(0, spaceIdx);
      rest = rest.slice(spaceIdx + 1);
    }

    const tags = this.parseTags(tagPart);

    const prefixMatch = rest.match(/^:([a-zA-Z0-9_]+)!/);
    const loginName = prefixMatch ? prefixMatch[1] : '';

    const privIdx = rest.indexOf(' PRIVMSG #');
    if (privIdx === -1) return null;

    const afterPriv = rest.slice(privIdx + 10);
    const colonIdx = afterPriv.indexOf(' :');
    if (colonIdx === -1) return null;

    let messageText = afterPriv.slice(colonIdx + 2);

    if (messageText.startsWith('\u0001ACTION ') && messageText.endsWith('\u0001')) {
      messageText = messageText.slice(8, -1);
    }

    const authorName = tags['display-name'] || loginName || 'TwitchUser';
    const id = tags['id'] || `tw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const roles = this.extractRolesFromTags(tags, loginName);
    const parts = this.buildPartsWithEmotes(messageText, tags['emotes']);

    const bits = parseInt(tags['bits'] || '0', 10);
    const isCheer = bits > 0;

    return {
      id,
      platform: 'twitch',
      type: isCheer ? 'superchat' : 'text',
      authorName,
      authorUsername: loginName,
      avatarUrl: '',
      roles,
      parts,
      plainText: messageText.trim(),
      purchaseAmount: isCheer ? `💎 ${bits} Bits` : null,
      timestamp: tags['tmi-sent-ts'] ? Number(tags['tmi-sent-ts']) : Date.now()
    };
  }

  parseUserNotice(line) {
    let tagPart = '';
    let rest = line;
    if (rest.startsWith('@')) {
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) return null;
      tagPart = rest.slice(0, spaceIdx);
      rest = rest.slice(spaceIdx + 1);
    }

    const tags = this.parseTags(tagPart);
    const msgIdType = tags['msg-id'] || '';

    if (!['sub', 'resub', 'subgift', 'anonsubgift', 'raid'].includes(msgIdType)) {
      return null;
    }

    const loginName = tags['login'] || '';
    const authorName = tags['display-name'] || loginName || 'Twitch Subscriber';
    const systemMsg = (tags['system-msg'] || 'Bergabung menjadi Subscriber Twitch!').trim();

    let userComment = '';
    const noticeIdx = rest.indexOf(' USERNOTICE #');
    if (noticeIdx !== -1) {
      const afterNotice = rest.slice(noticeIdx + 13);
      const colonIdx = afterNotice.indexOf(' :');
      if (colonIdx !== -1) {
        userComment = afterNotice.slice(colonIdx + 2).trim();
      }
    }

    const fullText = userComment ? `${systemMsg} — "${userComment}"` : systemMsg;
    const roles = this.extractRolesFromTags(tags, loginName);
    roles.isMember = true;

    return {
      id: tags['id'] || `tw-notice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      platform: 'twitch',
      type: 'membership',
      authorName,
      authorUsername: loginName,
      avatarUrl: '',
      roles,
      parts: [{ type: 'text', text: fullText }],
      plainText: fullText,
      timestamp: tags['tmi-sent-ts'] ? Number(tags['tmi-sent-ts']) : Date.now()
    };
  }

  cleanupSockets() {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.terminate ? this.ws.terminate() : this.ws.close();
      } catch (e) {
        // Ignore
      }
      this.ws = null;
    }
    if (this.tlsSocket) {
      try {
        this.tlsSocket.removeAllListeners();
        this.tlsSocket.destroy();
      } catch (e) {
        // Ignore
      }
      this.tlsSocket = null;
    }
  }

  disconnect() {
    this.isRunning = false;
    this.isConnected = false;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    clearInterval(this.statsTimer);
    this.statsTimer = null;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.cleanupSockets();
  }
}

module.exports = { TwitchLiveChat };
