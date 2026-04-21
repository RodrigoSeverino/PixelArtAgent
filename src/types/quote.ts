export const PRINT_FILE_SCENARIOS = [
  "READY_FILE",
  "IMAGE_BANK",
  "CUSTOM_DESIGN",
  "UNKNOWN",
] as const;

export type PrintFileScenario = (typeof PRINT_FILE_SCENARIOS)[number];

export interface Quote {
  surfaceType: string;
  squareMeters: number;
  printFileScenario: PrintFileScenario;
  installationRequired: boolean;
  estimatedBasePrice: number;
  estimatedInstallPrice: number;
  estimatedExtraPrice: number;
  estimatedTotal: number;
  requiresHumanReview: boolean;
  notes: string | null;
}
