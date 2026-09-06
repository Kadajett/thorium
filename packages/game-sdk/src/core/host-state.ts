import type {
  ColyseusSessionTicket,
  ControlEvent,
  GameBootstrap,
  HostOutboundMessage,
  JsonValue,
  PublicGameBootstrap,
} from "../types.js";
import { jsonValue } from "./bridge-message.js";
import { choice, finite, matchingText } from "./validation.js";

export interface HostState {
  readonly ticketTaken: boolean;
  readonly ticket: ColyseusSessionTicket | undefined;
}

export function initialHostState(bootstrap: GameBootstrap): HostState {
  return { ticketTaken: false, ticket: bootstrap.colyseus };
}

export function controlMessage(
  bootstrap: PublicGameBootstrap,
  event: Omit<ControlEvent, "sequence">,
  sequence: number,
): HostOutboundMessage {
  if (!bootstrap.controlledPlayerSlots.includes(event.player))
    throw new Error("PlayerSlot " + event.player + " is not controlled by this surface");
  if (!bootstrap.controls.some((control) => control.id === event.control))
    throw new Error("Unknown semantic control: " + event.control);
  choice(event.phase, ["pressed", "released", "changed"], "Invalid semantic control value");
  finite(event.value, "Invalid semantic control value");
  return { kind: "control", event: { ...event, sequence } };
}

export function peerMessage(
  bootstrap: PublicGameBootstrap,
  channel: string,
  payload: JsonValue,
): HostOutboundMessage {
  matchingText(channel, /^[a-z][a-z0-9-]{0,31}$/, "Invalid peer channel: " + channel);
  return { kind: "peer", channel, payload: jsonValue(payload), source: bootstrap.surface };
}

export function claimTicket(
  state: HostState,
): Readonly<{ state: HostState; ticket: ColyseusSessionTicket | undefined }> {
  if (state.ticketTaken)
    throw new Error("The Colyseus session ticket has already been claimed by this surface");
  return { state: { ...state, ticketTaken: true, ticket: undefined }, ticket: state.ticket };
}
