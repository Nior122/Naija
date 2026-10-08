/**
 * Descriptive metadata for the one logical world.
 * This is deliberately not mutable game state or a list of server/shard worlds.
 */
export const worldDescriptor = Object.freeze({
  id: "nigeria-main",
  name: "Nigeria",
  projectName: "Naija: One World",
  topology: "single-logical-world",
  implementationStage: 0,
  simulationImplemented: false,
} as const);
