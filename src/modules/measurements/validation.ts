import { supabase } from "@/lib/supabase";

export type SurfaceSizeCategory = "SMALL" | "MEDIUM" | "LARGE" | "FULL_OBJECT" | "INVALID";

export interface MeasurementValidationResult {
  isValid: boolean;
  message?: string;
  normalizedWidth?: number;
  normalizedHeight?: number;
  squareMeters?: number;
  category?: SurfaceSizeCategory;
  requiresHumanReview?: boolean;
}

/**
 * Normalizes and validates raw width and height strings or numbers.
 */
export function validateMeasurements(
  widthMeters: string | number,
  heightMeters: string | number
): MeasurementValidationResult {
  const normalizedWidth = Number(widthMeters);
  const normalizedHeight = Number(heightMeters);

  if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight)) {
    return {
      isValid: false,
      message: "No pude registrar las medidas porque los valores recibidos no son válidos. Necesito ancho y alto expresados como números en metros.",
    };
  }

  if (normalizedWidth <= 0 || normalizedHeight <= 0) {
    return {
      isValid: false,
      message: "No pude registrar las medidas porque ancho y alto deben ser mayores a 0.",
    };
  }

  if (normalizedWidth > 100 || normalizedHeight > 100) {
    return {
      isValid: false,
      message: "Las medidas detectadas parecen fuera de rango. Confirmá ancho y alto en metros antes de continuar.",
    };
  }

  const squareMeters = Number((normalizedWidth * normalizedHeight).toFixed(2));

  if (!Number.isFinite(squareMeters) || squareMeters <= 0) {
    return {
      isValid: false,
      message: "No pude calcular los metros cuadrados con las medidas recibidas.",
    };
  }

  return {
    isValid: true,
    normalizedWidth,
    normalizedHeight,
    squareMeters,
  };
}

/**
 * Categorizes the surface size and determines if human review is needed.
 */
export async function categorizeSize(
  leadId: string,
  squareMeters: number,
  normalizedWidth: number,
  normalizedHeight: number
): Promise<{ sizeAdvice: string; requiresHumanReview: boolean; category: SurfaceSizeCategory }> {
  // Check if it's a full object wrap
  const { data: surfaceData, error: surfaceError } = await supabase
    .from("b2c_surface_assessments")
    .select("is_full_object")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (surfaceError) {
    console.error("[categorizeSize] Error consultando surface assessment", { leadId, error: surfaceError });
  }

  if (surfaceData?.is_full_object) {
    return {
      sizeAdvice: `Medidas registradas: ${normalizedWidth}m × ${normalizedHeight}m = ${squareMeters} m². OBJETO COMPLETO — derivar a asesor humano.`,
      requiresHumanReview: true,
      category: "FULL_OBJECT",
    };
  }

  if (squareMeters < 1) {
    return {
      sizeAdvice: `Medidas registradas: ${normalizedWidth}m × ${normalizedHeight}m = ${squareMeters} m². TAMAÑO PEQUEÑO — el cliente puede retirarlo sin costo de colocación adicional, o pedir colocación con costo fijo. Preguntá ahora por la imagen: ¿ya tiene archivo, quiere ver el banco de imágenes, o necesita diseño personalizado?`,
      requiresHumanReview: false,
      category: "SMALL",
    };
  } else if (squareMeters < 3) {
    return {
      sizeAdvice: `Medidas registradas: ${normalizedWidth}m × ${normalizedHeight}m = ${squareMeters} m². TAMAÑO MEDIO — nuestro equipo va a revisar la foto de la superficie. Se recomienda colocación profesional. Preguntá ahora por la imagen: ¿ya tiene archivo, quiere ver el banco de imágenes, o necesita diseño personalizado?`,
      requiresHumanReview: false,
      category: "MEDIUM",
    };
  } else {
    return {
      sizeAdvice: `Medidas registradas: ${normalizedWidth}m × ${normalizedHeight}m = ${squareMeters} m². TAMAÑO GRANDE (≥ 3 m²) — requiere evaluación presencial o por CRM. El caso se marca para revisión humana. Aún así, preguntá por la imagen para completar la cotización preliminar.`,
      requiresHumanReview: true,
      category: "LARGE",
    };
  }
}
