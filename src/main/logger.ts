import log from 'electron-log/main'
import { app } from 'electron'
import { join } from 'path'

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = app.isPackaged ? false : 'debug'
log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'app.log')

export const appLogger = log.scope('app')

export const mcpLogger = log.create({ logId: 'mcp' })
mcpLogger.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'mcp.log')
mcpLogger.transports.file.level = 'info'
mcpLogger.transports.console.level = app.isPackaged ? false : 'debug'
