/**
 * Stable command identifiers. Part of the extension's public surface — these
 * must not change after release. Kept in a dependency-free module so any layer
 * (commands, status bar, controller) can reference them without import cycles.
 */
export const Commands = {
  startManualSession: "betweenTrains.startManualSession",
  stopSession: "betweenTrains.stopSession",
  openWaitingRoom: "betweenTrains.openWaitingRoom",
  toggleWaitingRoom: "betweenTrains.toggleWaitingRoom",
  selectMode: "betweenTrains.selectMode",
  openSettings: "betweenTrains.openSettings",
  testOllamaConnection: "betweenTrains.testOllamaConnection",
  fetchMemes: "betweenTrains.fetchMemes",
  fetchVideos: "betweenTrains.fetchVideos",
  setNewsApiKey: "betweenTrains.setNewsApiKey",
  showLocalMetadata: "betweenTrains.showLocalMetadata",
  exportLocalMetadata: "betweenTrains.exportLocalMetadata",
  clearSessionHistory: "betweenTrains.clearSessionHistory",
  resetPersonalization: "betweenTrains.resetPersonalization",
  clearGeneratedContentCache: "betweenTrains.clearGeneratedContentCache",
  clearLocalMetadata: "betweenTrains.clearLocalMetadata",
} as const;
