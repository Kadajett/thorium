import {
  playerSlot,
  type ColyseusSessionTicket,
  type GameBootstrap,
  type Player,
  type PlayerSlot,
  type PublicGameBootstrap,
  type SemanticControl,
} from "../types.js";
import {
  array,
  boolean,
  bounded,
  choice,
  finite,
  integer,
  matchingText,
  positive,
  record,
  text,
  unique,
} from "./validation.js";
import { parseLocalSaveGrant } from "./local-save-wire.js";

const PLAYER_ERROR = "Bootstrap includes an invalid or duplicate Player Slot";
const CONTROL_ERROR = "Bootstrap includes an invalid semantic control";
const TICKET_ERROR = "Bootstrap includes an invalid Colyseus session capability";

function gameIdentity(value: unknown): GameBootstrap["game"] {
  const message = "Bootstrap must identify the Game Release and Game Session instance";
  const game = record(value, message);
  return {
    id: text(game.id, message),
    version: text(game.version, message),
    instanceId: matchingText(game.instanceId, /.+/, message),
  };
}

function player(value: unknown): Player {
  const source = record(value, PLAYER_ERROR);
  return {
    slot: playerSlot(integer(source.slot, [0, 15], PLAYER_ERROR)),
    displayName: text(source.displayName, PLAYER_ERROR),
    local: boolean(source.local, PLAYER_ERROR),
  };
}

function players(value: unknown): readonly Player[] {
  const result: readonly Player[] = array(value, "Bootstrap must include players and controls").map(
    player,
  );
  unique(
    result.map((candidate) => candidate.slot),
    PLAYER_ERROR,
  );
  return result;
}

function controlledSlots(value: unknown, localPlayers: readonly Player[]): readonly PlayerSlot[] {
  const message = "Bootstrap includes an invalid, duplicate, or non-local controlled Player Slot";
  const slots: readonly PlayerSlot[] = array(
    value,
    "Bootstrap must include surface-controlled Player Slots",
  ).map((slot) => playerSlot(integer(slot, [0, 15], message)));
  if (
    !slots.every((slot) =>
      localPlayers.some((candidate) => candidate.local && candidate.slot === slot),
    )
  )
    throw new TypeError(message);
  return unique(slots, message);
}

export function semanticControl(value: unknown): SemanticControl {
  const control = record(value, CONTROL_ERROR);
  return {
    id: matchingText(control.id, /^[a-z][a-z0-9-]{0,31}$/, CONTROL_ERROR),
    label: text(control.label, CONTROL_ERROR),
    kind: choice(control.kind, ["button", "axis"], CONTROL_ERROR),
  };
}

function renderConfiguration(value: unknown): GameBootstrap["render"] {
  const message = "Bootstrap must include a positive logical render size";
  const render = record(value, message);
  return {
    logicalWidth: positive(render.logicalWidth, message),
    logicalHeight: positive(render.logicalHeight, message),
    maximumDevicePixelRatio: bounded(render.maximumDevicePixelRatio, [1, 3], message),
  };
}

function joinOptions(
  value: unknown,
  game: GameBootstrap["game"],
): ColyseusSessionTicket["joinOptions"] {
  const options = record(value, TICKET_ERROR);
  if (
    Object.keys(options).sort().join(",") !== "gameSessionId,packageDigest,packageId,packageVersion"
  )
    throw new TypeError(TICKET_ERROR);
  if (
    options.gameSessionId !== game.instanceId ||
    options.packageId !== game.id ||
    options.packageVersion !== game.version
  )
    throw new TypeError(TICKET_ERROR);
  return {
    gameSessionId: game.instanceId,
    packageId: game.id,
    packageVersion: game.version,
    packageDigest: matchingText(options.packageDigest, /^[a-f0-9]{64}$/, TICKET_ERROR),
  };
}

function sessionTicket(value: unknown, game: GameBootstrap["game"]): ColyseusSessionTicket {
  const source = record(value, TICKET_ERROR);
  const endpoint = text(source.endpoint, TICKET_ERROR);
  choice(new URL(endpoint).protocol, ["https:", "wss:"], TICKET_ERROR);
  return {
    endpoint,
    roomName: matchingText(source.roomName, /^[a-z][a-z0-9_]{0,63}$/, TICKET_ERROR),
    ...(source.roomId === undefined ? {} : { roomId: text(source.roomId, TICKET_ERROR) }),
    ticket: matchingText(source.ticket, /.+/, TICKET_ERROR),
    expiresAtEpochMs: finite(source.expiresAtEpochMs, TICKET_ERROR),
    joinOptions: joinOptions(source.joinOptions, game),
  };
}

function peerLimits(value: unknown): GameBootstrap["limits"] {
  const message = "Bootstrap must include a Local Peer Message limit";
  const source = record(value, message);
  return {
    maxLocalPeerMessageBytes: integer(
      source.maxLocalPeerMessageBytes,
      [1, Number.MAX_VALUE],
      message,
    ),
  };
}

/** Parse every trusted field from unknown input; never assert an unchecked shape. */
export function parseBootstrap(value: unknown): GameBootstrap {
  const source = record(value, "Missing bootstrap object");
  const game = gameIdentity(source.game);
  const localPlayers = players(source.players);
  return {
    protocolVersion: choice(source.protocolVersion, [1], "Unsupported host protocol version"),
    surface: choice(
      source.surface,
      ["main", "companion"],
      "Bootstrap surface must be main or companion",
    ),
    ...(source.controllerInput === undefined
      ? {}
      : {
          controllerInput: choice(
            source.controllerInput,
            ["native", "browser"],
            "Unsupported controller input authority",
          ),
        }),
    game,
    ...(source.localSave === undefined ? {} : { localSave: parseLocalSaveGrant(source.localSave) }),
    players: localPlayers,
    controlledPlayerSlots: controlledSlots(source.controlledPlayerSlots, localPlayers),
    controls: array(source.controls, "Bootstrap must include players and controls").map(
      semanticControl,
    ),
    render: renderConfiguration(source.render),
    limits: peerLimits(source.limits),
    ...(source.colyseus === undefined ? {} : { colyseus: sessionTicket(source.colyseus, game) }),
  };
}

/** Project only public fields and freeze every nested collection; credentials stay private. */
function publicCollections(
  bootstrap: GameBootstrap,
): Pick<PublicGameBootstrap, "players" | "controlledPlayerSlots" | "controls"> {
  return {
    players: Object.freeze(bootstrap.players.map((value) => Object.freeze({ ...value }))),
    controlledPlayerSlots: Object.freeze([...bootstrap.controlledPlayerSlots]),
    controls: Object.freeze(bootstrap.controls.map((value) => Object.freeze({ ...value }))),
  };
}

export function publicBootstrap(bootstrap: GameBootstrap): PublicGameBootstrap {
  return Object.freeze({
    protocolVersion: bootstrap.protocolVersion,
    surface: bootstrap.surface,
    ...(bootstrap.controllerInput === undefined
      ? {}
      : { controllerInput: bootstrap.controllerInput }),
    game: Object.freeze({ ...bootstrap.game }),
    ...(bootstrap.localSave === undefined
      ? {}
      : { localSave: Object.freeze({ ...bootstrap.localSave }) }),
    ...publicCollections(bootstrap),
    render: Object.freeze({ ...bootstrap.render }),
    limits: Object.freeze({ ...bootstrap.limits }),
  });
}
