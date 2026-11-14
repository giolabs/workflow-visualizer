// The rack's slot in the pane: which `Client` key the pane asks for, and whether the rack view is
// off. The engine unmounts a Client that throws or outruns its one-second render budget and, for
// a fault after it had drawn, keeps the slot empty until a reload while the tree holds the same
// key (`ui.fault`). A new key mounts a fresh instance, so each fault rotates the key; past
// RACK_FAULTS_MAX faults within RACK_FAULTS_WINDOW_MS the pane falls back to plain rows.

export const RACK_FAULTS_MAX = 5
export const RACK_FAULTS_WINDOW_MS = 60_000

export type RackSlot = {
  /** How many times the Client was mounted again; 0 is the first key, `rack`. */
  gen: number
  /** When the faults in the current window happened. */
  faults: number[]
  /** The reason of the fault that turned the rack view off, or null while it is on. */
  halted: string | null
}

export const freshSlot = (): RackSlot => ({ gen: 0, faults: [], halted: null })

export const slotKey = (slot: RackSlot): string => (slot.gen === 0 ? 'rack' : `rack-${slot.gen}`)

/**
 * The slot after the engine reported a Client fault: unchanged for a key the pane no longer
 * asks for (a late report on an instance already replaced), else the next key, and the view off
 * once faults pile up.
 */
export function faulted(slot: RackSlot, element: string, now: number, reason: string): RackSlot {
  if (slot.halted !== null || element !== slotKey(slot)) return slot
  const faults = [...slot.faults.filter(at => now - at < RACK_FAULTS_WINDOW_MS), now]

  return { gen: slot.gen + 1, faults, halted: faults.length > RACK_FAULTS_MAX ? reason : null }
}
