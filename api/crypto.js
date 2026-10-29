// 网易云音乐 weapi 请求加密，零依赖，仅用 Web Crypto API + BigInt。
//
// weapi：双层 AES-128-CBC（key1 固定 + key2 随机），再把随机 key2 用裸 RSA
// 无填充加密（m^e mod n）得到 encSecKey。用于登录、播放地址等 v3 接口。
//
// 关键点：Web Crypto 的 RSA 只支持 PKCS1v1.5 / OAEP，不支持网易云用的
// 无填充（NO_PADDING），因此 encSecKey 用 BigInt 手工做模幂实现。

const PRESET_KEY = "0CoJUm6Qyw8W8jud";
const IV = "0102030405060708";
const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// RSA 公钥参数（1024 位）。e = 65537，n 为网易云固定的模数。
const RSA_EXPONENT = 0x010001n;
const RSA_MODULUS = BigInt(
  "0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725" +
  "152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312" +
  "ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424" +
  "d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7"
);

const encoder = new TextEncoder();

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(start + chunk, bytes.length)));
  }
  return btoa(binary);
}

function stringToBytes(value) {
  return encoder.encode(value);
}

// AES-CBC（PKCS7 由 Web Crypto 自动补全）。
async function aesCbcEncrypt(text, key) {
  const data = stringToBytes(text);
  const keyBytes = stringToBytes(key);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: stringToBytes(IV) },
    cryptoKey,
    data
  );
  return new Uint8Array(encrypted);
}

function generateSecretKey() {
  const random = crypto.getRandomValues(new Uint8Array(16));
  let result = "";
  for (const byte of random) result += BASE62[byte % BASE62.length];
  return result;
}

// 裸 RSA 无填充加密：secretKey 反转 → 补零到 128 字节 → 大整数 → m^e mod n → hex。
function rsaEncrypt(secretKey) {
  const reversed = secretKey.split("").reverse().join("");
  const padded = reversed.padStart(128, "\0");
  const bytes = stringToBytes(padded);
  let m = 0n;
  for (const byte of bytes) m = (m << 8n) | BigInt(byte);
  m %= RSA_MODULUS;

  let result = 1n;
  let base = m;
  let exponent = RSA_EXPONENT;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % RSA_MODULUS;
    base = (base * base) % RSA_MODULUS;
    exponent >>= 1n;
  }
  return result.toString(16).padStart(256, "0");
}

/**
 * weapi 加密。
 * @param {object} object 明文对象
 * @returns {Promise<{params: string, encSecKey: string}>}
 */
export async function weapi(object) {
  const text = JSON.stringify(object);
  const secretKey = generateSecretKey();
  const firstPass = await aesCbcEncrypt(text, PRESET_KEY);
  const secondPass = await aesCbcEncrypt(bytesToBase64(firstPass), secretKey);
  const params = bytesToBase64(secondPass);
  const encSecKey = rsaEncrypt(secretKey);
  return { params, encSecKey };
}

