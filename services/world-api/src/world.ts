/**
 * Metadata for the one logical Nigeria.
 * The current bounded simulation is a prototype, not full national game state.
 */
export const worldDescriptor = Object.freeze({
  id: "nigeria-main",
  name: "Nigeria",
  projectName: "Naija: One World",
  topology: "single-logical-world",
  implementationStage: 2,
  simulationImplemented: true,
  simulationScope: "bounded-multiplayer-prototype",
  fullNationalSimulation: false,
} as const);
