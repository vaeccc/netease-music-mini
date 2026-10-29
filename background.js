import { ErrorCode, MessageType, PlaybackMode, PlayerEvent, emptyPlayerState } from "./api/types.js";
import { clearCredential, clearShuffleState, getCredential, getPlayerState, getShuffleState, setCredential, setPlayerState, setShuffleState } from "./storage/store.js";
import { clearNeteaseCookies, createQrLogin, getBrowserCredential, pollQrLogin } from "./api/auth.js";
import { getAlbumSongs, getLikedSongs, getPlayUrl, getPlaylistSongs, getSingerSongs, getToplistDetail, getToplists, getUserLibrary, NeteaseError, searchSongs, validateCredential } from "./api/netease.js";

let playerState = emptyPlayerState();
let initialized = false;
let loginAttempt = null;
let offscreenCreating = null;
let offscreenReady = false;
let playRequestId = 0;
const shuffleHistory = [];
let shuffleQueueKey = "";
const skippablePlaybackErrors = new Set([ErrorCode.NO_PERMISSION, ErrorCode.NO_COPYRIGHT, ErrorCode.PLAY_URL, ErrorCode.PLAYBACK_FAILED]);

function describePlaybackError(error, song, skipped = false) {
  const title = song?.title ? `《${song.title}》` : "当前歌曲";
  const messages = {
    [ErrorCode.LOGIN_EXPIRED]: "网易云音乐登录已失效，请重新登录",
    [ErrorCode.NETWORK]: "网络连接失败，请检查网络后重试",
    [ErrorCode.NO_PERMISSION]: `${title}：当前账号无播放权限`,
    [ErrorCode.NO_COPYRIGHT]: `${title}：因版权限制暂不可播放`,
    [ErrorCode.PLAY_URL]: `${title}：播放地址获取失败`,
    [ErrorCode.PLAYBACK_FAILED]: `${title}：音频加载失败`
  };
  const code = error instanceof NeteaseError ? error.code : error?.code || ErrorCode.NETWORK;
  return { code, message: `${messages[code] || error?.message || "播放失败"}${skipped ? "，已自动跳过" : ""}` };
}

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen/offscreen.html");
  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [offscreenUrl] });
    return contexts.length > 0;
  }
  try {
    const pong = await chrome.runtime.sendMessage({ type: MessageType.PING, target: "offscreen" });
    return Boolean(pong?.ok);
  } catch (error) {
    return false;
  }
}

async function ensureOffscreenDocument() {
  if (offscreenCreating) return offscreenCreating;
  offscreenCreating = (async () => {
    if (await hasOffscreenDocument()) {
      if (offscreenReady) return;
      await waitForOffscreenReady();
      return;
    }
    offscreenReady = false;
    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "在关闭扩展弹窗后继续播放用户有权播放的音乐。"
    });
    await waitForOffscreenReady();
  })();
  try { await offscreenCreating; } finally { offscreenCreating = null; }
}

async function waitForOffscreenReady(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pong = await chrome.runtime.sendMessage({ type: MessageType.PING, target: "offscreen" });
      if (pong?.ok) {
        offscreenReady = true;
        return true;
      }
    } catch (error) {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function initialize() {
  if (initialized) return;
  playerState = { ...emptyPlayerState(), ...((await getPlayerState()) || {}) };
  if (!Object.values(PlaybackMode).includes(playerState.playMode)) playerState.playMode = PlaybackMode.ORDER;
  const restoredShuffle = await getShuffleState();
  shuffleHistory.splice(0, shuffleHistory.length, ...restoredShuffle.history);
  shuffleQueueKey = restoredShuffle.queueKey;
  playerState.playing = false;
  playerState.errorCode = "";
  playerState.errorMessage = "";
  initialized = true;
}

async function requireCredential() {
  let credential = await getCredential();
  // 官方网页登录可能在弹窗关闭期间完成，优先从浏览器会话补回扩展凭证。
  if (!credential) {
    credential = await getBrowserCredential();
    if (credential) await setCredential(credential);
  }
  if (!credential) throw new NeteaseError(ErrorCode.LOGIN_EXPIRED, "网易云音乐登录已失效，请重新登录");
  // 探测登录态；无法判定时保留凭证（避免网络抖动误登出）。
  const validity = await validateCredential(credential);
  if (validity === false) {
    await clearCredential();
    throw new NeteaseError(ErrorCode.LOGIN_EXPIRED, "网易云音乐登录已失效，请重新登录");
  }
  return credential;
}

// 榜单、搜索、歌手/专辑详情以及公开歌曲播放不应被登录态阻断。
// 如果浏览器已有网易云会话则复用它，否则以匿名请求继续。
async function getOptionalCredential() {
  let credential = await getCredential();
  if (!credential) {
    credential = await getBrowserCredential();
    if (credential) await setCredential(credential);
  }
  return credential;
}

async function publishState() {
  await setPlayerState(playerState);
  if (playerState.currentSong) {
    sendToPlayer({ type: MessageType.SET_MEDIA_SESSION, song: playerState.currentSong, playing: playerState.playing })
      .catch((error) => console.error("Media Session sync failed", error));
  }
  chrome.runtime.sendMessage({ type: MessageType.PLAYER_STATE_CHANGED, state: playerState }).catch(() => undefined);
}

async function sendToPlayer(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: "offscreen" });
}

