import { isArray, isRecord, type UnknownRecord } from "./validation.js";
import {
  arrayValue,
  booleanIssues,
  check,
  duplicates,
  exceeds,
  hasExactKeys,
  integerInRange,
  integerIssues,
} from "./manifest-checks.js";

function seatIssues(value: unknown, role: string): readonly string[] {
  const path = "players.defaultLocalSeatPlan." + role;
  if (!isArray(value) || value.length > 16) return [path + " must be an array of PlayerSlots"];
  return value.flatMap((slot) => integerIssues(slot, path + "[]", [0, 15]));
}

function validSeats(plan: UnknownRecord): readonly number[] {
  return [...arrayValue(plan.main), ...arrayValue(plan.companion)].filter((slot): slot is number =>
    integerInRange(slot, [0, 15]),
  );
}

function seatPlanIssues(value: unknown, players: UnknownRecord): readonly string[] {
  if (value === undefined) return [];
  if (!isRecord(value))
    return ["players.defaultLocalSeatPlan must define exactly main and companion"];
  const seats = validSeats(value);
  return [
    ...check(
      hasExactKeys(value, ["main", "companion"]),
      "players.defaultLocalSeatPlan must define exactly main and companion",
    ),
    ...seatIssues(value.main, "main"),
    ...seatIssues(value.companion, "companion"),
    ...duplicates(seats, "players.defaultLocalSeatPlan slots must be unique across surfaces"),
    ...check(
      !exceeds(players.minSlots, seats.length) && !exceeds(seats.length, players.maxLocalSlots),
      "players.defaultLocalSeatPlan must satisfy local player limits",
    ),
  ];
}

function playerRangeIssues(value: UnknownRecord): readonly string[] {
  return [
    ...integerIssues(value.minSlots, "players.minSlots", [1, 16]),
    ...integerIssues(value.maxSlots, "players.maxSlots", [1, 16]),
    ...integerIssues(value.maxLocalSlots, "players.maxLocalSlots", [1, 16]),
    ...check(
      !exceeds(value.minSlots, value.maxSlots),
      "players.minSlots must not exceed players.maxSlots",
    ),
    ...check(
      !exceeds(value.maxLocalSlots, value.maxSlots),
      "players.maxLocalSlots must not exceed players.maxSlots",
    ),
  ];
}

export function playersIssues(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["players must be an object"];
  return [
    ...playerRangeIssues(value),
    ...booleanIssues(value.sameAccountMultipleSlots, "players.sameAccountMultipleSlots"),
    ...check(
      !exceeds(value.maxLocalSlots, 1) || value.sameAccountMultipleSlots === true,
      "multiple local slots require players.sameAccountMultipleSlots",
    ),
    ...seatPlanIssues(value.defaultLocalSeatPlan, value),
  ];
}
