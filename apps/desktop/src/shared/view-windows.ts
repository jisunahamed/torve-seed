// Window size preset per renderer view, shared between the main process
// (which resizes the window when the view changes) and the renderer's view
// registry test (which asserts every view is covered). Keyed by plain string
// because ViewName lives in renderer-only code; the registry test enforces
// that the keys stay in sync with VIEW_NAMES.
export type WindowSizePresetName = 'standard' | 'compact';

export const VIEW_WINDOW_PRESETS = {
  home: 'standard',
  tools: 'standard',
  explore: 'standard',
  preferences: 'standard',
} as const satisfies Record<string, WindowSizePresetName>;

export function windowPresetForView(view: string): WindowSizePresetName {
  return (VIEW_WINDOW_PRESETS as Record<string, WindowSizePresetName>)[view] ?? 'standard';
}
