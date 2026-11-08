// The harness page's one way to the main process: its task, and its report.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('harness', {
  task: () => ipcRenderer.invoke('harness:task'),
  report: (result) => ipcRenderer.send('harness:report', result),
});
