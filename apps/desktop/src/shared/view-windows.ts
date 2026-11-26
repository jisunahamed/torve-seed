// Window size preset per renderer view, shared between the main process
// (which resizes the window when the view changes) and the renderer's view
// registry test (which asserts every view is covered). Keyed by plain string
// because ViewName lives in renderer-only code; the registry test enforces
// that the keys stay in sync with VIEW_NAMES.
export type WindowSizePresetName = 'standard' | 'compact';

export const VIEW_WINDOW_PRESETS = {
  // Primary desktop views share the spacious, resizable developer workspace.
  home: 'standard',
  explore: 'standard',
  model: 'standard',
  tools: 'standard',
  tunnels: 'standard',
  chats: 'standard',
  preferences: 'standard',
  credits: 'standard',
  deposit: 'standard',
  activity: 'standard',
  rewards: 'standard',
  'torve-account': 'standard',
  help: 'standard',
  // Chat's base preset is the thin panel, but the view opens wide by default:
  // chatPanelExpanded starts true, and AppShell applies the standard preset
  // whenever it is set — the in-view toggle collapses back to this.
  chat: 'compact',
  // Diagnostic screens stay in the same workspace size.
  peers: 'standard',
  connection: 'standard',
  desktop: 'standard',
  config: 'standard',
} as const satisfies Record<string, WindowSizePresetName>;

export function windowPresetForView(view: string): WindowSizePresetName {
  return (VIEW_WINDOW_PRESETS as Record<string, WindowSizePresetName>)[view] ?? 'standard';
}
