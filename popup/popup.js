import { MessageType, PlaybackMode } from "../api/types.js";
import { icon } from "./icons.js";

const state = { tab: "liked", library: null, toplists: null, chartDetail: null, chartPaging: null, searchKeyword: "", searchResults: [], singerResults: [], albumResults: [], searchPaging: null, searchCache: new Map(), searchRequestId: 0, singerDetail: null, albumDetail: null, detail: null, player: null, seeking: false, poll: null, noticeTimer: null, viewRequestId: 0, errorShownFor: "", lastDiagnostic: null, lastPlayerKey: "", lastPlayerMode: "", lastPlayerPlaying: null, lastPlayerError: "", likedPaging: null };
const defaultTheme = { accent: "#ec4141", dark: "#d33a3a", wash: "#fdeeee" };
const themeState = { cover: "", requestId: 0, cache: new Map() };
const elements = {
  notice: document.querySelector("#notice"), noticeText: document.querySelector("#notice-text"), diagnostic: document.querySelector("#diagnostic-button"), login: document.querySelector("#login-view"), music: document.querySelector("#music-view"), accountWrap: document.querySelector("#account-wrap"), account: document.querySelector("#account-button"), accountMenu: document.querySelector("#account-menu"), accountAvatar: document.querySelector("#account-avatar"), accountName: document.querySelector("#account-name"), accountId: document.querySelector("#account-id"), logout: document.querySelector("#logout-button"), qr: document.querySelector("#qr-panel"), qrImage: document.querySelector("#qr-image"), qrStatus: document.querySelector("#qr-status"), webLogin: document.querySelector("#web-login-button"), content: document.querySelector("#content"), brand: document.querySelector("#brand-mark"), playerTitle: document.querySelector("#player-title"), playerArtist: document.querySelector("#player-artist"), playerCover: document.querySelector("#player-cover"), mode: document.querySelector("#mode-button"), toggle: document.querySelector("#toggle-button"), progress: document.querySelector("#progress-slider"), currentTime: document.querySelector("#player-current-time"), duration: document.querySelector("#player-duration")
};
const playbackModes = [
  { value: PlaybackMode.ORDER, label: "顺序播放", icon: "order" },
  { value: PlaybackMode.LIST_LOOP, label: "列表循环", icon: "repeatAll" },
  { value: PlaybackMode.REPEAT_ONE, label: "单曲循环", icon: "repeatOne" },
  { value: PlaybackMode.SHUFFLE, label: "随机播放", icon: "shuffle" }
];
function message(type, payload = {}) { return chrome.runtime.sendMessage({ type, ...payload }); }
function clear(node) { node.replaceChildren(); }
function showNotice(text = "", kind = "", hideAfter = 0, diagnostic = null) { clearTimeout(state.noticeTimer); state.noticeTimer = null; state.lastDiagnostic = diagnostic; elements.notice.hidden = !text; elements.noticeText.textContent = text; elements.notice.className = `notice ${kind}`; elements.diagnostic.hidden = !text || !diagnostic; if (text && hideAfter) state.noticeTimer = setTimeout(() => { state.noticeTimer = null; showNotice(); }, hideAfter); }
function showPlaybackError(message, hideAfter, code = "PLAYBACK_FAILED") {
  if (!message) { state.errorShownFor = ""; showNotice(); return; }
  if (state.errorShownFor === message) return;
  state.errorShownFor = message;
  const song = state.player?.currentSong;
  showNotice(message, "", hideAfter, { code, songId: String(song?.id || ""), title: song?.title || "" });
}
function showError(error, fallback = "操作失败") { const defaults = { LOGIN_EXPIRED: "网易云音乐登录已失效，请重新登录", NETWORK: "网络连接失败，请检查网络后重试", NO_PERMISSION: "当前账号无播放权限", NO_COPYRIGHT: "歌曲因版权限制暂不可播放", PLAY_URL: "播放地址获取失败", PLAYBACK_FAILED: "音频加载失败", QUEUE_BOUNDARY: "已经是队列的最后一首了" }; const apiCode = error?.detail?.code; const baseMessage = !error?.message || error.message === "网络请求失败" ? defaults[error?.error] || fallback : error.message; const message = apiCode ? `${baseMessage}（接口码 ${apiCode}）` : baseMessage; if (error?.error === "LOGIN_EXPIRED") showLoginView(); state.errorShownFor = ""; const song = state.player?.currentSong; showNotice(message, "", 0, { code: error?.error || "UNKNOWN", apiCode: apiCode || "", detail: error?.detail?.message || "", songId: String(song?.id || ""), title: song?.title || "" }); }
function closeAccountMenu() { elements.accountMenu.hidden = true; elements.account.setAttribute("aria-expanded", "false"); }
function showLoginView() { elements.login.hidden = false; elements.music.hidden = true; elements.accountWrap.hidden = true; closeAccountMenu(); }
function showMusicView() { elements.login.hidden = true; elements.music.hidden = false; elements.accountWrap.hidden = false; }
function diagnosticText() { const detail = state.lastDiagnostic || {}; const song = detail.title ? `《${detail.title}》` : "无当前歌曲"; return [`Netease Music Mini 诊断信息`, `错误：${detail.code || "UNKNOWN"}`, `接口码：${detail.apiCode || "-"}`, `接口消息：${detail.detail || "-"}`, `歌曲：${song}`, `歌曲 ID：${detail.songId || "-"}`, `时间：${new Date().toISOString()}`].join("\n"); }
async function copyDiagnostic() { const text = diagnosticText(); try { await navigator.clipboard.writeText(text); showNotice("诊断信息已复制", "info", 2500); } catch (error) { showNotice(text, "", 0, state.lastDiagnostic); } }
function renderAccount(user = {}) { const loggedIn = Boolean(user?.userId); const name = String(user?.nickname || (loggedIn ? "网易云音乐账号" : "未登录")); elements.account.textContent = loggedIn ? "账号" : "登录"; elements.accountName.textContent = name; elements.accountId.textContent = loggedIn ? `网易云 ID：${user.userId}` : "登录后查看我喜欢和歌单"; elements.accountAvatar.style.backgroundImage = user?.avatarUrl ? `url("${user.avatarUrl}")` : ""; elements.accountAvatar.textContent = user?.avatarUrl ? "" : (name.trim().charAt(0) || "N"); elements.logout.hidden = !loggedIn; }
function setCover(node, url) { node.style.backgroundImage = url ? `url("${url}")` : ""; node.innerHTML = url ? "" : icon("note"); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function rgbToHsl(red, green, blue) {
  const r = red / 255; const g = green / 255; const b = blue / 255; const max = Math.max(r, g, b); const min = Math.min(r, g, b); const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: lightness };
  const delta = max - min; const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min); let hue;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0); else if (max === g) hue = (b - r) / delta + 2; else hue = (r - g) / delta + 4;
  return { h: hue / 6, s: saturation, l: lightness };
}
function hslColor(h, s, l) { return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`; }
function hslToRgb(h, s, l) {
  const hue = ((h % 1) + 1) % 1; const hue2rgb = (p, q, t) => { let value = t; if (value < 0) value += 1; if (value > 1) value -= 1; if (value < 1 / 6) return p + (q - p) * 6 * value; if (value < 1 / 2) return q; if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6; return p; };
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
  return [hue2rgb(p, q, hue + 1 / 3), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1 / 3)];
}
function relativeLuminance(rgb) { const values = rgb.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4); return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]; }
function whiteContrast(h, s, l) { const luminance = relativeLuminance(hslToRgb(h, s, l)); return (1.05) / (luminance + 0.05); }
function applyTheme(theme = defaultTheme) { const root = document.documentElement; root.style.setProperty("--green", theme.accent); root.style.setProperty("--green-dark", theme.dark); root.style.setProperty("--green-wash", theme.wash); }
async function sampleCoverColor(url) {
  const response = await fetch(url, { credentials: "omit", cache: "force-cache" });
  if (!response.ok) throw new Error(`cover request failed: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
  const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(bitmap, 0, 0, 32, 32); bitmap.close();
  const pixels = context.getImageData(0, 0, 32, 32).data; let red = 0; let green = 0; let blue = 0; let weightSum = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255; if (alpha < 0.75) continue;
    const hsl = rgbToHsl(pixels[index], pixels[index + 1], pixels[index + 2]);
    if (hsl.l < 0.08 || hsl.l > 0.95) continue;
    const weight = Math.max(0.08, hsl.s) * alpha;
    red += pixels[index] * weight; green += pixels[index + 1] * weight; blue += pixels[index + 2] * weight; weightSum += weight;
  }
  if (!weightSum) return null;
  const color = rgbToHsl(red / weightSum, green / weightSum, blue / weightSum);
  const hue = color.s < 0.12 ? 0.0 : color.h;
  const saturation = clamp(Math.max(color.s, 0.55), 0.55, 0.82);
  let lightness = clamp(color.l, 0.42, 0.52);
  while (whiteContrast(hue, saturation, lightness) < 4.5 && lightness > 0.30) lightness -= 0.02;
  return { accent: hslColor(hue, saturation, lightness), dark: hslColor(hue, saturation, clamp(lightness - 0.16, 0.26, 0.40)), wash: hslColor(hue, 0.52, 0.94) };
}
function updateThemeFromCover(url) {
  if (themeState.cover === url) return;
  themeState.cover = url; const requestId = ++themeState.requestId;
  if (!url) { applyTheme(); return; }
  const cached = themeState.cache.get(url);
  if (cached) { applyTheme(cached); return; }
  sampleCoverColor(url).then((theme) => {
    if (requestId !== themeState.requestId) return;
    if (!theme) { applyTheme(); return; }
    themeState.cache.set(url, theme);
    if (themeState.cache.size > 32) themeState.cache.delete(themeState.cache.keys().next().value);
    applyTheme(theme);
  }).catch(() => { if (requestId === themeState.requestId) applyTheme(); });
}
function formatTime(seconds) { const value = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`; }
function renderPlayer(player) {
  state.player = player;
  const song = player?.currentSong;
  const songKey = String(song?.id || "");
  const duration = Math.max(0, Number(player?.duration) || 0);
  const currentTime = Math.min(Math.max(0, Number(player?.currentTime) || 0), duration || Infinity);
  const mode = playbackModes.find((item) => item.value === player?.playMode) || playbackModes[0];
  if (!state.seeking) { elements.progress.max = String(Math.max(0, Math.floor(duration))); elements.progress.value = String(Math.floor(currentTime)); elements.currentTime.textContent = formatTime(currentTime); }
  const displayTime = state.seeking ? Number(elements.progress.value) || 0 : currentTime;
  const changed = songKey !== state.lastPlayerKey || mode.value !== state.lastPlayerMode || Boolean(player?.playing) !== state.lastPlayerPlaying || (player?.errorMessage || "") !== state.lastPlayerError;
  if (changed) {
    state.lastPlayerKey = songKey;
    state.lastPlayerMode = mode.value;
    state.lastPlayerPlaying = Boolean(player?.playing);
    state.lastPlayerError = player?.errorMessage || "";
    elements.playerTitle.textContent = song?.title || "暂无播放歌曲";
    elements.playerArtist.textContent = song?.artist || "";
    setCover(elements.playerCover, song?.cover);
    updateThemeFromCover(song?.cover || "");
    elements.mode.innerHTML = icon(mode.icon);
    elements.mode.title = mode.label;
    elements.mode.setAttribute("aria-label", `播放模式：${mode.label}`);
    elements.toggle.innerHTML = icon(player?.playing ? "pause" : "play");
    elements.toggle.title = player?.playing ? "暂停" : "播放";
    elements.toggle.setAttribute("aria-label", player?.playing ? "暂停" : "播放");
    document.querySelectorAll(".song-row").forEach((row) => { const active = Boolean(songKey && row.dataset.songKey === songKey); row.classList.toggle("active", active); row.setAttribute("aria-current", active ? "true" : "false"); });
    if (player?.errorMessage) showPlaybackError(player.errorMessage, skippableError(player.errorCode) ? 5000 : 0, player.errorCode); else showPlaybackError("", 0);
  }
  elements.duration.textContent = formatTime(duration);
  elements.progress.disabled = !song || duration <= 0;
  elements.progress.style.setProperty("--progress", duration > 0 ? `${displayTime / duration * 100}%` : "0%");
}
function skippableError(code) { return ["NO_PERMISSION", "NO_COPYRIGHT", "PLAY_URL", "PLAYBACK_FAILED"].includes(code); }
let scrollAbortController = null;
function bindContentScroll(handler) {
  scrollAbortController?.abort();
  scrollAbortController = new AbortController();
  elements.content.addEventListener("scroll", handler, { signal: scrollAbortController.signal });
}

function makeSongRow(song, queue, index) {
  const row = document.createElement("button"); row.className = "song-row"; row.dataset.songKey = String(song.id || "");
  const cover = document.createElement("span"); cover.className = "cover"; setCover(cover, song.cover);
  const info = document.createElement("span"); info.className = "song-info";
  const title = document.createElement("strong"); title.textContent = song.title;
  const sub = document.createElement("span"); sub.textContent = [song.artist, song.album].filter(Boolean).join(" · ");
  info.append(title, sub); row.append(cover, info);
  const currentKey = state.player?.currentSong?.id; if (currentKey && String(currentKey) === row.dataset.songKey) { row.classList.add("active"); row.setAttribute("aria-current", "true"); }
  row.addEventListener("click", async () => playSong(queue, index));
  return row;
}
async function playSong(queue, index) { showNotice(); const result = await message(MessageType.PLAY_SONG, { queue, index }); if (!result.ok) showError(result, "播放失败"); }
function renderSongs(songs, emptyText) { const list = document.createElement("div"); list.className = "list"; list.dataset.songList = "true"; if (!songs.length) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = emptyText; list.append(empty); return list; } songs.forEach((song, index) => list.append(makeSongRow(song, songs, index))); return list; }
function appendSongRows(list, songs, queue, startIndex) { if (!list || !songs.length) return; const empty = list.querySelector(".empty"); empty?.remove(); const fragment = document.createDocumentFragment(); songs.forEach((song, offset) => fragment.append(makeSongRow(song, queue, startIndex + offset))); list.append(fragment); }
function updateLoadStatus(container, paging, count, label = "歌曲") { const status = container.querySelector(".load-more"); if (!status) return; status.classList.toggle("loading", Boolean(paging?.loadingMore)); status.textContent = paging?.loadingMore ? `正在加载更多${label}…` : paging?.complete ? `已加载全部 ${count} 首${label}` : `已加载 ${count}${paging?.total ? ` / ${paging.total}` : ""} 首，继续下滑加载更多`; }
function renderStartupSkeleton() { clear(elements.content); const list = document.createElement("div"); list.className = "skeleton-list"; for (let index = 0; index < 5; index += 1) list.append(document.createElement("div")); [...list.children].forEach((row) => row.className = "skeleton-row"); elements.content.append(list); }
function uniqueSongs(songs = []) { const seen = new Set(); return songs.filter((song) => { const key = String(song?.id || ""); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }

function renderToplists() {
  clear(elements.content); const list = document.createElement("div"); list.className = "list"; const toplists = state.toplists || [];
  if (!toplists.length) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "暂无排行榜"; list.append(empty); }
  toplists.forEach((toplist) => { const row = document.createElement("button"); row.className = "playlist-row"; const cover = document.createElement("span"); cover.className = "cover"; setCover(cover, toplist.cover); const info = document.createElement("span"); info.className = "playlist-info"; const title = document.createElement("strong"); title.textContent = toplist.name; const count = document.createElement("span"); count.textContent = "查看榜单歌曲"; info.append(title, count); row.append(cover, info); row.addEventListener("click", () => openToplist(toplist)); list.append(row); });
  elements.content.append(list);
}
async function openToplist(toplist) { showNotice("正在加载排行榜…", "info"); const result = await message(MessageType.GET_TOPLIST_DETAIL, { toplist }); if (!result.ok) { showError(result, "排行榜加载失败"); return; } showNotice(); state.chartDetail = result.toplist; const songs = state.chartDetail?.tracks || []; const total = Number(state.chartDetail?.total || songs.length); state.chartPaging = { loadingMore: false, total, complete: true }; renderToplistDetail(); }
function makeDetailHeader(titleText, backLabel, onBack, onPlay) { const header = document.createElement("div"); header.className = "detail-header"; const back = document.createElement("button"); back.innerHTML = icon("back"); back.setAttribute("aria-label", backLabel); back.addEventListener("click", onBack); const title = document.createElement("strong"); title.textContent = titleText; header.append(back, title); if (onPlay) { const play = document.createElement("button"); play.className = "detail-actions"; play.textContent = "播放全部"; play.disabled = false; play.addEventListener("click", onPlay); header.append(play); } return header; }
function renderToplistDetail(scrollTop = 0) { const detail = state.chartDetail; clear(elements.content); const songs = detail?.tracks || []; const header = makeDetailHeader(detail.name, "返回排行榜", () => { state.chartDetail = null; state.chartPaging = null; renderToplists(); }, songs.length ? () => playSong(songs, 0) : null); elements.content.append(header, renderSongs(songs, "榜单暂无歌曲")); const paging = state.chartPaging; if (paging && !paging.complete) { const status = document.createElement("p"); status.className = "load-more"; status.textContent = `已加载 ${songs.length} 首歌曲`; elements.content.append(status); } elements.content.scrollTop = scrollTop; }

function renderLiked() {
  clear(elements.content);
  if (!state.library?.user?.userId) {
    const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "登录后查看我喜欢的歌曲";
    const login = document.createElement("button"); login.className = "primary inline-action"; login.type = "button"; login.textContent = "登录网易云音乐"; login.addEventListener("click", startLogin);
    elements.content.append(empty, login); return;
  }
  const songs = state.library?.liked || [];
  elements.content.append(renderSongs(songs, "还没有喜欢的歌曲"));
  const paging = state.likedPaging;
  if (!paging) return;
  const status = document.createElement("p"); status.className = "load-more";
  status.textContent = paging.loadingMore ? "正在加载更多歌曲…" : paging.complete ? `已加载全部 ${songs.length} 首歌曲` : `已加载 ${songs.length}${paging.total ? ` / ${paging.total}` : ""} 首，继续下滑加载更多`;
  status.classList.toggle("loading", Boolean(paging.loadingMore)); elements.content.append(status);
  bindContentScroll(() => { if (elements.content.scrollTop + elements.content.clientHeight >= elements.content.scrollHeight - 80) loadMoreLikedSongs(); });
}

async function loadMoreLikedSongs() {
  const paging = state.likedPaging;
  if (!paging || paging.loadingMore || paging.complete) return;
  const scrollTop = elements.content.scrollTop; paging.loadingMore = true; renderLiked();
  const result = await message(MessageType.GET_LIKED_SONGS, { begin: state.library?.liked?.length || 0, limit: 50 });
  paging.loadingMore = false;
  if (!result.ok) { showError(result, "加载我喜欢失败"); renderLiked(); return; }
  const previousLength = state.library.liked.length;
  const known = new Set(state.library.liked.map((song) => String(song.id)));
  const added = uniqueSongs(result.songs || []).filter((song) => !known.has(String(song.id)));
  state.library.liked.push(...added); paging.total = result.total || paging.total; paging.complete = !added.length || state.library.liked.length >= paging.total;
  appendSongRows(elements.content.querySelector('[data-song-list="true"]'), added, state.library.liked, previousLength); updateLoadStatus(elements.content, paging, state.library.liked.length); elements.content.scrollTop = scrollTop;
}

function renderPlaylists() {
  clear(elements.content); const list = document.createElement("div"); list.className = "list";
  if (!state.library?.user?.userId) {
    const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "登录后查看你的歌单";
    const login = document.createElement("button"); login.className = "primary inline-action"; login.type = "button"; login.textContent = "登录网易云音乐"; login.addEventListener("click", startLogin);
    elements.content.append(empty, login); return;
  }
  const playlists = state.library?.playlists || [];
  if (!playlists.length) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "还没有歌单"; list.append(empty); }
  playlists.forEach((playlist) => { const row = document.createElement("button"); row.className = "playlist-row"; const cover = document.createElement("span"); cover.className = "cover"; setCover(cover, playlist.cover); const info = document.createElement("span"); info.className = "playlist-info"; const title = document.createElement("strong"); title.textContent = playlist.title; const count = document.createElement("span"); count.textContent = `${playlist.count} 首歌曲`; info.append(title, count); row.append(cover, info); row.addEventListener("click", () => openPlaylist(playlist)); list.append(row); });
  elements.content.append(list);
}

async function openPlaylist(playlist) { showNotice("正在加载歌单…", "info"); const result = await message(MessageType.GET_PLAYLIST_DETAIL, { playlist, begin: 0, limit: 100 }); if (!result.ok) { showError(result, "歌单加载失败"); return; } showNotice(); state.detail = { ...result.playlist, loadingMore: false, complete: !result.playlist.songs.length || result.playlist.songs.length >= result.playlist.total }; renderPlaylistDetail(); }
async function loadMorePlaylistSongs() {
  const detail = state.detail; if (!detail || detail.loadingMore || detail.complete) return;
  const scrollTop = elements.content.scrollTop; detail.loadingMore = true; renderPlaylistDetail(scrollTop);
  const result = await message(MessageType.GET_PLAYLIST_DETAIL, { playlist: detail, begin: detail.songs.length, limit: 100 }); detail.loadingMore = false;
  if (!result.ok) { showError(result, "加载更多歌曲失败"); renderPlaylistDetail(scrollTop); return; }
  const previousLength = detail.songs.length; const known = new Set(detail.songs.map((song) => String(song.id))); const added = uniqueSongs(result.playlist.songs || []).filter((song) => !known.has(String(song.id)));
  detail.songs.push(...added); detail.total = result.playlist.total || detail.total; detail.complete = !added.length || detail.songs.length >= detail.total;
  appendSongRows(elements.content.querySelector('[data-song-list="true"]'), added, detail.songs, previousLength); updateLoadStatus(elements.content, detail, detail.songs.length); elements.content.scrollTop = scrollTop;
}
function renderPlaylistDetail(scrollTop = 0) { const detail = state.detail; clear(elements.content); const songs = detail?.songs || []; const header = makeDetailHeader(detail?.title || "歌单", "返回歌单", () => { state.detail = null; renderPlaylists(); }, songs.length ? () => playSong(songs, 0) : null); elements.content.append(header, renderSongs(songs, "歌单暂无歌曲")); const status = document.createElement("p"); status.className = "load-more"; status.textContent = detail.loadingMore ? "正在加载更多歌曲…" : detail.complete ? `已加载全部 ${songs.length} 首歌曲` : `已加载 ${songs.length} / ${detail.total} 首歌曲`; status.classList.toggle("loading", Boolean(detail.loadingMore)); elements.content.append(status); elements.content.scrollTop = scrollTop; bindContentScroll(() => { if (elements.content.scrollTop + elements.content.clientHeight >= elements.content.scrollHeight - 80) loadMorePlaylistSongs(); }); }

function makeSingerRow(singer) { const row = document.createElement("button"); row.className = "singer-row"; const cover = document.createElement("span"); cover.className = "cover"; setCover(cover, singer.cover); const info = document.createElement("span"); info.className = "singer-info"; const title = document.createElement("strong"); title.textContent = singer.name; const sub = document.createElement("span"); sub.textContent = "歌手"; info.append(title, sub); row.append(cover, info); row.addEventListener("click", () => openSinger(singer)); return row; }
function makeAlbumRow(album) { const row = document.createElement("button"); row.className = "album-row"; const cover = document.createElement("span"); cover.className = "cover"; setCover(cover, album.cover); const info = document.createElement("span"); info.className = "album-info"; const title = document.createElement("strong"); title.textContent = album.name; const sub = document.createElement("span"); sub.textContent = album.artist ? `专辑 · ${album.artist}` : "专辑"; info.append(title, sub); row.append(cover, info); row.addEventListener("click", () => openAlbum(album)); return row; }
async function openSinger(singer) { showNotice("正在加载歌手歌曲…", "info"); const result = await message(MessageType.GET_SINGER_SONGS, { singer, begin: 0, limit: 50 }); if (!result.ok) { showError(result, "歌手歌曲加载失败"); return; } showNotice(); state.singerDetail = { ...result.singer, loadingMore: false, complete: !result.singer.songs.length || result.singer.songs.length >= result.singer.total }; renderSingerDetail(); }
async function loadMoreSingerSongs() { const detail = state.singerDetail; if (!detail || detail.loadingMore || detail.complete) return; const scrollTop = elements.content.scrollTop; detail.loadingMore = true; renderSingerDetail(scrollTop); const result = await message(MessageType.GET_SINGER_SONGS, { singer: detail.singer, begin: detail.songs.length, limit: 50 }); detail.loadingMore = false; if (!result.ok) { showError(result, "加载更多歌曲失败"); renderSingerDetail(scrollTop); return; } const previousLength = detail.songs.length; const known = new Set(detail.songs.map((song) => String(song.id))); const added = uniqueSongs(result.singer.songs || []).filter((song) => !known.has(String(song.id))); detail.songs.push(...added); detail.total = result.singer.total || detail.total; detail.complete = !added.length || detail.songs.length >= detail.total; appendSongRows(elements.content.querySelector('[data-song-list="true"]'), added, detail.songs, previousLength); updateLoadStatus(elements.content, detail, detail.songs.length); elements.content.scrollTop = scrollTop; }
function renderSingerDetail(scrollTop = 0) { const detail = state.singerDetail; clear(elements.content); const header = makeDetailHeader(detail.title, "返回搜索结果", () => { state.singerDetail = null; renderSearch(); }, detail.songs.length ? () => playSong(detail.songs, 0) : null); elements.content.append(header, renderSongs(detail.songs, "该歌手暂无歌曲")); const status = document.createElement("p"); status.className = "load-more"; status.textContent = detail.loadingMore ? "正在加载更多歌曲…" : detail.complete ? `已加载全部 ${detail.songs.length} 首歌曲` : `已加载 ${detail.songs.length} / ${detail.total} 首歌曲`; status.classList.toggle("loading", Boolean(detail.loadingMore)); elements.content.append(status); elements.content.scrollTop = scrollTop; bindContentScroll(() => { if (elements.content.scrollTop + elements.content.clientHeight >= elements.content.scrollHeight - 80) loadMoreSingerSongs(); }); }
async function openAlbum(album) { showNotice("正在加载专辑…", "info"); const result = await message(MessageType.GET_ALBUM_SONGS, { album, begin: 0, limit: 50 }); if (!result.ok) { showError(result, "专辑歌曲加载失败"); return; } showNotice(); state.albumDetail = { ...result.album, loadingMore: false, complete: !result.album.songs.length || result.album.songs.length >= result.album.total }; renderAlbumDetail(); }
async function loadMoreAlbumSongs() { const detail = state.albumDetail; if (!detail || detail.loadingMore || detail.complete) return; const scrollTop = elements.content.scrollTop; detail.loadingMore = true; renderAlbumDetail(scrollTop); const result = await message(MessageType.GET_ALBUM_SONGS, { album: detail.album, begin: detail.songs.length, limit: 50 }); detail.loadingMore = false; if (!result.ok) { showError(result, "加载更多歌曲失败"); renderAlbumDetail(scrollTop); return; } const previousLength = detail.songs.length; const known = new Set(detail.songs.map((song) => String(song.id))); const added = uniqueSongs(result.album.songs || []).filter((song) => !known.has(String(song.id))); detail.songs.push(...added); detail.total = result.album.total || detail.total; detail.complete = !added.length || detail.songs.length >= detail.total; appendSongRows(elements.content.querySelector('[data-song-list="true"]'), added, detail.songs, previousLength); updateLoadStatus(elements.content, detail, detail.songs.length); elements.content.scrollTop = scrollTop; }
function renderAlbumDetail(scrollTop = 0) { const detail = state.albumDetail; clear(elements.content); const header = makeDetailHeader(detail.title || "专辑", "返回搜索结果", () => { state.albumDetail = null; renderSearch(); }, detail.songs.length ? () => playSong(detail.songs, 0) : null); elements.content.append(header, renderSongs(detail.songs, "该专辑暂无歌曲")); const status = document.createElement("p"); status.className = "load-more"; status.textContent = detail.loadingMore ? "正在加载更多歌曲…" : detail.complete ? `已加载全部 ${detail.songs.length} 首歌曲` : `已加载 ${detail.songs.length} / ${detail.total} 首歌曲`; status.classList.toggle("loading", Boolean(detail.loadingMore)); elements.content.append(status); elements.content.scrollTop = scrollTop; bindContentScroll(() => { if (elements.content.scrollTop + elements.content.clientHeight >= elements.content.scrollHeight - 80) loadMoreAlbumSongs(); }); }

function renderSearch(scrollTop = 0) {
  clear(elements.content); const form = document.createElement("form"); form.className = "search-form"; const input = document.createElement("input"); input.placeholder = "搜索歌曲、歌手或专辑"; input.value = state.searchKeyword; input.setAttribute("aria-label", "搜索歌曲、歌手或专辑"); const submit = document.createElement("button"); submit.textContent = "搜索"; form.append(input, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); const keyword = input.value.trim(); if (!keyword) return;
    const requestId = ++state.searchRequestId; showNotice("正在搜索…", "info");
    await new Promise((resolve) => setTimeout(resolve, 220));
    if (requestId !== state.searchRequestId) return;
    const cached = state.searchCache.get(keyword);
    if (cached) { state.searchKeyword = keyword; state.searchResults = [...cached.songs]; state.singerResults = [...cached.singers]; state.albumResults = [...cached.albums]; state.searchPaging = cached.searchPaging ? { ...cached.searchPaging, loadingMore: false } : null; showNotice(); renderSearch(); return; }
    const result = await message(MessageType.SEARCH_SONGS, { keyword });
    if (requestId !== state.searchRequestId) return;
    if (!result.ok) { showError(result, "搜索失败"); return; }
    const songs = uniqueSongs(result.songs || []); const singers = result.singers || []; const albums = result.albums || [];
    const searchPaging = { loadingMore: false, total: result.total || 0, offset: songs.length, limit: 30, complete: !songs.length || songs.length >= (result.total || songs.length) };
    state.searchCache.set(keyword, { songs, singers, albums, searchPaging }); if (state.searchCache.size > 12) state.searchCache.delete(state.searchCache.keys().next().value);
    showNotice(); state.searchKeyword = keyword; state.searchResults = songs; state.singerResults = singers; state.albumResults = albums; state.searchPaging = searchPaging; renderSearch();
  });
  elements.content.append(form);
  if (!state.searchKeyword) { elements.content.append(renderSongs([], "输入关键词搜索歌曲、歌手或专辑")); return; }
  if (state.singerResults.length) { const section = document.createElement("section"); const heading = document.createElement("h2"); heading.className = "result-section-title"; heading.textContent = "歌手"; const list = document.createElement("div"); list.className = "list"; state.singerResults.forEach((singer) => list.append(makeSingerRow(singer))); section.append(heading, list); elements.content.append(section); }
  if (state.albumResults.length) { const section = document.createElement("section"); const heading = document.createElement("h2"); heading.className = "result-section-title"; heading.textContent = "专辑"; const list = document.createElement("div"); list.className = "list"; state.albumResults.forEach((album) => list.append(makeAlbumRow(album))); section.append(heading, list); elements.content.append(section); }
  const songSection = document.createElement("section"); const heading = document.createElement("h2"); heading.className = "result-section-title"; heading.textContent = "歌曲"; songSection.append(heading, renderSongs(state.searchResults, "没有找到相关歌曲"));
  if (state.searchPaging) { const status = document.createElement("p"); status.className = "load-more"; status.textContent = state.searchPaging.loadingMore ? "正在加载更多歌曲…" : state.searchPaging.complete ? `已加载全部 ${state.searchResults.length} 首歌曲` : `已加载 ${state.searchResults.length} / ${state.searchPaging.total} 首歌曲`; status.classList.toggle("loading", Boolean(state.searchPaging.loadingMore)); songSection.append(status); }
  elements.content.append(songSection); elements.content.scrollTop = scrollTop;
  if (state.searchPaging && !state.searchPaging.complete) bindContentScroll(() => { if (elements.content.scrollTop + elements.content.clientHeight >= elements.content.scrollHeight - 80) loadMoreSearchSongs(); });
}
async function loadMoreSearchSongs() {
  const paging = state.searchPaging; if (!paging || paging.loadingMore || paging.complete) return;
  const scrollTop = elements.content.scrollTop; paging.loadingMore = true; renderSearch(scrollTop);
  const result = await message(MessageType.SEARCH_SONGS, { keyword: state.searchKeyword, offset: state.searchResults.length, limit: paging.limit || 30 }); paging.loadingMore = false;
  if (!result.ok) { showError(result, "加载更多歌曲失败"); renderSearch(scrollTop); return; }
  const previousLength = state.searchResults.length; const known = new Set(state.searchResults.map((song) => String(song.id))); const added = uniqueSongs(result.songs || []).filter((song) => !known.has(String(song.id)));
  state.searchResults.push(...added); paging.total = result.total || paging.total; paging.complete = !added.length || state.searchResults.length >= paging.total; paging.offset = state.searchResults.length; const cached = state.searchCache.get(state.searchKeyword); if (cached) cached.songs = [...state.searchResults];
  appendSongRows(elements.content.querySelector('[data-song-list="true"]'), added, state.searchResults, previousLength); updateLoadStatus(elements.content, paging, state.searchResults.length); elements.content.scrollTop = scrollTop;
}
function renderTab() { document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.tab)); if (state.tab === "liked") renderLiked(); if (state.tab === "playlists") renderPlaylists(); if (state.tab === "charts") renderToplists(); if (state.tab === "search") renderSearch(); }
async function loadLibrary() { const result = await message(MessageType.GET_LIBRARY); if (!result.ok) { if (result.error !== "LOGIN_EXPIRED") throw result; state.library = { user: null, liked: [], likedTotal: 0, playlists: [] }; state.likedPaging = null; renderAccount(null); renderTab(); showNotice("未登录，可浏览榜单和搜索；登录后查看我喜欢与歌单", "info", 4500); return false; } state.library = result.library; const likedTotal = Number(state.library?.likedTotal || 0); state.likedPaging = { loadingMore: false, total: likedTotal, complete: !likedTotal || (state.library.liked?.length || 0) >= likedTotal }; renderAccount(state.library?.user); renderTab(); return true; }
async function loadToplists() { showNotice("正在加载排行榜…", "info"); const result = await message(MessageType.GET_TOPLISTS); if (!result.ok) { showError(result, "排行榜加载失败"); return; } state.toplists = result.toplists || []; showNotice(); if (state.tab === "charts") renderToplists(); }
async function startWebLogin() { state.viewRequestId += 1; showLoginView(); showNotice("正在打开网易云官方登录页…", "info"); elements.qr.hidden = false; elements.qrImage.hidden = true; elements.qrStatus.textContent = "请在新打开的网易云官方页面完成登录，登录成功后回到这里。"; const result = await message(MessageType.LOGIN_WEB_START); if (!result.ok) { showError(result, "无法打开官方登录页"); return; } clearInterval(state.poll); state.poll = setInterval(checkLogin, 2500); }
async function startLogin() { await startWebLogin(); }
async function checkLogin() { const result = await message(MessageType.LOGIN_STATUS); if (!result.ok) { clearInterval(state.poll); showError(result, "登录失败，请重新尝试"); return; } if (result.status === "waiting") return; if (result.status === "scanned") { elements.qrStatus.textContent = "已扫码，请在手机上确认"; return; } if (result.status === "expired") { clearInterval(state.poll); elements.qrStatus.textContent = "二维码已失效，请重新获取"; return; } if (result.status === "done") { clearInterval(state.poll); const requestId = ++state.viewRequestId; showMusicView(); renderStartupSkeleton(); try { await loadLibrary(); state.toplists = null; await loadToplists(); if (requestId === state.viewRequestId) { showMusicView(); renderTab(); } } catch (error) { if (requestId === state.viewRequestId) showError(error, "曲库加载失败"); } } }
document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => { state.searchRequestId += 1; state.tab = button.dataset.tab; state.detail = null; state.chartDetail = null; state.chartPaging = null; state.singerDetail = null; state.albumDetail = null; showNotice(); renderTab(); if (state.tab === "charts" && state.toplists === null) loadToplists(); }));
document.querySelector("#login-button").addEventListener("click", startLogin); document.querySelector("#retry-login").addEventListener("click", startLogin); elements.webLogin.addEventListener("click", startWebLogin);
elements.account.addEventListener("click", () => { if (!state.library?.user?.userId) { startLogin(); return; } const open = elements.accountMenu.hidden; elements.accountMenu.hidden = !open; elements.account.setAttribute("aria-expanded", String(open)); });
elements.diagnostic.addEventListener("click", copyDiagnostic);
elements.logout.addEventListener("click", async () => { const result = await message(MessageType.LOGOUT); if (!result?.ok) { showError(result, "退出登录失败"); return; } clearInterval(state.poll); state.searchRequestId += 1; state.library = null; state.likedPaging = null; state.toplists = null; state.detail = null; state.chartDetail = null; state.chartPaging = null; state.singerDetail = null; state.albumDetail = null; state.searchKeyword = ""; state.searchResults = []; state.singerResults = []; state.albumResults = []; state.searchPaging = null; state.searchCache.clear(); clear(elements.content); elements.qr.hidden = true; renderPlayer(result.state); showNotice(); showLoginView(); });
document.addEventListener("click", (event) => { if (!elements.accountWrap.hidden && !elements.accountWrap.contains(event.target)) closeAccountMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeAccountMenu(); });
document.querySelectorAll("[data-control]").forEach((button) => button.addEventListener("click", async () => { const action = button.dataset.control; const type = action === "previous" ? MessageType.PREVIOUS : action === "next" ? MessageType.NEXT : state.player?.playing ? MessageType.PAUSE : MessageType.PLAY; const result = await message(type); if (!result?.ok) showError(result, "播放操作失败"); }));
elements.mode.addEventListener("click", async () => { const currentIndex = Math.max(0, playbackModes.findIndex((item) => item.value === state.player?.playMode)); const nextMode = playbackModes[(currentIndex + 1) % playbackModes.length]; const result = await message(MessageType.SET_PLAY_MODE, { mode: nextMode.value }); if (!result?.ok) { showError(result, "无法切换播放模式"); return; } renderPlayer(result.state); });
elements.progress.addEventListener("input", () => { state.seeking = true; const currentTime = Number(elements.progress.value) || 0; elements.currentTime.textContent = formatTime(currentTime); const duration = Number(elements.progress.max) || 0; elements.progress.style.setProperty("--progress", duration > 0 ? `${currentTime / duration * 100}%` : "0%"); });
elements.progress.addEventListener("change", async () => { const result = await message(MessageType.SEEK, { position: Number(elements.progress.value) || 0 }); state.seeking = false; if (!result?.ok) { showError(result, "暂时无法调整播放进度"); renderPlayer(state.player); return; } renderPlayer({ ...state.player, currentTime: result.currentTime, duration: result.duration }); });
elements.brand.innerHTML = icon("music3Fill"); document.querySelector('[data-control="previous"]').innerHTML = icon("previous"); document.querySelector('[data-control="next"]').innerHTML = icon("next");
chrome.runtime.onMessage.addListener((message) => { if (message.type === MessageType.PLAYER_STATE_CHANGED) renderPlayer(message.state); });
(async () => { const player = await message(MessageType.GET_PLAYER_STATE); renderPlayer(player.state); const restoredSong = Boolean(player.state?.currentSong); const requestId = ++state.viewRequestId; showMusicView(); renderStartupSkeleton(); try { await loadLibrary(); await loadToplists(); if (requestId === state.viewRequestId) { showMusicView(); renderTab(); if (restoredSong && !player.state.playing) showNotice("已恢复上次播放状态，点击播放继续", "info", 3500); } } catch (error) { if (requestId === state.viewRequestId) showError(error, "曲库加载失败"); } })();