function getNextQueueIndex(queue, currentIndex, offset, { automatic = false, failed = false, excluded = new Set() } = {}) {
  if (!queue.length) return -1;
  if (playerState.playMode === PlaybackMode.REPEAT_ONE && automatic && !failed && !excluded.has(currentIndex)) return currentIndex;
  if (playerState.playMode === PlaybackMode.SHUFFLE) {
    if (offset < 0) {
      let position = -1;
      for (let index = shuffleHistory.length - 1; index >= 0; index--) {
        if (shuffleHistory[index] === currentIndex) { position = index; break; }
      }
      if (position <= 0) return -1;
      const candidate = shuffleHistory[position - 1];
      if (excluded.has(candidate)) return -1;
      shuffleHistory.length = position;
      persistShuffleState();
      return candidate;
    }
    const candidates = queue.map((_, index) => index).filter((index) => index !== currentIndex && !excluded.has(index));
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
    return automatic && !failed && !excluded.has(currentIndex) ? currentIndex : -1;
  }
  if (playerState.playMode === PlaybackMode.LIST_LOOP) {
    const direction = offset < 0 ? -1 : 1;
    for (let distance = 1; distance <= queue.length; distance += 1) {
      const candidate = (currentIndex + direction * distance + queue.length) % queue.length;
      if (!excluded.has(candidate)) return candidate;
    }
    return -1;
  }
  const direction = offset < 0 ? -1 : 1;
  for (let index = currentIndex + direction; index >= 0 && index < queue.length; index += direction) {
    if (!excluded.has(index)) return index;
  }
  return -1;
}

function rememberShuffleIndex(index) {
  if (playerState.playMode !== PlaybackMode.SHUFFLE) return;
  if (shuffleHistory[shuffleHistory.length - 1] === index) return;
  shuffleHistory.push(index);
  if (shuffleHistory.length > 200) shuffleHistory.shift();
  persistShuffleState();
}

function queueKey(queue) {
  return (queue || []).map((song) => String(song?.id || "")).join("|");
}

function persistShuffleState() {
  return setShuffleState([...shuffleHistory], shuffleQueueKey);
}

