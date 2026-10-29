import { NeteaseError } from "./netease.js";
import { ErrorCode } from "./types.js";
import { weapi } from "./crypto.js";

const BASE = "https://music.163.com";
const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// 二维码内容前缀：网易云 App 扫到含 codekey 的登录链接后完成扫码确认。
const QR_CODEKEY_PREFIX = "https://music.163.com/login?codekey=";
// 外部二维码图片服务（零本地依赖）。
const QR_IMAGE_API = "https://api.qrserver.com/v1/create-qr-code";
const SESSION_COOKIE_NAMES = ["MUSIC_U", "MUSIC_A", "__csrf", "NMTID", "ntes_nnid", "ntes_kaola_ad"];

async function weapiPost(path, body) {
  const { params, encSecKey } = await weapi(body);
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
    console.error("Netease login request failed", error);
    throw new NeteaseError(ErrorCode.NETWORK, "网络请求失败");
  }
  if (!response.ok) {
    console.error("Netease login HTTP error", response.status);
    throw new NeteaseError(ErrorCode.NETWORK, "网络请求失败", { status: response.status });
  }
  try {
    return await response.json();
  } catch (error) {
    console.error("Netease login response parse failed", error);
    throw new NeteaseError(ErrorCode.NETWORK, "网易云登录接口返回了无效响应");
  }
}

async function readSessionCredential() {
  let csrf = "";
  try {
    csrf = (await chrome.cookies.get({ url: `${BASE}/`, name: "__csrf" }))?.value || "";
  } catch (error) {
    console.warn("Netease csrf cookie read failed", error);
  }
  return { csrf, loginAt: Date.now() };
}

/** 读取官方网页登录完成后由 music.163.com 写入的会话。 */
export async function getBrowserCredential() {
  try {
    const musicCookie = await chrome.cookies.get({ url: `${BASE}/`, name: "MUSIC_U" });
    return musicCookie?.value ? readSessionCredential() : null;
  } catch (error) {
    console.warn("Netease session cookie read failed", error);
    return null;
  }
}

/**
 * 发起扫码登录：拿 unikey，生成二维码图片 data URL。
 * @returns {Promise<{unikey: string, imageUrl: string}>}
 */
export async function createQrLogin() {
  // 二维码接口要求显式跳过网页 csrf 校验；扫码 key 本身是一次性短期凭证。
  const data = await weapiPost("/weapi/login/qrcode/unikey", { type: 1, noCheckToken: true });
  if (data.code !== 200 || !data.unikey) {
    console.error("Netease unikey rejected", data);
    throw new NeteaseError(ErrorCode.NETWORK, "二维码登录初始化失败，请重试");
  }
  const unikey = data.unikey;
  const content = encodeURIComponent(`${QR_CODEKEY_PREFIX}${unikey}`);
  const imageUrl = `${QR_IMAGE_API}?size=200x200&data=${content}`;
  return { unikey, imageUrl };
}

/**
 * 轮询扫码结果。
 * @returns {Promise<{status: "waiting"|"scanned"|"expired"|"done", credential?: object}>}
 */
export async function pollQrLogin(unikey) {
  const data = await weapiPost("/weapi/login/qrcode/client/login", { key: unikey, type: 1, noCheckToken: true });
  const code = Number(data.code);
  // 网易云二维码登录状态：801 未扫码，800 已扫码待确认，802 已过期，803 登录成功。
  if (code === 801) return { status: "waiting" };
  if (code === 800) return { status: "scanned" };
  if (code === 802) return { status: "expired" };
  if (code === 803) {
    // 登录成功：cookie（MUSIC_U 等）已由浏览器写入 music.163.com 域。
    return { status: "done", credential: await readSessionCredential() };
  }
  // 部分网关在确认后先返回 502，但浏览器已经完成 MUSIC_U Cookie 写入。
  // 只在确认存在新会话 Cookie 时视为成功，避免把真正的网关错误吞掉。
  if (code === 502) {
    try {
      const musicCookie = await chrome.cookies.get({ url: `${BASE}/`, name: "MUSIC_U" });
      if (musicCookie?.value) return { status: "done", credential: await readSessionCredential() };
    } catch (error) {
      console.warn("Netease MUSIC_U cookie read failed", error);
    }
  }
  // 其他返回码视为登录失败。
  console.error("Netease login poll rejected", data);
  throw new NeteaseError(ErrorCode.NETWORK, "登录失败，请重新尝试", { code, message: data.message || "" });
}

/**
 * 清理扫码登录留下的网易云会话 Cookie。
 * local storage 中的 csrf 记录不是实际登录态，必须同时删除 MUSIC_U 等 Cookie。
 */
export async function clearNeteaseCookies() {
  if (!chrome.cookies?.get || !chrome.cookies?.remove) return;
  await Promise.all(SESSION_COOKIE_NAMES.map(async (name) => {
    try {
      const cookie = await chrome.cookies.get({ url: `${BASE}/`, name });
      if (!cookie) return;
      await chrome.cookies.remove({ url: `${BASE}${cookie.path || "/"}`, name, storeId: cookie.storeId });
    } catch (error) {
      console.warn(`Netease cookie cleanup failed: ${name}`, error);
    }
  }));
}
