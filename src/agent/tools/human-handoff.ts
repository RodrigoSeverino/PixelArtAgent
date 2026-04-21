/**
 * Tool: request_human_handoff
 *
 * El agente llama este tool cuando detecta que el caso
 * necesita intervención humana.
 *
 * Qué hace:
 * - Marca el lead como REQUIRES_HUMAN_REVIEW
 * - El caso aparece en la cola de revisiones del CRM
 */

import { supabase } from "@/lib/supabase";

export const createHumanHandoffTool = (leadId: string) => ({
  description:
    "Deriva el caso a un asesor humano. " +
    "Llamar cuando: " +
    "1) El cliente tiene un objeto completo (heladera entera, auto completo). " +
    "2) La superficie es ≥ 3 m² y necesita evaluación presencial. " +
    "3) La superficie tiene humedad + óxido y está en mal estado. " +
    "4) El cliente pide explícitamente hablar con una persona. " +
    "5) El cliente hace una consulta que el agente no puede resolver.",

  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Motivo de la derivación. Ej: 'Objeto completo', 'Superficie ≥ 3 m²', 'Solicitud del cliente'"
      }
    },
    required: ["reason"]
  },

  execute: async ({ reason }: { reason: string }) => {
    const now = new Date().toISOString();

    // Marcar lead para revisión humana
    await supabase
      .from("b2c_leads")
      .update({
        current_stage: "REQUIRES_HUMAN_REVIEW",
        updated_at: now,
      })
      .eq("id", leadId);

    // Guardar nota interna con el motivo
    await supabase.from("b2c_conversation_history").insert({
      lead_id: leadId,
      role: "system",
      content: `[DERIVACIÓN] Motivo: ${reason}`,
    });

    return {
      success: true,
      message:
        `Caso derivado a revisión humana. Motivo: ${reason}. ` +
        `Informá al cliente que un asesor especializado se va a comunicar con él/ella a la brevedad.`,
      data: {
        reason,
        newStage: "REQUIRES_HUMAN_REVIEW",
      },
    };
  },
});
