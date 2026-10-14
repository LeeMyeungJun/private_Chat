const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('moeumClient', {
  retryServer: () => ipcRenderer.invoke('client:retry'),
  invite: () => ipcRenderer.invoke('client:invite')
});
