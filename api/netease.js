import { ErrorCode } from "./types.js";
import { weapi } from "./crypto.js";

const BASE = "https://music.163.com";
const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 播放地址返回码：非 200 即不可播（版权/付费/无权限），需跳过。
const PLAY_OK = 200;

export class NeteaseError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

async function weapiPost(path, body, credential = null) {
  const merged = { ...body, csrf_token: credential?.csrf || "" };
  const { params, encSecKey } = await weapi(merged);
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": WEB_UA,
        "referer": `${BASE}/`
      },
      body: new URLSearchParams({ params, encSecKey }).toString()
    });
  } catch (error) {
    console.error("Netease request failed", error);
    throw new NeteaseError(ErrorCode.NETWORK, "网络请求失败");
  }
  if (!response.ok) {
    console.error("Netease HTTP error", response.status);
    throw new NeteaseError(ErrorCode.NETWORK, "网络请求失败", { status: response.status });
  }
  return response.json();
}

// 把网易云歌曲对象规整成播放器统一结构。
function normalizeSong(raw) {
  return {
    id: raw.id,
    title: raw.name || "",
    artist: (raw.ar || raw.artists || []).map((a) => a.name).join(" / "),
    album: raw.al?.name || raw.album?.name || "",
    cover: raw.al?.picUrl || raw.album?.picUrl || "",
    duration: raw.dt || raw.duration || 0,
    fee: raw.fee
  };
}

function normalizeArtist(raw = {}) {
  return {
    id: raw.id,
    name: raw.name || "未知歌手",
    cover: String(raw.picUrl || raw.img1v1Url || "").replace(/^http:/, "https:")
  };
}

function normalizeAlbum(raw = {}) {
  const artist = raw.artist || {};
  return {
    id: raw.id,
    name: raw.name || "未命名专辑",
    artist: artist.name || (raw.artists || []).map((item) => item.name).filter(Boolean).join(" / "),
    cover: String(raw.picUrl || raw.blurPicUrl || "").replace(/^http:/, "https:"),
    publishDate: raw.publishTime ? new Date(raw.publishTime).toLocaleDateString("zh-CN") : ""
  };
}

async function searchType(keyword, type, credential, offset = 0, limit = 30) {
  return weapiPost("/weapi/search/get", { s: keyword, type, offset, limit, total: true }, credential);
}

async function resolveTrackIds(trackIds, credential = null) {
  const ids = (trackIds || []).map((item) => typeof item === "object" ? item.id : item).filter(Boolean);
  const songs = [];
  for (let start = 0; start < ids.length; start += 500) {
    const detail = await getSongDetail(ids.slice(start, start + 500), credential);
    songs.push(...detail.songs);
  }
  return songs;
}

/**
 * 搜索歌曲。返回 { songs, total }，遵循网易云接口原始顺序。
 *
 * 搜索接口返回的 album 只含 picId 不含 picUrl，封面为空；这里用
 * song/detail 批量补全封面后再返回。
 */
export async function searchSongs(keyword, credential = null, offset = 0, limit = 30) {
  const data = await searchType(keyword, 1, credential, offset, limit);
  let songs = (data.result?.songs || []).map(normalizeSong);
  const total = data.result?.songCount || songs.length;
  // 补全缺失封面：仅对没有 cover 的歌曲做一次批量详情查询。
  const missing = songs.filter((song) => !song.cover).map((song) => song.id);
  if (missing.length) {
    try {
      const detail = await getSongDetail(missing, credential);
      const byId = new Map(detail.songs.map((song) => [song.id, song.cover]));
      songs = songs.map((song) => song.cover ? song : { ...song, cover: byId.get(song.id) || "" });
    } catch (error) {
      // 补封面失败不阻断搜索，列表以音符占位展示。
      console.warn("Search cover backfill failed", error);
    }
  }
  let singers = [];
  let albums = [];
  if (offset === 0) {
    const [artistData, albumData] = await Promise.all([
      searchType(keyword, 100, credential, 0, 10).catch(() => null),
      searchType(keyword, 10, credential, 0, 10).catch(() => null)
    ]);
    singers = (artistData?.result?.artists || []).map(normalizeArtist);
    albums = (albumData?.result?.albums || []).map(normalizeAlbum);
  }
  return { songs, total, singers, albums, searchPaging: { total, offset, limit } };
}

/**
 * 榜单列表。返回 { toplists: [{ id, name, cover }] }。
 */
export async function getToplists() {
  const data = await weapiPost("/weapi/toplist", {}, null);
  const list = data.list || [];
  return {
    toplists: list.map((item) => ({
      id: item.id,
      name: item.name || "",
      cover: item.coverImgUrl || ""
    }))
  };
}

/**
 * 榜单详情。返回 { toplist: { id, name, cover, tracks } }。
 */
export async function getToplistDetail(toplist, credential = null) {
  const data = await weapiPost("/weapi/v3/playlist/detail", {
    id: String(toplist.id),
    n: 100000,
    s: 8
  }, credential);
  const playlist = data.playlist || {};
  return {
    toplist: {
      id: playlist.id,
      name: playlist.name || "",
      cover: playlist.coverImgUrl || "",
      tracks: (playlist.tracks || []).map(normalizeSong)
    }
  };
}

/**
 * 歌曲详情（补封面等缺失字段）。返回 { songs }。
 */
