const { EventEmitter } = require('events');

let cachedConnectorModule = null;
async function loadTikTokConnector() {
  if (!cachedConnectorModule) {
    cachedConnectorModule = await import('tiktok-live-connector');
  }
  return cachedConnectorModule;
}

/**
 * TikTokLiveChat - Connects to TikTok Live Webcast without requiring login/API keys.
 * Uses TikTokLiveConnection (v2.5+) with enableExtendedGiftInfo: false to avoid
 * Euler Stream's paid Business plan sign endpoint while still receiving full live chat,
 * gifts (from WebcastGiftMessage.giftDetails), and subscriber/superfan events.
 */
class TikTokLiveChat extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.uniqueId = null;
    this.isRunning = false;
    this.seenMessageIds = new Set();
  }

  /**
   * Extract clean TikTok uniqueId (username) from input
   */
  parseUsername(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) {
      throw new Error('Masukkan username TikTok (contoh: @username) atau URL TikTok Live.');
    }

    // Full URL e.g. https://www.tiktok.com/@username/live
    if (trimmed.includes('tiktok.com/')) {
      const match = trimmed.match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)/i);
      if (match && match[1]) {
        return match[1];
      }
    }

    // Strip leading @ and path segments
    const cleaned = trimmed.replace(/^@/, '').split('/')[0].split('?')[0].trim();
    if (!cleaned || !/^[a-zA-Z0-9_.-]+$/.test(cleaned)) {
      throw new Error('Format username TikTok tidak valid.');
    }

    return cleaned;
  }

  async connect(input) {
    this.disconnect();

    let username;
    try {
      username = this.parseUsername(input);
    } catch (err) {
      this.emit('status', {
        platform: 'tiktok',
        state: 'error',
        message: err.message
      });
      return;
    }

    this.uniqueId = username;
    this.isRunning = true;

    this.emit('status', {
      platform: 'tiktok',
      state: 'connecting',
      message: `Menghubungkan ke TikTok @${username}...`
    });

    try {
      const connector = await loadTikTokConnector();
      const ConnectionClass =
        connector.TikTokLiveConnection ||
        connector.WebcastPushConnection ||
        connector.default?.TikTokLiveConnection;

      if (!ConnectionClass) {
        throw new Error('Gagal memuat modul koneksi TikTok Live.');
      }

      // IMPORTANT: enableExtendedGiftInfo MUST be false in v2.5.0 because fetching the full
      // room gift list calls Euler Stream's paid Business sign endpoint.
      // Individual gift events already include giftDetails (giftName, diamondCount, icon) for free!
      this.connection = new ConnectionClass(username, {
        processInitialData: true,
        fetchRoomInfoOnConnect: true,
        enableExtendedGiftInfo: false
      });

      this.registerEvents();

      const state = await this.connection.connect();
      const roomData = state?.roomInfo?.data || state?.roomInfo || {};
      const streamerName =
        roomData?.owner?.nickname ||
        roomData?.owner?.display_id ||
        `@${username}`;
      const roomTitle = roomData?.title || `TikTok Live (@${username})`;

      this.emit('status', {
        platform: 'tiktok',
        state: 'connected',
        channelTitle: streamerName,
        liveTitle: roomTitle,
        message: `TT Live: @${username}`
      });
    } catch (err) {
      this.isRunning = false;
      let errMsg = err?.message || 'Gagal terhubung ke TikTok Live.';
      if (errMsg.toLowerCase().includes('offline') || errMsg.toLowerCase().includes("isn't online")) {
        errMsg = `Akun @${username} sedang tidak Live.`;
      }
      this.emit('status', {
        platform: 'tiktok',
        state: 'error',
        message: errMsg
      });
    }
  }

  isDuplicateMsg(msgId) {
    if (!msgId) return false;
    const key = String(msgId);
    if (this.seenMessageIds.has(key)) return true;
    this.seenMessageIds.add(key);
    if (this.seenMessageIds.size > 2000) {
      const first = this.seenMessageIds.values().next().value;
      this.seenMessageIds.delete(first);
    }
    return false;
  }

  registerEvents() {
    if (!this.connection) return;

    // 1. Regular Chat Message (WebcastChatMessage)
    this.connection.on('chat', (data) => {
      if (!this.isRunning) return;
      try {
        const msgId = data.common?.msgId || data.msgId;
        if (this.isDuplicateMsg(msgId)) return;
        const msg = this.formatChatMessage(data);
        if (msg) this.emit('chat', msg);
      } catch (e) {
        // Ignore malformed frame
      }
    });

    // 2. Gift Event (WebcastGiftMessage -> Mapped to SuperChat / Donation card)
    this.connection.on('gift', (data) => {
      if (!this.isRunning) return;
      try {
        const giftType = data.gift?.giftType ?? data.giftDetails?.giftType ?? data.giftType;
        const repeatEnd = Boolean(data.repeatEnd || data.gift?.repeatEnd);
        // For streakable gifts (giftType === 1), wait until the streak ends
        if (giftType === 1 && !repeatEnd) {
          return;
        }
        const msgId = data.common?.msgId || data.msgId;
        if (this.isDuplicateMsg(msgId)) return;
        const msg = this.formatGiftMessage(data);
        if (msg) this.emit('chat', msg);
      } catch (e) {
        // Ignore malformed gift frame
      }
    });

    // 3. Subscribe / Super Fan Event (Mapped to Membership)
    const handleNewMember = (data) => {
      if (!this.isRunning) return;
      try {
        const user = data.user || data;
        const authorName = user.nickname || user.displayId || user.uniqueId || 'TikTok User';
        const avatarUrl = this.extractAvatarUrl(user);
        const roles = this.extractRoles(data);
        roles.isMember = true;

        this.emit('chat', {
          id: `tt-sub-${data.common?.msgId || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          platform: 'tiktok',
          type: 'membership',
          authorName,
          avatarUrl,
          roles,
          parts: [{ type: 'text', text: 'Bergabung menjadi Subscriber / Super Fan TikTok!' }],
          plainText: 'Bergabung menjadi Subscriber / Super Fan TikTok!',
          timestamp: Date.now()
        });
      } catch (e) {
        // Ignore malformed subscribe frame
      }
    };

    this.connection.on('subscribe', handleNewMember);
    this.connection.on('superFanJoin', handleNewMember);

    // 4. Stream Ended / Disconnected
    this.connection.on('streamEnd', () => {
      this.isRunning = false;
      this.emit('status', {
        platform: 'tiktok',
        state: 'disconnected',
        message: `Live TikTok @${this.uniqueId} telah berakhir.`
      });
    });

    this.connection.on('disconnected', () => {
      if (!this.isRunning) return;
      this.isRunning = false;
      this.emit('status', {
        platform: 'tiktok',
        state: 'disconnected',
        message: `Terputus dari TikTok @${this.uniqueId}`
      });
    });

    this.connection.on('error', (err) => {
      if (!this.isRunning) {
        this.emit('status', {
          platform: 'tiktok',
          state: 'error',
          message: err?.exception?.message || err?.message || 'Error koneksi TikTok Live'
        });
      }
    });
  }

  extractAvatarUrl(user) {
    if (!user) return '';
    if (typeof user.profilePictureUrl === 'string') return user.profilePictureUrl;
    const urls =
      user.avatarThumb?.url ||
      user.avatarThumb?.urlList ||
      user.avatarMedium?.url ||
      user.avatarMedium?.urlList ||
      user.avatarLarge?.url ||
      user.avatarLarge?.urlList ||
      [];
    return Array.isArray(urls) && urls.length > 0 ? urls[0] : '';
  }

  extractRoles(data) {
    const user = data?.user || data || {};
    const displayId = (user.displayId || user.uniqueId || '').toLowerCase();

    const isOwner =
      Boolean(this.uniqueId && displayId && displayId === this.uniqueId.toLowerCase()) ||
      Boolean(data?.userIdentity?.isAnchor);

    const isModerator =
      Boolean(user.isModerator) ||
      Boolean(user.userAttr?.isAdmin) ||
      Boolean(data?.userIdentity?.isModeratorOfAnchor);

    const isSubscriber =
      Boolean(user.isSubscriber) ||
      Boolean(user.subscribeInfo?.isSubscribed) ||
      Boolean(data?.userIdentity?.isSubscriberOfAnchor) ||
      Boolean(user.fansClub?.data?.level > 0);

    let memberBadgeUrl = null;
    const badgeList = user.badgeList || [];
    for (const badge of badgeList) {
      const imgList = badge?.combine?.icon?.url || badge?.combine?.icon?.urlList || [];
      if (Array.isArray(imgList) && imgList.length > 0) {
        memberBadgeUrl = imgList[0];
        break;
      }
    }

    return {
      isOwner,
      isModerator,
      isMember: isSubscriber,
      isVerified: Boolean(user.verified),
      memberBadgeUrl,
      memberLabel: isSubscriber ? 'TikTok Subscriber / Fan' : null
    };
  }

  formatChatMessage(data) {
    const user = data.user || data;
    const authorName = user.nickname || user.displayId || user.uniqueId || 'TikTok Viewer';
    const comment = data.content ?? data.comment ?? '';
    const avatarUrl = this.extractAvatarUrl(user);
    const roles = this.extractRoles(data);

    const parts = [{ type: 'text', text: comment }];
    if (Array.isArray(data.emotes) && data.emotes.length > 0) {
      for (const em of data.emotes) {
        const urls =
          em?.emote?.image?.url ||
          em?.emote?.image?.urlList ||
          (em?.emoteImageUrl ? [em.emoteImageUrl] : []);
        if (Array.isArray(urls) && urls.length > 0) {
          parts.push({
            type: 'emoji',
            url: urls[0],
            alt: 'emote'
          });
        }
      }
    }

    return {
      id: `tt-msg-${data.common?.msgId || data.msgId || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      platform: 'tiktok',
      type: 'text',
      authorName,
      avatarUrl,
      roles,
      parts,
      plainText: comment,
      timestamp: Date.now()
    };
  }

  formatGiftMessage(data) {
    const user = data.user || data;
    const authorName = user.nickname || user.displayId || user.uniqueId || 'TikTok Gifter';
    const avatarUrl = this.extractAvatarUrl(user);
    const roles = this.extractRoles(data);

    const details = data.gift || data.giftDetails || data;
    const giftName =
      details.name ||
      details.giftName ||
      (data.common?.describe ? data.common.describe.replace(/^.*?:\s*/, '') : null) ||
      `Gift #${data.giftId || ''}`;
    const repeatCount = Number(data.repeatCount || data.comboCount) || 1;
    const diamondPerUnit = Number(details.diamondCount) || 1;
    const totalDiamonds = diamondPerUnit * repeatCount;

    const iconUrls =
      details.icon?.url ||
      details.icon?.urlList ||
      details.image?.url ||
      details.image?.urlList ||
      details.giftImage?.url ||
      details.giftImage?.urlList ||
      data.giftImage?.url ||
      (data.giftPictureUrl ? [data.giftPictureUrl] : []);
    const giftIconUrl = Array.isArray(iconUrls) && iconUrls.length > 0 ? iconUrls[0] : null;

    const text = `Mengirim ${giftName} x${repeatCount}`;
    const parts = [{ type: 'text', text: `${text} ` }];
    if (giftIconUrl) {
      parts.push({
        type: 'emoji',
        url: giftIconUrl,
        alt: giftName
      });
    }

    return {
      id: `tt-gift-${data.common?.msgId || data.msgId || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      platform: 'tiktok',
      type: 'superchat',
      authorName,
      avatarUrl,
      roles,
      parts,
      plainText: text,
      purchaseAmount: `💎 ${totalDiamonds} Coins`,
      timestamp: Date.now()
    };
  }

  disconnect() {
    this.isRunning = false;
    if (this.connection) {
      try {
        this.connection.disconnect();
      } catch (e) {
        // Ignore disconnect error
      }
      this.connection = null;
    }
  }
}

module.exports = { TikTokLiveChat };
