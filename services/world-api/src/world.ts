/**
 * Metadata for the one logical Nigeria.
 * The current bounded simulation is a prototype, not full national game state.
 */
export const worldDescriptor = Object.freeze({
  id: "nigeria-main",
  name: "Nigeria",
  projectName: "Naija: One World",
  topology: "single-logical-world",
  implementationStage: 5,
  simulationImplemented: true,
  simulationScope: "bounded-multiplayer-prototype",
  geographyImplemented: true,
  educationImplemented: true,
  educationScope: "fictional-configurable-education-prototype",
  lifeSimulationImplemented: true,
  lifeSimulationScope: "configurable-calendar-family-relationships-and-life-history-foundation",
  geographicCoverage: "national-admin-registry-plus-bounded-akure-south-sample",
  fullNationalGeography: false,
  fullNationalSimulation: false,
} as const);
