export interface DesktopAuth {
  openDiscord(url: string): Promise<void>;
  startReturn?(attempt: string): Promise<string>;
  cancelReturn?(): Promise<void>;
  finishReturn?(attempt: string, success: boolean): Promise<void>;
  onReturn?(callback: (code: string) => void): () => void;
}
export function desktopAuth() {
  return (window as Window & { polycupDesktop?: DesktopAuth }).polycupDesktop;
}
