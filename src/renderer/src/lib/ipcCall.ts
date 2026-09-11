/**
 * Calling across the preload bridge without leaving the UI stuck.
 *
 * Every `window.api.*` call is an `ipcRenderer.invoke`, which rejects if the
 * handler on the other side throws. That is not hypothetical: `profile.get`
 * reads fields through `readSecureField`, which throws by design when the OS
 * keyring is unavailable — the one case the app has a carefully worded message
 * for. Unhandled, the rejection skipped the `set({ loading: false })` after it
 * and the user got a skeleton that never resolved, plus an unhandled rejection
 * in the console.
 *
 * So a rejected call becomes a value instead. For a read, the fallback is the
 * empty result, and the caller renders its ordinary empty state. For a
 * mutation, it is that call's own failure shape (`{ ok: false }`), which every
 * caller already handles — usually with a toast — so a bridge failure surfaces
 * exactly like a refused request rather than as a distinct new path.
 */
export async function callIpc<T>(context: string, call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call()
  } catch (err) {
    // Console rather than a toast: this is the shared helper, and the caller
    // is the one that knows whether the user asked for this (a click, worth
    // telling them about) or the app did (a background refresh, not worth
    // interrupting for). Main-process failures are already in app.log.
    console.error(`IPC call failed: ${context}`, err)
    return fallback
  }
}
