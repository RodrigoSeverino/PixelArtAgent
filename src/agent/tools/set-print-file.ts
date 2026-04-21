/**
 * Tool: set_print_file_scenario
 *
 * El agente llama este tool cuando el cliente indica cómo quiere
 * manejar la imagen a imprimir.
 *
 * Qué hace:
 * - Registra el escenario elegido
 * - Si IMAGE_BANK → retorna las imágenes del banco
 * - Si CUSTOM_DESIGN → informa el costo adicional
 * - Avanza el lead a PRINT_FILE_SCENARIO_SELECTED
 */

import { supabase } from "@/lib/supabase";

export const createSetPrintFileScenarioTool = (leadId: string) => ({
  description:
    "Registra cómo va a obtener el cliente la imagen a imprimir. " +
    "Opciones: READY_FILE (ya tiene el archivo), IMAGE_BANK (quiere ver banco de imágenes de Pixel Art), " +
    "CUSTOM_DESIGN (necesita que le diseñen algo, tiene costo adicional). " +
    "Llamar cuando el cliente indique su situación respecto a la imagen.",

  parameters: {
    type: "object",
    properties: {
      scenario: {
        type: "string",
        enum: ["READY_FILE", "IMAGE_BANK", "CUSTOM_DESIGN"],
        description: "Escenario: READY_FILE=tiene archivo listo, IMAGE_BANK=quiere banco de imágenes, CUSTOM_DESIGN=necesita diseño personalizado"
      }
    },
    required: ["scenario"]
  },

  execute: async ({ scenario }: { scenario: string }) => {
    const now = new Date().toISOString();

    // Avanzar etapa
    await supabase
      .from("b2c_leads")
      .update({
        current_stage: "PRINT_FILE_SCENARIO_SELECTED",
        updated_at: now,
      })
      .eq("id", leadId);

    const scenarioLabels: Record<string, string> = {
      READY_FILE: "Archivo propio",
      IMAGE_BANK: "Banco de imágenes",
      CUSTOM_DESIGN: "Diseño personalizado",
    };

    if (scenario === "READY_FILE") {
      return {
        success: true,
        message:
          `Escenario registrado: ${scenarioLabels[scenario]}. ` +
          `Pedile al cliente que envíe el archivo de imagen. ` +
          `Después de esto, ya podés generar la cotización con el tool generate_quote.`,
        data: { scenario },
      };
    }

    if (scenario === "IMAGE_BANK") {
      // Buscar imágenes del banco
      const { data: images } = await supabase
        .from("b2c_image_bank")
        .select("*")
        .eq("is_active", true)
        .limit(8);

      const imageCount = images?.length ?? 0;

      return {
        success: true,
        message:
          `Escenario registrado: ${scenarioLabels[scenario]}. ` +
          `Hay ${imageCount} imágenes disponibles en el banco. ` +
          `Tiene un costo adicional de $600 UYU. ` +
          `Informá al cliente y luego generá la cotización con generate_quote.`,
        data: {
          scenario,
          imageCount,
          extraCost: 600,
          images: (images ?? []).map((img: any) => ({
            name: img.name,
            url: img.image_url,
          })),
        },
      };
    }

    // CUSTOM_DESIGN
    return {
      success: true,
      message:
        `Escenario registrado: ${scenarioLabels[scenario]}. ` +
        `El diseño personalizado tiene un costo adicional de $1.800 a $2.200 UYU dependiendo de la complejidad. ` +
        `Se va a derivar al equipo de arte. ` +
        `Informá al cliente el costo adicional y luego generá la cotización con generate_quote.`,
      data: {
        scenario,
        extraCostRange: { min: 1800, max: 2200 },
      },
    };
  },
});
