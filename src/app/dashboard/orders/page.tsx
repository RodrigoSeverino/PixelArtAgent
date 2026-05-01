"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { LEAD_STAGE_LABELS } from "@/types/lead";
import { SURFACE_LABELS } from "@/types/surface";

// ─── Labels en español ─────────────────────────────────────────────────────

const PRINT_SCENARIO_LABELS: Record<string, string> = {
  READY_FILE:    "Archivo propio",
  IMAGE_BANK:    "Banco de imágenes",
  CUSTOM_DESIGN: "Diseño personalizado",
};

// Colores por estado para los badges
const STAGE_BADGE_STYLES: Record<string, string> = {
  NEW:                           "bg-gray-800 text-gray-300",
  INITIAL_CONTACT:               "bg-gray-800 text-gray-300",
  SURFACE_SELECTED:              "bg-sky-900 text-sky-300",
  SURFACE_PHOTO_REQUESTED:       "bg-sky-900 text-sky-300",
  SURFACE_PHOTO_RECEIVED:        "bg-sky-900 text-sky-300",
  MEASUREMENTS_REQUESTED:        "bg-blue-900 text-blue-300",
  MEASUREMENTS_RECEIVED:         "bg-blue-900 text-blue-300",
  PRINT_FILE_SCENARIO_SELECTED:  "bg-indigo-900 text-indigo-300",
  INSTALLATION_SELECTED:         "bg-indigo-900 text-indigo-300",
  QUOTE_READY:                   "bg-amber-900 text-amber-300",
  QUOTE_GENERATED:               "bg-yellow-900 text-yellow-300",
  BLOCKED:                       "bg-red-900 text-red-300",
  REQUIRES_HUMAN_REVIEW:         "bg-orange-900 text-orange-300",
  HUMAN_HANDOFF:                 "bg-purple-900 text-purple-300 border border-purple-700 animate-pulse",
  CLOSED_WON:                    "bg-green-900 text-green-300",
  CLOSED_LOST:                   "bg-red-950 text-red-400",
};

