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
    this.statsTimer = null;
    this.videoId = null;
    this.channelTitle = null;
    this.liveTitle = null;
    this.apiKey = null;
    this.clientVersion = '2.20241118.01.00';
    this.continuation = null;
    this.seenMessageIds = new Set();
    this.viewerCount = 0;
    this.likeCount = 0;
  }

  emitLog(level, message, details = '') {
    this.emit('log', {
      platform: 'youtube',
      level,
      message,
      details: details ? String(details) : '',
      timestamp: Date.now()
    });
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
    let targetUrl;
    try {
      targetUrl = this.parseTargetUrl(input);
    } catch (err) {
      this.emitLog('error', err.message, `Input: "${input}"`);
      this.emit('status', {
        platform: 'youtube',
        state: 'error',
        message: err.message
      });
      return;
    }

    this.emitLog('info', `Menghubungkan ke YouTube Live (${targetUrl})...`);
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

      this.emitLog('info', `Terhubung ke YouTube Live: ${this.channelTitle} (Video ID: ${this.videoId})`);
      this.emit('status', {
        platform: 'youtube',
        state: 'connected',
        videoId: this.videoId,
        channelTitle: this.channelTitle,
        liveTitle: this.liveTitle,
        message: `YT Live: ${this.channelTitle}`
      });

      // Extract initial viewer count and like count from watchHtml AFTER emitting connected status
      this.extractAndEmitStatsFromHtml(watchHtml);

      // Poll live stats (concurrent viewers & likes) every 8 seconds
      clearInterval(this.statsTimer);
      this.statsTimer = setInterval(() => {
        if (this.isRunning) {
          this.pollLiveStats().catch(() => {});
        }
      }, 8000);
      // Also run an immediate Innertube stats check
      this.pollLiveStats().catch(() => {});

      this.scheduleNextPoll(200);
    } catch (err) {
      this.isRunning = false;
      this.emitLog('error', err.message || 'Gagal terhubung ke YouTube Live.', err?.stack || String(err));
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

  extractLikesFromText(text) {
    if (!text) return null;

    // 1. Exact likeCount string or number in microformat / videoPrimaryInfoRenderer: "likeCount":"9984" or "likeCount":9984
    const exactMatch =
      text.match(/"likeCount"\s*:\s*"(\d+)"/) ||
      text.match(/"likeCount"\s*:\s*(\d+)/) ||
      text.match(/"likeCountIfIndifferentNumber"\s*:\s*"(\d+)"/);
    if (exactMatch && exactMatch[1]) {
      const val = parseInt(exactMatch[1], 10);
      if (!isNaN(val)) return val;
    }

    // 2. Accessibility text in Indonesian or English:
    // e.g. "suka video ini bersama 9.984 orang lainnya" or "like this video along with 9,984 other people" or "9.984 suka"
    const a11yPatterns = [
      /"accessibilityText"\s*:\s*"[^"]*?(?:bersama|with)\s+([\d.,]+)\s+(?:orang|other)/i,
      /"label"\s*:\s*"[^"]*?(?:bersama|with)\s+([\d.,]+)\s+(?:orang|other)/i,
      /"accessibilityText"\s*:\s*"([\d.,]+)\s+(?:suka|likes?)"/i,
      /"label"\s*:\s*"([\d.,]+)\s+(?:suka|likes?)"/i
    ];
    for (const pat of a11yPatterns) {
      const m = text.match(pat);
      if (m && m[1]) {
        const val = parseInt(m[1].replace(/[.,\s]/g, ''), 10);
        if (!isNaN(val)) return val;
      }
    }

    // 3. Modern buttonViewModel title: "iconName":"LIKE","title":"9,9 rb"
    const btnTitleMatch = text.match(/"iconName"\s*:\s*"LIKE"\s*,\s*"title"\s*:\s*"([^"]+)"/);
    if (btnTitleMatch && btnTitleMatch[1]) {
      const val = this.parseCompactNumber(btnTitleMatch[1]);
      if (val !== null) return val;
    }

    return null;
  }

  extractViewersFromText(text) {
    if (!text) return null;
    const viewerPatterns = [
      /"originalViewCount"\s*:\s*"(\d+)"/,
      /"concurrentViewers"\s*:\s*"(\d+)"/,
      /"viewCount"\s*:\s*\{"videoViewCountRenderer"\s*:\s*\{"viewCount"\s*:\s*\{"runs"\s*:\s*\[\{"text"\s*:\s*"([\d.,]+)"\}/,
      /"viewCount"\s*:\s*\{"runs"\s*:\s*\[\{"text"\s*:\s*"([\d.,]+)"\}/
    ];
    for (const pat of viewerPatterns) {
      const m = text.match(pat);
      if (m && m[1]) {
        const parsed = parseInt(m[1].replace(/[.,\s]/g, ''), 10);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return null;
  }

  extractAndEmitStatsFromHtml(html) {
    if (!html) return;

    const viewers = this.extractViewersFromText(html);
    if (viewers !== null) {
      this.viewerCount = viewers;
    }

    const likes = this.extractLikesFromText(html);
    if (likes !== null) {
      this.likeCount = likes;
    }

    if (this.isRunning) {
      this.emit('stats', {
        platform: 'youtube',
        viewerCount: this.viewerCount,
        likeCount: this.likeCount
      });
    }
  }

  async pollLiveStats() {
    if (!this.isRunning || !this.videoId || !this.apiKey) return;

    try {
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Origin: 'https://www.youtube.com',
        Referer: `https://www.youtube.com/watch?v=${this.videoId}`,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      };

      const contextPayload = {
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: this.clientVersion,
            hl: 'id',
            gl: 'ID'
          }
        },
        videoId: this.videoId
      };

      // 1. Query updated_metadata for real-time concurrent viewer count
      const metaUrl = `https://www.youtube.com/youtubei/v1/updated_metadata?key=${this.apiKey}&prettyPrint=false`;
      const metaPromise = fetch(metaUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(contextPayload)
      }).catch(() => null);

      // 2. Query /youtubei/v1/player for exact real-time microformat.playerMicroformatRenderer.likeCount
      const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${this.apiKey}&prettyPrint=false`;
      const playerPromise = fetch(playerUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(contextPayload)
      }).catch(() => null);

      const [metaRes, playerRes] = await Promise.all([metaPromise, playerPromise]);

      if (metaRes && metaRes.ok) {
        const metaData = await metaRes.json();
        const actions = metaData?.actions || [];
        for (const act of actions) {
          if (act.updateViewershipAction) {
            const vcRenderer = act.updateViewershipAction.viewCount?.videoViewCountRenderer;
            if (vcRenderer) {
              const rawOrig = vcRenderer.originalViewCount;
              const unlabeled = vcRenderer.unlabeledViewCountValue?.simpleText;
              const runsText =
                vcRenderer.viewCount?.runs?.[0]?.text || vcRenderer.viewCount?.simpleText || '';
              const numStr = rawOrig || (unlabeled || runsText).replace(/[^\d]/g, '');
              if (numStr) {
                const parsed = parseInt(numStr, 10);
                if (!isNaN(parsed)) {
                  this.viewerCount = parsed;
                }
              }
            }
          }

          if (act.updateToggleButtonTextAction) {
            const btnText =
              act.updateToggleButtonTextAction.defaultText?.simpleText ||
              act.updateToggleButtonTextAction.defaultText?.runs?.[0]?.text ||
              '';
            const num = this.parseCompactNumber(btnText);
            if (num !== null) {
              this.likeCount = num;
            }
          }
        }
      }

      let gotExactLikes = false;
      if (playerRes && playerRes.ok) {
        const playerData = await playerRes.json();
        const rawLikeCount = playerData?.microformat?.playerMicroformatRenderer?.likeCount;
        if (rawLikeCount !== undefined && rawLikeCount !== null) {
          const parsedLikes = parseInt(String(rawLikeCount).replace(/[^\d]/g, ''), 10);
          if (!isNaN(parsedLikes)) {
            this.likeCount = parsedLikes;
            gotExactLikes = true;
          }
        }
      }

      // 3. Fallback to /youtubei/v1/next if player microformat didn't return likeCount
      if (!gotExactLikes) {
        const nextUrl = `https://www.youtube.com/youtubei/v1/next?key=${this.apiKey}&prettyPrint=false`;
        const nextRes = await fetch(nextUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(contextPayload)
        }).catch(() => null);

        if (nextRes && nextRes.ok) {
          const nextText = await nextRes.text();
          const extractedLikes = this.extractLikesFromText(nextText);
          if (extractedLikes !== null) {
            this.likeCount = extractedLikes;
          }
        }
      }

      if (this.isRunning) {
        this.emit('stats', {
          platform: 'youtube',
          viewerCount: this.viewerCount,
          likeCount: this.likeCount
        });
      }
    } catch (e) {
      // Ignore transient stats errors
    }
  }

  parseCompactNumber(text) {
    if (!text || typeof text !== 'string') return null;
    // Normalize non-breaking spaces (\u00a0) and trim
    const clean = text.replace(/[\u00a0\s]+/g, ' ').trim().toLowerCase();
    if (!clean) return null;
    // Handle Indonesian/English suffixes like "1,2 rb", "1.2K", "2,5 jt", "2.5M"
    const match = clean.match(/^([\d.,]+)\s*(rb|k|jt|m|b)?$/i);
    if (!match) {
      const digitsOnly = clean.replace(/[^\d]/g, '');
      return digitsOnly ? parseInt(digitsOnly, 10) : null;
    }
    const numPart = match[1];
    const suffix = (match[2] || '').toLowerCase();
    if (suffix) {
      const floatVal = parseFloat(numPart.replace(',', '.'));
      if (isNaN(floatVal)) return null;
      if (suffix === 'rb' || suffix === 'k') return Math.round(floatVal * 1000);
      if (suffix === 'jt' || suffix === 'm') return Math.round(floatVal * 1000000);
      if (suffix === 'b') return Math.round(floatVal * 1000000000);
    }
    const rawInt = parseInt(numPart.replace(/[.,]/g, ''), 10);
    return isNaN(rawInt) ? null : rawInt;
  }

  disconnect() {
    this.isRunning = false;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
    clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.continuation = null;
    this.viewerCount = 0;
    this.likeCount = 0;
  }
}

module.exports = { YouTubeLiveChat };
