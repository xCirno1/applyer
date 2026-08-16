import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { resumeGate, cancelGate, getGatePage } from '../browser/captchaGate'
import { detectCaptcha } from '../browser/captchaDetector'

export function registerBrowserControlIpc(): void {
  ipcMain.handle(IPC.browserControl.resumeTask, async (_event, { taskId }: { taskId: string }) => {
    const page = getGatePage(taskId)
    if (!page) {
      return { ok: false, error: 'This task is no longer waiting — it may have already resolved or timed out.' }
    }

    const check = await detectCaptcha(page).catch(() => ({ blocked: true }))
    if (check.blocked) {
      return {
        ok: false,
        error: 'The verification challenge still looks unresolved — finish it in the browser window, then try again.'
      }
    }

    resumeGate(taskId)
    return { ok: true }
  })

  ipcMain.handle(IPC.browserControl.cancelTask, (_event, { taskId }: { taskId: string }) => {
    return { ok: cancelGate(taskId) }
  })
}
