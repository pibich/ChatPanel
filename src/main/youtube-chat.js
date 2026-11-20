const { EventEmitter } = require('events');

/**
 * YouTubeLiveChat - Pure Node.js Innertube Live Chat client without requiring an official API Key.
 * Supports:
 * - Full YouTube Watch URLs (https://www.youtube.com/watch?v=...)
 * - YouTube Live URLs (https://www.youtube.com/live/...)
 * - Short URLs (https://youtu.be/...)
 * - Channel handles (@username or https://www.youtube.com/@username/live)
 * - Direct 11-character Video IDs
 */
class YouTubeLiveChat extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.pollTimer = null;
    this.videoId = null;
    this.channelTitle = null;
    this.liveTitle = null;
    this.apiKey = null;
    this.clientVersion = '2.20241118.01.00';
    this.continuation = null;
    this.seenMessageIds = new Set();
  }

  /**
   * Extract videoId or build appropriate target URL from user input
   */
  parseTargetUrl(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) {
      throw new Error('Masukkan URL YouTube Live, Video ID, atau @channel.');
    }

    // Direct 11-char video ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return `https://www.youtube.com/watch?v=${trimmed}`;
    }

    // Channel Handle e.g. @GamingChannel
    if (trimmed.startsWith('@')) {
      return `https://www.youtube.com/${trimmed}/live`;
    }

    // URL parsing
    try {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      if (url.hostname.includes('youtu.be')) {
        const id = url.pathname.split('/').filter(Boolean)[0];
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      }
      if (url.pathname.startsWith('/live/')) {
        const id = url.pathname.replace('/live/', '').split('/')[0];
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      }
      if (url.pathname.startsWith('/@')) {
        const parts = url.pathname.split('/').filter(Boolean);
        return `https://www.youtube.com/${parts[0]}/live`;
      }
      if (url.searchParams.has('v')) {
        return `https://www.youtube.com/watch?v=${url.searchParams.get('v')}`;
      }
      return url.toString();
    } catch (e) {
      throw new Error('Format URL atau Video ID YouTube tidak valid.');
    }
  }

  async connect(input) {
    this.disconnect();
    const targetUrl = this.parseTargetUrl(input);

    this.emit('status', {
      platform: 'youtube',
      state: 'connecting',
      message: 'Menghubungkan ke YouTube Live...'
    });

    try {
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      };

      // Step 1: Fetch the watch/live page to resolve videoId, title, and check live chat availability
      const watchRes = await fetch(targetUrl, { headers });
      if (!watchRes.ok) {
        throw new Error(`Gagal membuka halaman YouTube (HTTP ${watchRes.status})`);
      }
      const watchHtml = await watchRes.text();

      // Extract Video ID
      const videoIdMatch =
        watchHtml.match(/"videoId":"([a-zA-Z0-9_-]{11})"/) ||
        watchHtml.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})">/);

      if (!videoIdMatch) {
        throw new Error('Stream tidak ditemukan. Pastikan channel sedang Live atau Video ID benar.');
      }
      this.videoId = videoIdMatch[1];

      // Extract Title & Author if available
      const titleMatch = watchHtml.match(/"title":"([^"]+)"/);
      const authorMatch = watchHtml.match(/"author":"([^"]+)"/) || watchHtml.match(/"ownerChannelName":"([^"]+)"/);
      this.liveTitle = titleMatch ? this.unescapeJsonString(titleMatch[1]) : `YouTube Live (${this.videoId})`;
      this.channelTitle = authorMatch ? this.unescapeJsonString(authorMatch[1]) : 'YouTube Streamer';

      // Step 2: Fetch live_chat popout page for clean initial continuation & innertube credentials
      const chatPageUrl = `https://www.youtube.com/live_chat?v=${this.videoId}`;
      const chatRes = await fetch(chatPageUrl, { headers });
      const chatHtml = await chatRes.text();

      const apiKeyMatch =
        chatHtml.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || watchHtml.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
      const clientVerMatch =
        chatHtml.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) ||
        watchHtml.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);

      if (!apiKeyMatch) {
        throw new Error('Gagal mendapatkan Innertube key dari halaman YouTube.');
      }

      this.apiKey = apiKeyMatch[1];
      if (clientVerMatch) {
        this.clientVersion = clientVerMatch[1];
      }

      // Extract continuation token from live_chat page or watch page
      let continuation = this.extractContinuationFromHtml(chatHtml) || this.extractContinuationFromHtml(watchHtml);

      if (!continuation) {
        throw new Error('Live Chat tidak ditemukan atau dinonaktifkan pada video/stream ini.');
      }

      this.continuation = continuation;
      this.isRunning = true;

      this.emit('status', {
        platform: 'youtube',
        state: 'connected',
        videoId: this.videoId,
        channelTitle: this.channelTitle,
        liveTitle: this.liveTitle,
        message: `YT Live: ${this.channelTitle}`
      });

      this.scheduleNextPoll(200);
    } catch (err) {
      this.isRunning = false;
      this.emit('status', {
        platform: 'youtube',
        state: 'error',
        message: err.message || 'Gagal terhubung ke YouTube Live.'
      });
    }
  }

  extractContinuationFromHtml(html) {
    // Look for liveChatContinuation token in ytInitialData
    const patterns = [
      /"liveChatRenderer":[\s\S]*?"continuation":"([^"]+)"/,
      /"reloadContinuationData":\{"continuation":"([^"]+)"/,
      /"invalidationContinuationData":\{"invalidationId":[\s\S]*?"continuation":"([^"]+)"/,
      /"timedContinuationData":\{"timeoutMs":\d+,"continuation":"([^"]+)"/
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  }

  unescapeJsonString(str) {
    try {
      return JSON.parse(`"${str.replace(/"/g, '\\"')}"`);
    } catch {
      return str;
    }
  }

  scheduleNextPoll(delayMs = 1500) {
    if (!this.isRunning) return;
    clearTimeout(this.pollTimer);
    const safeDelay = Math.max(800, Math.min(delayMs, 5000));
    this.pollTimer = setTimeout(() => this.pollChat(), safeDelay);
  }

  async pollChat() {
    if (!this.isRunning || !this.continuation) return;

    try {
      const endpoint = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${this.apiKey}&prettyPrint=false`;
      const payload = {
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: this.clientVersion,
            hl: 'id',
            gl: 'ID'
          }
        },
        continuation: this.continuation
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          Origin: 'https://www.youtube.com',
          Referer: `https://www.youtube.com/live_chat?v=${this.videoId}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} saat mengambil live chat`);
      }

      const data = await res.json();
      const liveChatContinuation = data?.continuationContents?.liveChatContinuation;

      if (!liveChatContinuation) {
        // Stream may have ended
        this.emit('status', {
          platform: 'youtube',
          state: 'error',
          message: 'Sesi Live Chat YouTube telah berakhir.'
        });
        this.disconnect();
        return;
      }

      // Parse actions (new chat messages)
      const actions = liveChatContinuation.actions || [];
      for (const action of actions) {
        const parsed = this.parseChatAction(action);
        if (parsed && !this.seenMessageIds.has(parsed.id)) {
          this.seenMessageIds.add(parsed.id);
          // Prevent Set from growing unbounded
          if (this.seenMessageIds.size > 2000) {
            const firstKey = this.seenMessageIds.values().next().value;
            this.seenMessageIds.delete(firstKey);
          }
          this.emit('chat', parsed);
        }
      }

      // Extract next continuation & timeout
      const continuations = liveChatContinuation.continuations || [];
      let nextContinuation = null;
      let timeoutMs = 1500;

      for (const cont of continuations) {
        const contData =
          cont.invalidationContinuationData ||
          cont.timedContinuationData ||
          cont.liveChatReplayContinuationData ||
          cont.reloadContinuationData;

        if (contData && contData.continuation) {
          nextContinuation = contData.continuation;
          if (contData.timeoutMs) {
            timeoutMs = contData.timeoutMs;
          }
          break;
        }
      }

      if (nextContinuation) {
        this.continuation = nextContinuation;
        this.scheduleNextPoll(timeoutMs);
      } else {
        this.scheduleNextPoll(2000);
      }
    } catch (err) {
      // Transient network error: retry after 3 seconds
      if (this.isRunning) {
        this.scheduleNextPoll(3000);
      }
    }
  }

  parseChatAction(action) {
    const item = action?.addChatItemAction?.item;
    if (!item) return null;

    // 1. Regular Text Message
    if (item.liveChatTextMessageRenderer) {
      return this.formatRenderer(item.liveChatTextMessageRenderer, 'text');
    }

    // 2. Paid Message (Super Chat)
    if (item.liveChatPaidMessageRenderer) {
      return this.formatRenderer(item.liveChatPaidMessageRenderer, 'superchat');
    }

    // 3. Membership Item (New Member / Milestone)
    if (item.liveChatMembershipItemRenderer) {
      return this.formatRenderer(item.liveChatMembershipItemRenderer, 'membership');
    }

    // 4. Paid Sticker (Super Sticker)
    if (item.liveChatPaidStickerRenderer) {
      return this.formatRenderer(item.liveChatPaidStickerRenderer, 'supersticker');
    }

    return null;
  }

  formatRenderer(renderer, type) {
    const id = renderer.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const authorName =
      renderer.authorName?.simpleText ||
      (renderer.authorName?.runs ? renderer.authorName.runs.map((r) => r.text).join('') : 'Anonymous');

    const thumbs = renderer.authorPhoto?.thumbnails || [];
    const avatarUrl = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';

    // Parse Author Badges (Owner, Moderator, Member, Verified)
    const roles = {
      isOwner: false,
      isModerator: false,
      isMember: false,
      isVerified: false,
      memberBadgeUrl: null,
      memberLabel: null
    };

    const badges = renderer.authorBadges || [];
    for (const b of badges) {
      const badgeRenderer = b.liveChatAuthorBadgeRenderer;
      if (!badgeRenderer) continue;

      const iconType = badgeRenderer.icon?.iconType || '';
      const tooltip = (badgeRenderer.tooltip || '').toLowerCase();

      if (iconType === 'OWNER' || tooltip.includes('owner') || tooltip.includes('pemilik')) {
        roles.isOwner = true;
      } else if (iconType === 'MODERATOR' || tooltip.includes('moderator')) {
        roles.isModerator = true;
      } else if (iconType === 'VERIFIED' || tooltip.includes('verified')) {
        roles.isVerified = true;
      } else if (badgeRenderer.customThumbnail) {
        roles.isMember = true;
        const badgeThumbs = badgeRenderer.customThumbnail.thumbnails || [];
        if (badgeThumbs.length > 0) {
          roles.memberBadgeUrl = badgeThumbs[badgeThumbs.length - 1].url;
        }
        roles.memberLabel = badgeRenderer.tooltip || 'Member';
      }
    }

    if (type === 'membership') {
      roles.isMember = true;
    }

    // Parse message runs (text + custom emojis)
    const messageRuns = renderer.message?.runs || renderer.headerSubtext?.runs || [];
    const parts = [];
    let plainText = '';

    for (const run of messageRuns) {
      if (run.text) {
        parts.push({ type: 'text', text: run.text });
        plainText += run.text;
      } else if (run.emoji) {
        const emojiThumbs = run.emoji.image?.thumbnails || [];
        const emojiUrl = emojiThumbs.length > 0 ? emojiThumbs[emojiThumbs.length - 1].url : null;
        const shortcut = run.emoji.shortcuts?.[0] || run.emoji.emojiId || '';
        if (emojiUrl) {
          parts.push({
            type: 'emoji',
            url: emojiUrl,
            alt: shortcut
          });
          plainText += ` ${shortcut} `;
        } else if (run.emoji.emojiId) {
          parts.push({ type: 'text', text: run.emoji.emojiId });
          plainText += run.emoji.emojiId;
        }
      }
    }

    // Fallback for membership announcement header
    if (parts.length === 0 && renderer.headerPrimaryText?.runs) {
      const headerText = renderer.headerPrimaryText.runs.map((r) => r.text).join('');
      parts.push({ type: 'text', text: headerText });
      plainText = headerText;
    }

    // Super Chat / Paid Sticker info
    const purchaseAmount = renderer.purchaseAmountText?.simpleText || null;
    const bodyBgColor = renderer.bodyBackgroundColor ? this.argbToRgba(renderer.bodyBackgroundColor) : null;
    const headerBgColor = renderer.headerBackgroundColor ? this.argbToRgba(renderer.headerBackgroundColor) : null;

    return {
      id,
      platform: 'youtube',
      type,
      authorName,
      avatarUrl,
      roles,
      parts,
      plainText: plainText.trim(),
      purchaseAmount,
      bodyBgColor,
      headerBgColor,
      timestamp: Date.now()
    };
  }

  argbToRgba(argbInt) {
    const unsigned = argbInt >>> 0;
    const a = ((unsigned >> 24) & 0xff) / 255;
    const r = (unsigned >> 16) & 0xff;
    const g = (unsigned >> 8) & 0xff;
    const b = unsigned & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
  }

  disconnect() {
    this.isRunning = false;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.continuation = null;
  }
}

module.exports = { YouTubeLiveChat };
