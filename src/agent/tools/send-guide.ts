/**
 * Tool: send_visual_guide
 *
 * El agente llama este tool cuando necesita enviar una imagen
 * de referencia o guía visual al cliente.
 *
 * Qué hace:
 * - Retorna la URL de la imagen correspondiente
 * - El webhook se encarga de enviarla al cliente por Telegram
 */

export const sendVisualGuideTool = {
  description:
    "Envía una guía visual al cliente. " +
    "SURFACE_REFERENCE: imagen que muestra superficies aptas vs no aptas para vinilo. " +
    "MEASUREMENT_GUIDE: imagen que explica cómo medir base × alto. " +
    "Llamar cuando necesites que el cliente vea una referencia visual.",

  parameters: {
    type: "object",
    properties: {
      guideType: {
        type: "string",
        enum: ["SURFACE_REFERENCE", "MEASUREMENT_GUIDE"],
        description: "Tipo de guía: SURFACE_REFERENCE=referencia de estado de superficies, MEASUREMENT_GUIDE=cómo tomar medidas"
      }
    },
    required: ["guideType"]
  },

  execute: async ({ guideType }: { guideType: string }) => {
    const guides: Record<string, { url: string; description: string }> = {
      SURFACE_REFERENCE: {
        url: "/images/surface-reference-scale.png",
        description: "Imagen comparativa: superficie apta vs no apta para vinilo",
      },
      MEASUREMENT_GUIDE: {
        url: "/images/measurement-guide.png",
        description: "Guía visual: cómo medir el ancho y alto del área para el vinilo",
      },
    };

    const guide = guides[guideType];

    return {
      success: true,
      message: `Guía visual lista para enviar: ${guide.description}. El sistema la va a enviar automáticamente al chat.`,
      data: {
        imageUrl: guide.url,
        guideType,
        description: guide.description,
      },
    };
  },
};