async function playQueueSong(queue, index, excluded = new Set()) {
  await initialize();
  if (!Array.isArray(queue) || index < 0 || index >= queue.length) return { ok: false, error: "INVALID_QUEUE" };
  const nextQueueKey = queueKey(queue);
  if (nextQueueKey !== shuffleQueueKey) {
    shuffleHistory.length = 0;
    shuffleQueueKey = nextQueueKey;
    persistShuffleState();
  }
  let cursor = index;
  const skipped = new Set(excluded);
  let lastDiagnostic = null;

  while (cursor >= 0 && cursor < queue.length) {
    const requestId = ++playRequestId;
    const song = queue[cursor];
    playerState = { queue, currentIndex: cursor, currentSong: song, playing: false, currentTime: 0, duration: 0, playMode: playerState.playMode || PlaybackMode.ORDER, errorCode: "", errorMessage: "" };
    await publishState();
    let playUrl;
    try {
      const credential = await getOptionalCredential();
      playUrl = song.playUrl || await getPlayUrl(song, credential);
      if (!playUrl) {
        throw new NeteaseError(ErrorCode.NO_COPYRIGHT, "因版权限制暂不可播放");
      }
    } catch (error) {
      if (requestId !== playRequestId) return { ok: true, discarded: true };
      const skippable = error instanceof NeteaseError && skippablePlaybackErrors.has(error.code);
      let nextIndex = -1;
      if (skippable) {
        skipped.add(cursor);
        nextIndex = getNextQueueIndex(queue, cursor, 1, { failed: true, excluded: skipped });
      }
      const diagnostic = describePlaybackError(error, song, nextIndex >= 0);
      lastDiagnostic = diagnostic;
      playerState.playing = false;
      playerState.errorCode = diagnostic.code;
      playerState.errorMessage = diagnostic.message;
      await publishState();
      if (nextIndex >= 0) {
        cursor = nextIndex;
        continue;
      }
      throw new NeteaseError(diagnostic.code, diagnostic.message, error?.detail);
    }
    if (requestId !== playRequestId) return { ok: true, discarded: true };
    const result = await sendToPlayer({ type: MessageType.PLAY_SONG, url: playUrl, playbackId: requestId });
    if (requestId !== playRequestId) return { ok: true, discarded: true };
    if (!result?.ok) {
      skipped.add(cursor);
      const nextIndex = getNextQueueIndex(queue, cursor, 1, { failed: true, excluded: skipped });
      const diagnostic = describePlaybackError({ code: ErrorCode.PLAYBACK_FAILED }, song, nextIndex >= 0);
      lastDiagnostic = diagnostic;
      playerState.playing = false;
      playerState.errorCode = diagnostic.code;
      playerState.errorMessage = diagnostic.message;
      await publishState();
      if (nextIndex >= 0) {
        cursor = nextIndex;
        continue;
      }
      return { ok: false, error: diagnostic.code, message: diagnostic.message };
    }
    rememberShuffleIndex(cursor);
    return { ok: true, state: playerState };
  }
  return { ok: false, error: lastDiagnostic?.code || ErrorCode.PLAYBACK_FAILED, message: lastDiagnostic?.message || "队列中没有可播放的歌曲" };
}

function serializeError(error) {
  if (!(error instanceof NeteaseError) || error.code !== "LOGIN_EXPIRED") console.error("Netease Music Mini operation failed", error);
  if (error instanceof NeteaseError) return { ok: false, error: error.code, message: error.message, detail: error.detail || undefined };
  return { ok: false, error: "NETWORK", message: "网络请求失败" };
}

async function move(offset, options = {}) {
  await initialize();
  const excluded = options.excluded || new Set();
  const nextIndex = getNextQueueIndex(playerState.queue, playerState.currentIndex, offset, { ...options, excluded });
  if (nextIndex < 0) {
    return {
      ok: false,
      error: "QUEUE_BOUNDARY",
      message: offset < 0 ? "已经是第一首了" : "已经是最后一首了",
      state: playerState
    };
  }
  return playQueueSong(playerState.queue, nextIndex, excluded);
}