type Order = {
  id: string;
  telegram_chat_id: string;
  name: string;
  current_stage: string;
  created_at: string;
  observation?: string;
  surface_assessment?: {
    surface_type: string;
    is_ready_to_install: boolean;
  };
  measurements?: {
    width_meters: number;
    height_meters: number;
    square_meters: number;
  };
  quote?: {
    estimated_total: number;
    print_file_scenario: string;
    installation_required: boolean;
  };
  assets?: {
    asset_type: string;
    file_url: string;
    file_name: string;
  }[];
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = async () => {
    setLoading(true);
    const { data: leadsData, error: leadsError } = await supabase
      .from("b2c_leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (leadsError || !leadsData) {
      console.error(leadsError);
      setLoading(false);
      return;
    }

    const leadIds = leadsData.map((l) => l.id);

    const [measurementsRes, quotesRes, surfaceRes, assetsRes] = await Promise.all([
      supabase.from("b2c_measurements").select("*").in("lead_id", leadIds),
      supabase.from("b2c_quotes").select("*").in("lead_id", leadIds),
      supabase.from("b2c_surface_assessments").select("*").in("lead_id", leadIds),
      supabase.from("b2c_lead_assets").select("*").in("lead_id", leadIds),
    ]);

    const enrichedOrders: Order[] = leadsData.map((lead) => {
      const measurement = measurementsRes.data?.find((m) => m.lead_id === lead.id);
      const quote = quotesRes.data?.find((q) => q.lead_id === lead.id);
      const surface = surfaceRes.data?.find((s) => s.lead_id === lead.id);
      const assets = assetsRes.data?.filter((a) => a.lead_id === lead.id) || [];

      return {
        id: lead.id,
        telegram_chat_id: lead.telegram_chat_id,
        name: lead.full_name || "Cliente Telegram",
        current_stage: lead.current_stage,
        created_at: lead.created_at,
        observation: lead.observation,
        surface_assessment: surface,
        measurements: measurement,
        quote: quote,
        assets: assets,
      };
    });

    setOrders(enrichedOrders);
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel("schema-db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "b2c_leads" }, fetchOrders)
      .on("postgres_changes", { event: "*", schema: "public", table: "b2c_measurements" }, fetchOrders)
      .on("postgres_changes", { event: "*", schema: "public", table: "b2c_quotes" }, fetchOrders)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const updateStage = async (id: string, stage: string) => {
    const { error } = await supabase.from("b2c_leads").update({ current_stage: stage }).eq("id", id);
    if (error) {
      console.error("Error updating stage:", error);
      alert("Error al actualizar el estado del pedido.");
    }
  };

  const getStatusBadge = (stage: string) => {
    const label = LEAD_STAGE_LABELS[stage] ?? stage;
    const styles = STAGE_BADGE_STYLES[stage] ?? "bg-gray-800 text-gray-300";
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${styles}`}>
        {label}
      </span>
    );
  };

  const getSurfaceLabel = (surfaceType: string) =>
    SURFACE_LABELS[surfaceType as keyof typeof SURFACE_LABELS] ?? surfaceType;

  return (
    <div>
      <h2 className="text-3xl font-bold mb-8">Listado de Pedidos</h2>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-6 py-4 font-medium">Cliente</th>
              <th className="px-6 py-4 font-medium">Chat ID</th>
              <th className="px-6 py-4 font-medium">Superficie</th>
              <th className="px-6 py-4 font-medium">Ancho (m)</th>
              <th className="px-6 py-4 font-medium">Alto (m)</th>
              <th className="px-6 py-4 font-medium">m²</th>
              <th className="px-6 py-4 font-medium">Diseño</th>
              <th className="px-6 py-4 font-medium">Entrega</th>
              <th className="px-6 py-4 font-medium">Cotización</th>
              <th className="px-6 py-4 font-medium">Estado</th>
              <th className="px-6 py-4 font-medium">Archivos</th>
              <th className="px-6 py-4 font-medium">Observación</th>
              <th className="px-6 py-4 font-medium">Fecha</th>
              <th className="px-6 py-4 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={14} className="px-6 py-8 text-center text-muted-foreground">
                  Cargando pedidos...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-6 py-8 text-center text-muted-foreground">
                  No hay pedidos registrados.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="hover:bg-muted/50 transition-colors">
                  {/* Cliente */}
                  <td className="px-6 py-4 text-foreground font-medium">{order.name}</td>

                  {/* Chat ID */}
                  <td className="px-6 py-4 text-muted-foreground">{order.telegram_chat_id}</td>

                  {/* Superficie */}
                  <td className="px-6 py-4 text-foreground font-medium">
                    {order.surface_assessment
                      ? getSurfaceLabel(order.surface_assessment.surface_type)
                      : <span className="text-muted-foreground italic font-normal">No definida</span>
                    }
                  </td>

                  {/* Ancho */}
                  <td className="px-6 py-4 text-foreground">
                    {order.measurements
                      ? `${order.measurements.width_meters} m`
                      : <span className="text-muted-foreground italic">—</span>}
                  </td>

                  {/* Alto */}
                  <td className="px-6 py-4 text-foreground">
                    {order.measurements
                      ? `${order.measurements.height_meters} m`
                      : <span className="text-muted-foreground italic">—</span>}
                  </td>

                  {/* m² */}
                  <td className="px-6 py-4 text-foreground">
                    {order.measurements
                      ? `${order.measurements.square_meters} m²`
                      : <span className="text-muted-foreground italic">—</span>}
                  </td>

                  {/* Diseño */}
                  <td className="px-6 py-4 text-foreground">
                    {order.quote?.print_file_scenario
                      ? PRINT_SCENARIO_LABELS[order.quote.print_file_scenario] ?? order.quote.print_file_scenario
                      : <span className="text-muted-foreground italic">—</span>}
                  </td>

                  {/* Entrega */}
                  <td className="px-6 py-4 text-foreground">
                    {order.quote?.installation_required != null
                      ? (order.quote.installation_required ? "Con instalación" : "Retira por local")
                      : <span className="text-muted-foreground italic">—</span>}
                  </td>

                  {/* Cotización */}
                  <td className="px-6 py-4 font-medium text-primary">
                    {order.quote?.estimated_total != null
                      ? `$${order.quote.estimated_total.toLocaleString("es-UY")} UYU`
                      : <span className="text-muted-foreground italic font-normal">—</span>}
                  </td>

                  {/* Estado */}
                  <td className="px-6 py-4">
                    {getStatusBadge(order.current_stage)}
                  </td>

                  {/* Archivos */}
                  <td className="px-6 py-4">
                    {order.assets && order.assets.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {order.assets.map((asset, idx) => (
                          <a
                            key={idx}
                            href={asset.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 underline text-xs max-w-[100px] truncate block"
                            title={asset.file_name}
                          >
                            {asset.asset_type === "SURFACE_PHOTO" ? "🖼️ Foto superficie" : "📄 Diseño"}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic text-xs">Sin archivos</span>
                    )}
                  </td>

                  {/* Observación */}
                  <td
                    className="px-6 py-4 text-muted-foreground italic text-xs max-w-[150px] truncate"
                    title={order.observation || ""}
                  >
                    {order.observation || "—"}
                  </td>

                  {/* Fecha */}
                  <td className="px-6 py-4 text-muted-foreground">
                    {new Date(order.created_at).toLocaleDateString("es-AR")}
                  </td>

                  {/* Acciones */}
                  <td className="px-6 py-4">
                    {order.current_stage !== "CLOSED_WON" && order.current_stage !== "CLOSED_LOST" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateStage(order.id, "CLOSED_WON")}
                          className="px-2 py-1 bg-green-900/30 text-green-400 hover:bg-green-900/50 border border-green-900 rounded text-xs transition-colors"
                        >
                          Aceptar
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm("¿Estás seguro de que deseas cancelar este pedido?")) {
                              updateStage(order.id, "CLOSED_LOST");
                            }
                          }}
                          className="px-2 py-1 bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-900 rounded text-xs transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
