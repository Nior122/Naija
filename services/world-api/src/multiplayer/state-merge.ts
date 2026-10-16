import { isDeepStrictEqual } from "node:util";

/**
 * Transactional helpers for identity creation.
 *
 * A creation builds its records on a private copy of the world (the draft). The draft is written
 * as a candidate snapshot. Only after that write succeeds is the difference between the base and
 * the draft applied to the live world, all at once and without awaiting. The live world is never
 * left holding half of a creation.
 *
 * The merge is conflict-checked: a change is applied only if the live value still equals the base
 * value the draft started from. If any change conflicts, nothing is applied.
 */

export type StateChange =
  | { readonly kind: "add"; readonly path: readonly string[]; readonly value: unknown }
  | { readonly kind: "set"; readonly path: readonly string[]; readonly baseValue: unknown; readonly value: unknown }
  | { readonly kind: "delete"; readonly path: readonly string[]; readonly baseValue: unknown };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Differences between base and next. Objects are compared key by key; arrays and primitives are
 * leaves compared by deep equality. Added keys are reported as a whole subtree.
 */
export function diffState(base: unknown, next: unknown, path: readonly string[] = [], out: StateChange[] = []): StateChange[] {
  if (isObject(base) && isObject(next)) {
    for (const key of Object.keys(next)) {
      if (!hasOwn(base, key)) out.push({ kind: "add", path: [...path, key], value: next[key] });
      else diffState(base[key], next[key], [...path, key], out);
    }
    for (const key of Object.keys(base)) {
      if (!hasOwn(next, key)) out.push({ kind: "delete", path: [...path, key], baseValue: structuredClone(base[key]) });
    }
    return out;
  }
  if (!isDeepStrictEqual(base, next)) {
    out.push({ kind: "set", path, baseValue: structuredClone(base), value: next });
  }
  return out;
}

function walk(root: Json, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isObject(current) || !hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Apply changes to the live world if and only if none of them conflicts. Returns the paths that
 * conflicted (empty when the changes were applied).
 */
export function mergeStateChanges(live: object, changes: readonly StateChange[]): string[] {
  const root = live as Json;
  const conflicts: string[] = [];
  for (const change of changes) {
    const parent = walk(root, change.path.slice(0, -1));
    const key = change.path[change.path.length - 1];
    const label = change.path.join(".");
    if (key === undefined || !isObject(parent)) {
      conflicts.push(label);
      continue;
    }
    const present = hasOwn(parent, key);
    if (change.kind === "add") {
      if (present) conflicts.push(label);
    } else if (!present || !isDeepStrictEqual(parent[key], change.baseValue)) {
      conflicts.push(label);
    }
  }
  if (conflicts.length > 0) return conflicts;

  for (const change of changes) {
    const parent = walk(root, change.path.slice(0, -1)) as Json;
    const key = change.path[change.path.length - 1] as string;
    if (change.kind === "delete") delete parent[key];
    else parent[key] = change.value;
  }
  return [];
}
