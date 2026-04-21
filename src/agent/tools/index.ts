/**
 * Tools Export
 *
 * Agrupa todas las tools disponibles para el agente a través de un factory.
 */

import { createSetSurfaceTool } from "./set-surface";
import { createSetSurfaceConditionTool } from "./set-condition";
import { createSetMeasurementsTool } from "./set-measurements";
import { createSetPrintFileScenarioTool } from "./set-print-file";
import { createGenerateQuoteTool } from "./generate-quote";
import { createHumanHandoffTool } from "./human-handoff";
import { sendVisualGuideTool } from "./send-guide";

export const createAgentTools = (leadId: string) => ({
  set_surface: createSetSurfaceTool(leadId),
  set_surface_condition: createSetSurfaceConditionTool(leadId),
  set_measurements: createSetMeasurementsTool(leadId),
  set_print_file_scenario: createSetPrintFileScenarioTool(leadId),
  generate_quote: createGenerateQuoteTool(leadId),
  request_human_handoff: createHumanHandoffTool(leadId),
  send_visual_guide: sendVisualGuideTool, // No necesita leadId
});
