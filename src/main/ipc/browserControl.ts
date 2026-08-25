import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError } from '@shared/types/errorCodes'
import { resumeGate, cancelGate, getGatePage } from '../browser/captchaGate'
import { detectCaptcha } from '../browser/captchaDetector'

export function registerBrowserControlIpc(): void {
  ipcMain.handle(IPC.browserControl.resumeTask, async (_event, { taskId }: { taskId: string }) => {
    const page = getGatePage(taskId)
    if (!page) {
      return { ok: false, error: appError('taskNotWaiting') }
    }

    const check = await detectCaptcha(page).catch(() => ({ blocked: true }))
    if (check.blocked) {
      return {
        ok: false,
        error: appError('captchaUnresolved')
      }
    }

    resumeGate(taskId)
    return { ok: true }
  })

  ipcMain.handle(IPC.browserControl.cancelTask, (_event, { taskId }: { taskId: string }) => {
    return { ok: cancelGate(taskId) }
  })
}
