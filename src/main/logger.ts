import log from 'electron-log/main'
import { app } from 'electron'
import { join } from 'path'
import { activeStorageRoot } from './config/storageLocation'

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = app.isPackaged ? false : 'debug'
// resolvePathFn is re-invoked on every write (not cached), so this follows
// activeStorageRoot() automatically once a storage-location migration commits.
log.transports.file.resolvePathFn = () => join(activeStorageRoot(), 'logs', 'app.log')

export const appLogger = log.scope('app')

export const mcpLogger = log.create({ logId: 'mcp' })
mcpLogger.transports.file.resolvePathFn = () => join(activeStorageRoot(), 'logs', 'mcp.log')
mcpLogger.transports.file.level = 'info'
mcpLogger.transports.console.level = app.isPackaged ? false : 'debug'
