import { vi } from "vitest";

// A fake Web MIDI access for tests: plug and unplug devices, inject note events with timestamps and
// read what the app sent out. Install it before the page starts, uninstall after.
type FakePort = { id: string; name: string; state: "connected" | "disconnected"; onmidimessage: ((e: unknown) => void) | null };
type FakeOut = { id: string; name: string; state: "connected" | "disconnected"; sent: number[][]; send(d: number[]): void };

export function fakeMidi() {
  const inputs = new Map<string, FakePort>();
  const outputs = new Map<string, FakeOut>();
  const access = { inputs, outputs, sysexEnabled: false, onstatechange: null as null | ((e: unknown) => void) };
  const change = (port: object) => access.onstatechange?.({ port });

  const api = {
    access,
    request: vi.fn(async (_opts?: { sysex?: boolean }) => access as unknown as MIDIAccess),
    // Plug in a device (or plug the same one back in).
    plug(name = "CASIO USB-MIDI", id = name) {
      const input: FakePort = { id, name, state: "connected", onmidimessage: null };
      inputs.set(id, input);
      const sent: number[][] = outputs.get(id)?.sent ?? [];
      outputs.set(id, { id, name, state: "connected", sent, send: (d) => void sent.push([...d]) });
      change(input);
    },
    // A pulled cable: browsers keep the port, marked disconnected.
    unplug(id = "CASIO USB-MIDI") {
      const input = inputs.get(id)!;
      input.state = "disconnected";
      outputs.get(id)!.state = "disconnected";
      change(input);
    },
    noteOn(note: number, velocity = 100, timeStamp = 0, id = "CASIO USB-MIDI") {
      inputs.get(id)?.onmidimessage?.({ data: new Uint8Array([0x90, note, velocity]), timeStamp });
    },
    noteOff(note: number, timeStamp = 0, id = "CASIO USB-MIDI") {
      inputs.get(id)?.onmidimessage?.({ data: new Uint8Array([0x80, note, 0]), timeStamp });
    },
    // Anything else a keyboard sends (clock, active sensing, pitch bend).
    raw(data: number[], timeStamp = 0, id = "CASIO USB-MIDI") {
      inputs.get(id)?.onmidimessage?.({ data: new Uint8Array(data), timeStamp });
    },
    sent: (id = "CASIO USB-MIDI") => outputs.get(id)?.sent ?? [],
    // Make navigator.requestMIDIAccess answer with this fake (or refuse, as when the user says no).
    install(opts: { deny?: boolean } = {}) {
      if (opts.deny) api.request.mockRejectedValueOnce(new DOMException("denied", "SecurityError"));
      Object.defineProperty(navigator, "requestMIDIAccess", { value: api.request, configurable: true, writable: true });
      return api;
    },
  };
  return api;
}

export const uninstallMidi = () => void delete (navigator as unknown as Record<string, unknown>).requestMIDIAccess;
