export const VPR_VIEW_NAMES = ['home', 'tools', 'explore', 'preferences'] as const;

export const VIEW_NAMES = [...VPR_VIEW_NAMES] as const;

export type VprViewName = (typeof VPR_VIEW_NAMES)[number];
export type ViewName = (typeof VIEW_NAMES)[number];
