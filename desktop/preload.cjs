const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('moeumHost', {
  info: () => ipcRenderer.invoke('host:info'),
  invite: () => ipcRenderer.invoke('host:invite'),
  retrySharing: () => ipcRenderer.invoke('host:retry-sharing'),
  quitServer: () => ipcRenderer.invoke('host:quit'),
  onStatus: callback => ipcRenderer.on('host:status', (event, info) => callback(info)),
  onInvite: callback => ipcRenderer.on('host:invite-open', () => callback())
});
