import type { SurfaceType } from "@/types/surface";
import type { PrintFileScenario } from "@/types/quote";
import { supabase } from "./supabase";

interface PricingRow {
  surface_type: string;
  price_per_sqm: number;
  installation_cost_fixed: number;
  design_cost: number;
  image_bank_cost: number;
  currency: string;
}

interface CalculateQuoteParams {
  surfaceType: SurfaceType;
  squareMeters: number;
  installationRequired: boolean;
  printFileScenario: PrintFileScenario;
  isFullObject: boolean;
}

/**
 * Fetches dynamic pricing from b2c_pricing table and calculates a quote.
 * Falls back to hardcoded defaults if the DB query fails.
 */
export async function calculateQuote(params: CalculateQuoteParams) {
  let pricing: PricingRow | null = null;

  try {
    const { data, error } = await supabase
      .from("b2c_pricing")
      .select("*")
      .eq("surface_type", params.surfaceType)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!error && data) {
      pricing = data as PricingRow;
    }
  } catch {
    // Silently fall back to defaults
  }

  // Fallback defaults in UYU
  const FALLBACK_PRICES: Record<SurfaceType, PricingRow> = {
    WALL:    { surface_type: "WALL",    price_per_sqm: 2500, installation_cost_fixed: 3500, design_cost: 1800, image_bank_cost: 600, currency: "UYU" },
    WOOD:    { surface_type: "WOOD",    price_per_sqm: 3000, installation_cost_fixed: 3500, design_cost: 1800, image_bank_cost: 600, currency: "UYU" },
    GLASS:   { surface_type: "GLASS",   price_per_sqm: 2800, installation_cost_fixed: 3500, design_cost: 1800, image_bank_cost: 600, currency: "UYU" },
    FRIDGE:  { surface_type: "FRIDGE",  price_per_sqm: 3200, installation_cost_fixed: 4000, design_cost: 1800, image_bank_cost: 600, currency: "UYU" },
    VEHICLE: { surface_type: "VEHICLE", price_per_sqm: 4500, installation_cost_fixed: 5500, design_cost: 2200, image_bank_cost: 900, currency: "UYU" },
  };

  const p = pricing ?? FALLBACK_PRICES[params.surfaceType];

  const estimatedBasePrice = Number((p.price_per_sqm * params.squareMeters).toFixed(2));
  const estimatedInstallPrice = params.installationRequired ? p.installation_cost_fixed : 0;

  let estimatedExtraPrice = 0;
  if (params.printFileScenario === "IMAGE_BANK") {
    estimatedExtraPrice = p.image_bank_cost;
  }
  if (params.printFileScenario === "CUSTOM_DESIGN") {
    estimatedExtraPrice = 1500;
  }

  const requiresHumanReview =
    params.squareMeters >= 3 || params.isFullObject === true;

  const estimatedTotal = Number(
    (estimatedBasePrice + estimatedInstallPrice + estimatedExtraPrice).toFixed(2)
  );

  return {
    estimatedBasePrice,
    estimatedInstallPrice,
    estimatedExtraPrice,
    estimatedTotal,
    requiresHumanReview,
    currency: p.currency,
  };
}
