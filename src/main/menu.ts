import { Menu } from 'electron'

/**
 * The app doesn't use a traditional menu bar (autoHideMenuBar hides it on
 * Windows/Linux) and ships its own in-app keyboard shortcut system
 * (Settings > Shortcuts, user-customizable) that needs full control of
 * whatever keys it binds. Electron auto-generates a default menu with its
 * own accelerators (Close Window = CmdOrCtrl+W, Reload, etc.) whenever none
 * is set — those sit invisibly in the background and, because native
 * accelerators are matched before an event ever reaches the renderer, can
 * silently eat a combo a user rebinds to (e.g. the very natural choice of
 * plain Ctrl+W for "close terminal") with no visible menu to explain why.
 *
 * On macOS the menu bar can't be hidden at all, and removing the app menu
 * entirely would also remove the Cmd+Q quit convention users rely on — so a
 * minimal app-menu-only template is kept there instead of nulling it out.
 * Only applied in production; dev keeps the default menu (Reload/DevTools)
 * for the same reason security.ts's CSP is prod-only.
 */
export function configureApplicationMenu(): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }]))
  } else {
    Menu.setApplicationMenu(null)
  }
}
