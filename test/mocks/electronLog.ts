import log from 'electron-log/node'

// electron-log/main calls require('electron') inside its CommonJS entry point,
// bypassing Vitest's Electron alias. Keep the real file transport and formatting
// in Node tests, without Electron's IPC/preload initialization.
export default Object.assign(log.create({ logId: 'test-main' }), {
  initialize: (): void => {}
})
