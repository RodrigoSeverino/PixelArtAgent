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
  order_number?: number;
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
    let query = supabase.from("b2c_leads").select("*").neq("current_stage", "CLOSED_LOST");
    
    const { data: leadsData, error: leadsError } = await query.order("created_at", { ascending: false });

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
        order_number: lead.order_number,
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

  const deleteOrder = async (id: string) => {
    if (!window.confirm("¿Estás seguro de que deseas ELIMINAR este pedido permanentemente? Se borrarán todos los datos asociados (medidas, fotos, cotización). Esta acción no se puede deshacer.")) {
      return;
    }

    const { error } = await supabase.from("b2c_leads").delete().eq("id", id);
    
    if (error) {
      console.error("Error deleting order:", error);
      alert("Error al eliminar el pedido de la base de datos.");
    } else {
      // El listener de supabase recargará la lista automáticamente
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
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            Listado de Pedidos
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">Gestiona y monitorea los leads de PixelArt en tiempo real.</p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={fetchOrders}
            className="p-2 hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
            title="Refrescar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
          </button>
        </div>
      </div>

      <div className="bg-zinc-900/50 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/5">
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-gray-400">Cliente</th>
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-gray-400">Especificaciones</th>
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-gray-400">Pedido</th>
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-gray-400 text-right">Cotización</th>
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-gray-400 text-center">Estado</th>
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-gray-400">Archivos</th>
                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-gray-400">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-muted-foreground animate-pulse">Cargando pedidos maestros...</span>
                    </div>
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-muted-foreground italic">
                    No hay pedidos registrados en la base de datos.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="group hover:bg-white/[0.02] transition-colors">
                    {/* Cliente */}
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-white font-semibold text-base mb-0.5">{order.name}</span>
                        {order.order_number && (
                          <span className="text-sky-400 text-xs font-bold mb-0.5">Orden #{order.order_number}</span>
                        )}
                        <span className="text-gray-500 text-xs font-mono">ID: {order.telegram_chat_id}</span>
                        <span className="text-gray-600 text-[10px] mt-1 italic">
                          {new Date(order.created_at).toLocaleDateString("es-AR", { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </td>

                    {/* Especificaciones: Superficie + Medidas */}
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded text-[10px] font-bold uppercase tracking-tight border border-white/5">
                            {order.surface_assessment ? getSurfaceLabel(order.surface_assessment.surface_type) : "SIN TIPO"}
                          </span>
                        </div>
                        {order.measurements ? (
                          <div className="flex items-center gap-2 text-gray-300">
                            <span className="text-xs bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                              {order.measurements.width_meters} x {order.measurements.height_meters}m
                            </span>
                            <span className="text-xs font-bold text-sky-400">
                              {order.measurements.square_meters} m²
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-600 text-xs italic">Sin medidas</span>
                        )}
                      </div>
                    </td>

                    {/* Pedido: Diseño + Entrega */}
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-400">Tipo:</span>
                          <span className="text-gray-200">
                            {order.quote?.print_file_scenario
                              ? PRINT_SCENARIO_LABELS[order.quote.print_file_scenario] ?? order.quote.print_file_scenario
                              : "—"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-400">Entrega:</span>
                          <span className={order.quote?.installation_required ? "text-indigo-400" : "text-emerald-400"}>
                            {order.quote?.installation_required != null
                              ? (order.quote.installation_required ? "Instalación" : "Retira local")
                              : "—"}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Cotización */}
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-xl font-bold text-white tracking-tight">
                          {order.quote?.estimated_total != null
                            ? `$${order.quote.estimated_total.toLocaleString("es-UY")}`
                            : "$ —"}
                        </span>
                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">UYU</span>
                      </div>
                    </td>

                    {/* Estado */}
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center">
                        {getStatusBadge(order.current_stage)}
                      </div>
                      {order.observation && (
                        <p className="text-[10px] text-gray-500 mt-2 italic max-w-[120px] mx-auto leading-tight group-hover:text-gray-400" title={order.observation}>
                          "{order.observation}"
                        </p>
                      )}
                    </td>

                    {/* Archivos */}
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        {order.assets && order.assets.length > 0 ? (
                          order.assets.map((asset, idx) => (
                            <a
                              key={idx}
                              href={asset.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all hover:scale-110 group/icon"
                              title={asset.file_name}
                            >
                              {asset.asset_type === "SURFACE_PHOTO" ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                              )}
                            </a>
                          ))
                        ) : (
                          <span className="text-[10px] text-gray-600 font-mono tracking-tighter">EMPTY</span>
                        )}
                      </div>
                    </td>

                    {/* Acciones */}
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {order.current_stage !== "CLOSED_WON" && order.current_stage !== "CLOSED_LOST" ? (
                          <>
                            <button
                              onClick={() => updateStage(order.id, "CLOSED_WON")}
                              className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg text-xs font-bold transition-all"
                            >
                              Cerrar Venta
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm("¿Estás seguro de que deseas cancelar este pedido?")) {
                                  updateStage(order.id, "CLOSED_LOST");
                                }
                              }}
                              className="p-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs transition-all"
                              title="Cancelar pedido"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                            </button>
                          </>
                        ) : (
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-bold uppercase tracking-widest ${order.current_stage === 'CLOSED_WON' ? 'text-emerald-500' : 'text-red-500'}`}>
                              {order.current_stage === 'CLOSED_WON' ? 'Finalizado' : 'Cancelado'}
                            </span>
                              {order.current_stage !== 'CLOSED_LOST' && (
                                <button
                                  onClick={() => deleteOrder(order.id)}
                                  className="p-1.5 hover:bg-white/5 rounded text-gray-500 hover:text-red-500 transition-colors"
                                  title="Eliminar permanentemente"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                </button>
                              )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>

  );
}
