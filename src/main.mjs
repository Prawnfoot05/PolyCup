import { Controller } from './controller.mjs';
import { CupUI } from './ui.mjs';
const { PolyMod } = await import(new URL('PolyTypes.js', document.baseURI).href);
class PolyCup extends PolyMod {
  init = pml => {
    this.controller = new Controller(() => this.ui?.render());
    try {
      this.controller.init(pml);
      pml.registerBindCategory('PolyCup');
      pml.registerKeybind("Toggle other players' ghosts", 'PolyCupToggleGhosts', 'keydown', 'KeyG', null,
        event => this.ui?.ghostHotkey(event));
    } catch (error) { this.controller.fail(error); }
  };
  postInit = () => { if (!this.ui) this.ui = new CupUI(this.controller); this.ui.render(); };
  onGameLoad = () => this.postInit();
}
export const polyMod = new PolyCup();
