import { MessageType, PlayerEvent } from "../api/types.js";

const audio = new Audio();
audio.preload = "auto";
const mediaSession = navigator.mediaSession;
let activePlaybackId = 0;
let lastProgressAt = 0;
let suppressEvents = false;

function sendMediaAction(action) {
  chrome.runtime.sendMessage({ type: MessageType.MEDIA_SESSION_ACTION, target: "background", action }).catch(() => undefined);
}

if (mediaSession) {
  const actions = { play: "play", pause: "pause", previoustrack: "previous", nexttrack: "next" };
  Object.entries(actions).forEach(([name, action]) => {
    try { mediaSession.setActionHandler(name, () => sendMediaAction(action)); } catch (error) { console.warn(`Media Session action unavailable: ${name}`, error); }
  });
  try {
    mediaSession.setActionHandler("seekto", ({ seekTime }) => {
      if (!Number.isFinite(seekTime) || !Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.min(Math.max(0, seekTime), audio.duration);
      notifyProgress(true);
    });
  } catch (error) { console.warn("Media Session action unavailable: seekto", error); }
  for (const [name, direction] of [["seekbackward", -1], ["seekforward", 1]]) {
    try {
      mediaSession.setActionHandler(name, ({ seekOffset }) => {
        if (!Number.isFinite(audio.duration)) return;
        const offset = Number(seekOffset) || 10;
        audio.currentTime = Math.min(Math.max(0, audio.currentTime + direction * offset), audio.duration);
        notifyProgress(true);
      });
    } catch (error) { console.warn(`Media Session action unavailable: ${name}`, error); }
  }
}

function updateMediaSession(song, playing) {
  if (!mediaSession || typeof MediaMetadata === "undefined") return;
  mediaSession.playbackState = playing ? "playing" : "paused";
  if (!song) { mediaSession.metadata = null; return; }
  mediaSession.metadata = new MediaMetadata({
    title: song.title || "Netease Music Mini",
    artist: song.artist || "",
    album: song.album || "",
    artwork: song.cover ? [{ src: song.cover, sizes: "300x300", type: "image/jpeg" }] : []
  });
}

function notify(event, detail = {}) {
  if (suppressEvents) return;
  chrome.runtime.sendMessage({
    type: MessageType.PLAYER_EVENT,
    target: "background",
    event,
    playbackId: activePlaybackId,
    ...detail
  }).catch(() => undefined);
}

function playbackPosition() {
  return {
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0
  };
}

function syncPositionState() {
  if (!mediaSession || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  try {
    mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(Math.max(0, audio.currentTime), audio.duration)
    });
  } catch (error) { console.warn("Media Session position sync failed", error); }
}

function notifyProgress(force = false) {
  const now = Date.now();
  if (!force && now - lastProgressAt < 500) return;
  lastProgressAt = now;
  syncPositionState();
  notify(PlayerEvent.PROGRESS, playbackPosition());
}

audio.addEventListener("playing", () => notify(PlayerEvent.PLAYING));
audio.addEventListener("pause", () => {
  if (!audio.ended) notify(PlayerEvent.PAUSED);
});
audio.addEventListener("ended", () => notify(PlayerEvent.ENDED));
audio.addEventListener("error", () => notify(PlayerEvent.ERROR, { mediaError: audio.error?.code }));
audio.addEventListener("loadedmetadata", () => notifyProgress(true));
audio.addEventListener("durationchange", () => notifyProgress(true));
audio.addEventListener("timeupdate", () => notifyProgress());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  if (message.type === MessageType.PING) {
    // The background polls this to learn that the document is alive and its
    // listener is registered.
    sendResponse({ ok: true });
    return;
  }
  if (message.type === MessageType.PLAY_SONG) {
    suppressEvents = false;
    activePlaybackId = Number(message.playbackId) || activePlaybackId + 1;
    const playbackId = activePlaybackId;
    audio.src = message.url;
    lastProgressAt = 0;
    audio.play().then(() => sendResponse({ ok: true })).catch((error) => {
      // Switching tracks aborts the pending play() of the previous track.
      // That is a normal race, not a playback failure.
      if (error?.name === "AbortError") {
        sendResponse({ ok: true, aborted: true });
        return;
      }
      console.error("Audio playback failed", error);
      sendResponse({ ok: false, error: "PLAYBACK_FAILED", message: "当前歌曲暂不可播放", playbackId });
    });
    return true;
  }
  if (message.type === MessageType.PLAY) {
    audio.play().then(() => sendResponse({ ok: true })).catch((error) => {
      console.error("Audio resume failed", error);
      sendResponse({ ok: false, error: "PLAYBACK_FAILED", message: "当前歌曲暂不可播放" });
    });
    return true;
  }
  if (message.type === MessageType.GET_PLAYBACK_STATUS) {
    sendResponse({ ok: true, hasSource: Boolean(audio.currentSrc || audio.src), playing: !audio.paused && !audio.ended, ...playbackPosition() });
    return;
  }
  if (message.type === MessageType.SEEK) {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      sendResponse({ ok: false, error: "SEEK_UNAVAILABLE", message: "暂时无法调整播放进度" });
      return;
    }
    const position = Number(message.position);
    audio.currentTime = Math.min(Math.max(0, Number.isFinite(position) ? position : 0), audio.duration);
    notifyProgress(true);
    sendResponse({ ok: true, ...playbackPosition() });
    return;
  }
  if (message.type === MessageType.PAUSE) {
    audio.pause();
    sendResponse({ ok: true });
  }
  if (message.type === MessageType.STOP) {
    suppressEvents = true;
    activePlaybackId = Number(message.playbackId) || activePlaybackId + 1;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    updateMediaSession(null, false);
    sendResponse({ ok: true });
  }
  if (message.type === MessageType.SET_MEDIA_SESSION) {
    updateMediaSession(message.song, message.playing);
    sendResponse({ ok: true });
  }
});