export async function getSongDetail(ids, credential = null) {
  const idList = Array.isArray(ids) ? ids : [ids];
  const data = await weapiPost("/weapi/v3/song/detail", {
    c: JSON.stringify(idList.map((id) => ({ id })))
  }, credential);
  return {
    songs: (data.songs || []).map(normalizeSong)
  };
}

export async function getUserLibrary(credential) {
  const accountData = await weapiPost("/weapi/nuser/account/get", {}, credential);
  if (accountData.code !== 200 || !accountData.account?.id) {
    throw new NeteaseError(ErrorCode.LOGIN_EXPIRED, "网易云音乐登录已失效，请重新登录", { code: accountData.code });
  }
  const uid = accountData.account.id;
  const profile = accountData.profile || {};
  const playlistData = await weapiPost("/weapi/user/playlist", { uid, limit: 100, offset: 0 }, credential);
  const playlists = (playlistData.playlist || []).map((item) => ({
    id: item.id,
    title: item.name || "未命名歌单",
    cover: String(item.coverImgUrl || "").replace(/^http:/, "https:"),
    count: Number(item.trackCount || item.trackIds?.length || 0),
    specialType: item.specialType || 0
  }));
  let liked = [];
  let likedTotal = 0;
  try { const likedResult = await getLikedSongs(credential, 0, 50); liked = likedResult.songs; likedTotal = likedResult.total; } catch (error) { console.warn("Liked songs load failed", error); }
  return {
    user: { userId: uid, nickname: profile.nickname || "网易云音乐账号", avatarUrl: profile.avatarUrl || "" },
    liked,
    likedTotal,
    playlists: playlists.filter((item) => item.specialType !== 5)
  };
}

export async function getLikedSongs(credential, begin = 0, limit = 50) {
  const account = await weapiPost("/weapi/nuser/account/get", {}, credential);
  const uid = account.account?.id;
  if (!uid) throw new NeteaseError(ErrorCode.LOGIN_EXPIRED, "网易云音乐登录已失效，请重新登录", { code: account.code });
  const data = await weapiPost("/weapi/song/like/get", { uid }, credential);
  if (data.code !== 200 || !Array.isArray(data.ids)) throw new NeteaseError(ErrorCode.LOGIN_EXPIRED, "我喜欢列表读取失败", { code: data.code });
  const ids = data.ids.slice(Math.max(0, Number(begin) || 0), Math.max(0, Number(begin) || 0) + limit);
  return { songs: await resolveTrackIds(ids, credential), total: data.ids.length };
}

export async function getPlaylistSongs(playlist, credential, begin = 0, limit = 100) {
  const data = await weapiPost("/weapi/v3/playlist/detail", {
    id: String(playlist.id), n: limit, offset: Math.max(0, Number(begin) || 0), limit, s: 8
  }, credential);
  const source = data.playlist || {};
  const start = Math.max(0, Number(begin) || 0);
  const trackIds = source.trackIds || [];
  const songs = trackIds.length
    ? await resolveTrackIds(trackIds.slice(start, start + limit), credential)
    : (source.tracks || []).slice(start, start + limit).map(normalizeSong);
  return {
    id: source.id || playlist.id,
    title: source.name || playlist.title || "未命名歌单",
    cover: String(source.coverImgUrl || playlist.cover || "").replace(/^http:/, "https:"),
    songs,
    total: Number(source.trackCount || source.trackIds?.length || songs.length)
  };
}

export async function getSingerSongs(singer, credential = null, begin = 0, limit = 50) {
  const data = await weapiPost("/weapi/v1/artist/songs", { id: String(singer.id), offset: begin, limit, total: true }, credential);
  return {
    title: singer.name,
    singer,
    songs: (data.songs || []).map(normalizeSong),
    total: Number(data.total || data.songCount || (data.more ? begin + limit + 1 : (data.songs || []).length))
  };
}

export async function getAlbumSongs(album, credential = null, begin = 0, limit = 50) {
  const data = await weapiPost(`/weapi/v1/album/${album.id}`, {}, credential);
  const allSongs = (data.songs || []).map(normalizeSong);
  return { album, title: album.name, songs: allSongs.slice(begin, begin + limit), total: allSongs.length };
}

/**
 * 播放地址。无版权/付费返回 null（code 非 200）。
 * @returns {Promise<string|null>}
 */
export async function getPlayUrl(song, credential = null) {
  const data = await weapiPost("/weapi/song/enhance/player/url/v1", {
    ids: `[${song.id}]`,
    level: "standard",
    encodeType: "aac"
  }, credential);
  const item = data.data?.[0];
  if (!item || item.code !== PLAY_OK || !item.url) {
    return null;
  }
  // 网易云返回的直链常是 http，统一升 https 以避免扩展混合内容拦截。
  return item.url.replace(/^http:/, "https:");
}

/**
 * 校验登录态是否仍有效（用登录信息访问一次需要凭证的接口）。
 * 网易云的 MUSIC_U cookie 由浏览器托管，这里主要探测接口能否正常响应。
 */
export async function validateCredential(credential) {
  try {
    // 访问「每日推荐」等需要登录的接口，能返回 200 结构即视为有效。
    const data = await weapiPost("/weapi/v1/discovery/recommend/songs", {}, credential);
    return typeof data.code === "number" ? data.code === 200 : true;
  } catch (error) {
    return null; // 无法判定，交由调用方按网络错误处理
  }
}
