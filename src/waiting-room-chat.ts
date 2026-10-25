import type { WaitingRoom } from './waiting-room.ts';
import { waitingRoomChatLines } from './waiting-room-countdown.ts';
export class WaitingRoomChat {
  #room: WaitingRoom;
  constructor(room: WaitingRoom) {
    this.#room = room;
  }
  get cupId() {
    return this.#room.state?.id ?? '';
  }
  get lines() {
    return waitingRoomChatLines(this.#room.snapshot?.data.chat ?? []);
  }
  get revision() {
    return (this.#room.snapshot?.revision ?? 0) * 1024 + this.lines.length;
  }
  get muted() {
    return this.#room.snapshot?.data.muted.includes(this.#room.selfId!) ?? false;
  }
  get speakers() {
    return (this.#room.snapshot?.members ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      color: m.id % 8,
      muted: this.#room.snapshot!.data.muted.includes(m.id),
      canMute: !this.#room.ranked && m.id !== this.#room.snapshot!.host,
    }));
  }
  post(text: string) {
    return this.#room.submit('chat', text);
  }
  mute(id: number, _muted: boolean) {
    void this.#room.submit('mute', id).catch(() => {});
  }
}
