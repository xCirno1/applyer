import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError } from '@shared/types/errorCodes'
import { resumeGate, cancelGate, getGatePage } from '../browser/captchaGate'
import { detectCaptcha } from '../browser/captchaDetector'
import { taskIdPayload } from './payloadSchemas'

export function registerBrowserControlIpc(): void {
  ipcMain.handle(IPC.browserControl.resumeTask, async (_event, payload: unknown) => {
    const parsed = taskIdPayload.safeParse(payload)
    // No id, no task — the same answer as an id for a task that is not waiting.
    if (!parsed.success) return { ok: false, error: appError('taskNotWaiting') }

    const page = getGatePage(parsed.data.taskId)
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

    resumeGate(parsed.data.taskId)
    return { ok: true }
  })

  ipcMain.handle(IPC.browserControl.cancelTask, (_event, payload: unknown) => {
    const parsed = taskIdPayload.safeParse(payload)
    return { ok: parsed.success ? cancelGate(parsed.data.taskId) : false }
  })
}
