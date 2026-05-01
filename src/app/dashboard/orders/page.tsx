"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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
    total_price: number;
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
    // Fetch leads
    const { data: leadsData, error: leadsError } = await supabase
      .from("b2c_leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (leadsError || !leadsData) {
      console.error(leadsError);
      setLoading(false);
      return;
    }

    // Fetch related measurements and quotes
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
        name: lead.first_name || "Cliente Telegram",
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
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'b2c_leads' }, () => {
        fetchOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'b2c_measurements' }, () => {
        fetchOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'b2c_quotes' }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const updateStage = async (id: string, stage: string) => {
    const { error } = await supabase.from("b2c_leads").update({ current_stage: stage }).eq("id", id);
    if (error) {
      console.error("Error updating stage:", error);
      alert("Error al actualizar el estado del pedido.");
    }
  };

  const getStatusBadge = (stage: string) => {
    switch (stage) {
      case "NEW": return <span className="px-2 py-1 bg-gray-800 text-gray-300 rounded-full text-xs font-medium">Nuevo</span>;
      case "MEASUREMENTS_RECEIVED": return <span className="px-2 py-1 bg-blue-900 text-blue-300 rounded-full text-xs font-medium">Con Medidas</span>;
      case "QUOTE_SENT": return <span className="px-2 py-1 bg-yellow-900 text-yellow-300 rounded-full text-xs font-medium">Cotizado</span>;
      case "CLOSED_WON": return <span className="px-2 py-1 bg-green-900 text-green-300 rounded-full text-xs font-medium">Vendido</span>;
      case "CLOSED_LOST": return <span className="px-2 py-1 bg-red-900 text-red-300 rounded-full text-xs font-medium">Perdido</span>;
      case "HUMAN_HANDOFF": return <span className="px-2 py-1 bg-purple-900 text-purple-300 rounded-full text-xs font-medium border border-purple-700 animate-pulse">Atención Manual</span>;
      default: return <span className="px-2 py-1 bg-gray-800 text-gray-300 rounded-full text-xs font-medium">{stage}</span>;
    }
  };

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
              <th className="px-6 py-4 font-medium">Medidas (m²)</th>
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
                <td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">
                  Cargando pedidos...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">
                  No hay pedidos registrados.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4 text-foreground font-medium">{order.name}</td>
                  <td className="px-6 py-4 text-muted-foreground">{order.telegram_chat_id}</td>
                  <td className="px-6 py-4 text-foreground font-medium capitalize">
                    {order.surface_assessment ? order.surface_assessment.surface_type.toLowerCase().replace(/_/g, ' ') : <span className="text-muted-foreground italic font-normal">No definida</span>}
                  </td>
                  <td className="px-6 py-4 text-foreground">
                    {order.measurements ? (
                      `${order.measurements.width_meters} x ${order.measurements.height_meters} (${order.measurements.square_meters}m²)`
                    ) : (
                      <span className="text-muted-foreground italic">N/A</span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-medium text-primary">
                    {order.quote?.total_price != null ? `$${order.quote.total_price.toLocaleString()}` : <span className="text-muted-foreground italic font-normal">N/A</span>}
                  </td>
                  <td className="px-6 py-4">
                    {getStatusBadge(order.current_stage)}
                  </td>
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
                            {asset.asset_type === "SURFACE_PHOTO" ? "🖼️ Foto" : "📄 Diseño"}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic text-xs">Sin archivos</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground italic text-xs max-w-[150px] truncate" title={order.observation || ""}>
                    {order.observation || "-"}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {new Date(order.created_at).toLocaleDateString("es-AR")}
                  </td>
                  <td className="px-6 py-4">
                    {order.current_stage !== "CLOSED_WON" && order.current_stage !== "CLOSED_LOST" && (
                      <div className="flex gap-2">
                        <button onClick={() => updateStage(order.id, "CLOSED_WON")} className="px-2 py-1 bg-green-900/30 text-green-400 hover:bg-green-900/50 border border-green-900 rounded text-xs transition-colors">Ganado</button>
                        <button onClick={() => updateStage(order.id, "CLOSED_LOST")} className="px-2 py-1 bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-900 rounded text-xs transition-colors">Cancelar</button>
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