async function resumeCurrentSong() {
  await initialize();
  if (playerState.errorMessage && skippablePlaybackErrors.has(playerState.errorCode)) return move(1);
  const playback = await sendToPlayer({ type: MessageType.GET_PLAYBACK_STATUS });
  if (playback?.hasSource) {
    const result = await sendToPlayer({ type: MessageType.PLAY });
    if (!result?.ok) {
      const diagnostic = describePlaybackError({ code: ErrorCode.PLAYBACK_FAILED }, playerState.currentSong);
      playerState.playing = false;
      playerState.errorCode = diagnostic.code;
      playerState.errorMessage = diagnostic.message;
      await publishState();
    }
    return result;
  }
  if (!playerState.currentSong || playerState.currentIndex < 0) {
    return { ok: false, error: "NO_SONG", message: "请先选择一首歌曲" };
  }
  return playQueueSong(playerState.queue, playerState.currentIndex);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target === "offscreen") return false;
  (async () => {
    await initialize();
    if (message.target === "background" && message.type === MessageType.PLAYER_EVENT) {
      if (message.playbackId && playRequestId === 0) playRequestId = message.playbackId;
      if (message.playbackId && message.playbackId !== playRequestId) {
        sendResponse({ ok: true, discarded: true });
        return;
      }
      if (message.event === PlayerEvent.PROGRESS) {
        playerState.currentTime = Number(message.currentTime) || 0;
        playerState.duration = Number(message.duration) || 0;
        chrome.runtime.sendMessage({ type: MessageType.PLAYER_STATE_CHANGED, state: playerState }).catch(() => undefined);
        sendResponse({ ok: true });
        return;
      }
      let errorAdvance = null;
      if (message.event === PlayerEvent.PLAYING) playerState.playing = true;
      if (message.event === PlayerEvent.PAUSED || message.event === PlayerEvent.ERROR || message.event === PlayerEvent.ENDED) playerState.playing = false;
      if (message.event === PlayerEvent.ERROR) {
        const excluded = new Set([playerState.currentIndex]);
        const nextIndex = getNextQueueIndex(playerState.queue, playerState.currentIndex, 1, { failed: true, excluded });
        const diagnostic = describePlaybackError({ code: ErrorCode.PLAYBACK_FAILED }, playerState.currentSong, nextIndex >= 0);
        playerState.errorCode = diagnostic.code;
        playerState.errorMessage = diagnostic.message;
        if (nextIndex >= 0) errorAdvance = { nextIndex, excluded };
      }
      await publishState();
      if (message.event === PlayerEvent.ENDED) {
        const advanced = await move(1, { automatic: true });
        if (!advanced?.ok && advanced?.error === "QUEUE_BOUNDARY") await publishState();
      }
      if (errorAdvance) await playQueueSong(playerState.queue, errorAdvance.nextIndex, errorAdvance.excluded);
      sendResponse({ ok: true });
      return;
    }
    if (message.target === "background" && message.type === MessageType.MEDIA_SESSION_ACTION) {
      if (message.action === "previous") sendResponse(await move(-1));
      else if (message.action === "next") sendResponse(await move(1));
      else if (message.action === "pause") sendResponse(await sendToPlayer({ type: MessageType.PAUSE }));
      else if (message.action === "play") sendResponse(await resumeCurrentSong());
      else sendResponse({ ok: false, error: "UNKNOWN_MEDIA_ACTION" });
      return;
    }
    if (message.type === MessageType.GET_PLAYER_STATE) {
      if (playerState.currentSong) {
        try {
          const playback = await sendToPlayer({ type: MessageType.GET_PLAYBACK_STATUS });
          if (playback?.ok) {
            playerState.playing = Boolean(playback.playing);
            playerState.currentTime = Number(playback.currentTime) || 0;
            playerState.duration = Number(playback.duration) || 0;
          }
        } catch (error) { console.warn("Playback position restore failed", error); }
      }
      sendResponse({ ok: true, state: playerState });
      return;
    }
    if (message.type === MessageType.PLAY_SONG) {
      sendResponse(await playQueueSong(message.queue, message.index));
      return;
    }
    if (message.type === MessageType.LOGIN_START) {
      loginAttempt = await createQrLogin();
      loginAttempt.type = "qr";
      sendResponse({ ok: true, imageUrl: loginAttempt.imageUrl });
      return;
    }
    if (message.type === MessageType.LOGIN_WEB_START) {
      loginAttempt = { type: "web" };
      try {
        await chrome.tabs.create({ url: "https://music.163.com/#/login" });
      } catch (error) {
        loginAttempt = null;
        throw new NeteaseError(ErrorCode.NETWORK, "无法打开网易云官方登录页", { detail: error?.message || "" });
      }
      sendResponse({ ok: true });
      return;
    }
    if (message.type === MessageType.LOGIN_STATUS) {
      if (loginAttempt?.type === "web") {
        const credential = await getBrowserCredential();
        if (!credential) {
          sendResponse({ ok: true, status: "waiting" });
          return;
        }
        await setCredential(credential);
        loginAttempt = null;
        sendResponse({ ok: true, status: "done" });
        return;
      }
      if (!loginAttempt?.unikey) {
        sendResponse({ ok: false, error: "NO_LOGIN_ATTEMPT", message: "登录失败，请重新尝试" });
        return;
      }
      const login = await pollQrLogin(loginAttempt.unikey);
      if (login.status === "done") {
        await setCredential(login.credential);
        loginAttempt = null;
      }
      sendResponse({ ok: true, ...login });
      return;
    }
    if (message.type === MessageType.LOGOUT) {
      await clearCredential();
      loginAttempt = null;
      await clearNeteaseCookies();
      const playMode = playerState.playMode || PlaybackMode.ORDER;
      const stopRequestId = ++playRequestId;
      shuffleHistory.length = 0;
      shuffleQueueKey = "";
      await clearShuffleState();
      playerState = { ...emptyPlayerState(), playMode };
      await publishState();
      try {
        await sendToPlayer({ type: MessageType.STOP, playbackId: stopRequestId });
      } catch (error) { console.warn("Player stop during logout failed", error); }
      sendResponse({ ok: true, state: playerState });
      return;
    }
    if (message.type === MessageType.GET_TOPLISTS) {
      sendResponse({ ok: true, ...(await getToplists()) });
      return;
    }
    if (message.type === MessageType.GET_TOPLIST_DETAIL) {
      sendResponse({ ok: true, ...(await getToplistDetail(message.toplist, await getOptionalCredential())) });
      return;
    }
    if (message.type === MessageType.GET_LIBRARY) {
      const credential = await requireCredential();
      sendResponse({ ok: true, library: await getUserLibrary(credential) });
      return;
    }
    if (message.type === MessageType.GET_LIKED_SONGS) {
      const credential = await requireCredential();
      sendResponse({ ok: true, ...(await getLikedSongs(credential, message.begin, message.limit || 50)) });
      return;
    }
    if (message.type === MessageType.GET_PLAYLIST_DETAIL) {
      const credential = await requireCredential();
      sendResponse({ ok: true, playlist: await getPlaylistSongs(message.playlist, credential, message.begin, message.limit || 100) });
      return;
    }
    if (message.type === MessageType.GET_SINGER_SONGS) {
      sendResponse({ ok: true, singer: await getSingerSongs(message.singer, await getOptionalCredential(), message.begin, message.limit || 50) });
      return;
    }
    if (message.type === MessageType.GET_ALBUM_SONGS) {
      sendResponse({ ok: true, album: await getAlbumSongs(message.album, await getOptionalCredential(), message.begin, message.limit || 50) });
      return;
    }
    if (message.type === MessageType.SEARCH_SONGS) {
      const keyword = String(message.keyword || "").trim();
      if (!keyword) {
        sendResponse({ ok: true, songs: [] });
        return;
      }
      sendResponse({ ok: true, ...(await searchSongs(keyword, await getOptionalCredential(), message.offset || 0, message.limit || 30)) });
      return;
    }
    if (message.type === MessageType.PLAY) {
      sendResponse(await resumeCurrentSong());
      return;
    }
    if (message.type === MessageType.PAUSE) {
      sendResponse(await sendToPlayer({ type: MessageType.PAUSE }));
      return;
    }
    if (message.type === MessageType.SEEK) {
      const result = await sendToPlayer({ type: MessageType.SEEK, position: message.position });
      if (result?.ok) {
        playerState.currentTime = Number(result.currentTime) || 0;
        playerState.duration = Number(result.duration) || 0;
        chrome.runtime.sendMessage({ type: MessageType.PLAYER_STATE_CHANGED, state: playerState }).catch(() => undefined);
      }
      sendResponse(result);
      return;
    }
    if (message.type === MessageType.SET_PLAY_MODE) {
      if (!Object.values(PlaybackMode).includes(message.mode)) {
        sendResponse({ ok: false, error: "INVALID_PLAY_MODE", message: "不支持的播放模式" });
        return;
      }
      if (playerState.playMode !== message.mode) {
        shuffleHistory.length = 0;
        persistShuffleState();
      }
      playerState.playMode = message.mode;
      await publishState();
      sendResponse({ ok: true, state: playerState });
      return;
    }
    if (message.type === MessageType.PREVIOUS) {
      sendResponse(await move(-1));
      return;
    }
    if (message.type === MessageType.NEXT) {
      sendResponse(await move(1));
      return;
    }
    sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
  })().catch((error) => sendResponse(serializeError(error)));
  return true;
});

initialize().catch((error) => console.error("Player initialization failed", error));
