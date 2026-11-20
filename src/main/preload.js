const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatPanelAPI', {
  connectChat: (platform, target) => ipcRenderer.invoke('chat:connect', { platform, target }),
  disconnectChat: (platform) => ipcRenderer.invoke('chat:disconnect', platform),

  toggleAlwaysOnTop: (value) => ipcRenderer.invoke('window:toggle-always-on-top', value),
  toggleClickThrough: (value) => ipcRenderer.invoke('window:toggle-click-through', value),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('window:set-ignore-mouse-events', ignore),

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  getLogFilePath: () => ipcRenderer.invoke('log:get-file-path'),
  openLogFile: () => ipcRenderer.invoke('log:open-file'),
  clearLogFile: () => ipcRenderer.invoke('log:clear-file'),

  onChatStatus: (callback) => {
    ipcRenderer.on('chat:status', (_event, data) => callback(data));
  },
  onChatMessage: (callback) => {
    ipcRenderer.on('chat:message', (_event, data) => callback(data));
  },
  onChatStats: (callback) => {
    ipcRenderer.on('chat:stats', (_event, data) => callback(data));
  },
  onChatLog: (callback) => {
    ipcRenderer.on('chat:log', (_event, data) => callback(data));
  },
  onAlwaysOnTopChanged: (callback) => {
    ipcRenderer.on('window:always-on-top-changed', (_event, state) => callback(state));
  },
  onClickThroughChanged: (callback) => {
    ipcRenderer.on('window:click-through-changed', (_event, state) => callback(state));
  }
});
