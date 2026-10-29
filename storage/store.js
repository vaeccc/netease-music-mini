const KEYS = Object.freeze({
  CREDENTIAL: "credential",
  PLAYER_STATE: "playerState",
  SHUFFLE_HISTORY: "shuffleHistory",
  SHUFFLE_QUEUE_KEY: "shuffleQueueKey"
});

export async function getCredential() {
  const { [KEYS.CREDENTIAL]: credential } = await chrome.storage.local.get(KEYS.CREDENTIAL);
  return credential || null;
}

export async function setCredential(credential) {
  await chrome.storage.local.set({ [KEYS.CREDENTIAL]: credential });
}

export async function clearCredential() {
  await chrome.storage.local.remove(KEYS.CREDENTIAL);
}

export async function getPlayerState() {
  const { [KEYS.PLAYER_STATE]: state } = await chrome.storage.local.get(KEYS.PLAYER_STATE);
  return state || null;
}

export async function setPlayerState(state) {
  await chrome.storage.local.set({ [KEYS.PLAYER_STATE]: state });
}

export async function getShuffleState() {
  const { [KEYS.SHUFFLE_HISTORY]: history, [KEYS.SHUFFLE_QUEUE_KEY]: queueKey } = await chrome.storage.local.get([KEYS.SHUFFLE_HISTORY, KEYS.SHUFFLE_QUEUE_KEY]);
  return { history: Array.isArray(history) ? history : [], queueKey: typeof queueKey === "string" ? queueKey : "" };
}

export async function setShuffleState(history, queueKey) {
  await chrome.storage.local.set({ [KEYS.SHUFFLE_HISTORY]: history, [KEYS.SHUFFLE_QUEUE_KEY]: queueKey });
}

export async function clearShuffleState() {
  await chrome.storage.local.remove([KEYS.SHUFFLE_HISTORY, KEYS.SHUFFLE_QUEUE_KEY]);
}
