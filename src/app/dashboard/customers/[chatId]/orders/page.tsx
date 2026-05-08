"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Lead {
  id: string;
  order_number: number;
  current_stage: string;
  payment_status: string;
  address: string;
  created_at: string;
  quotes: any[];
  assets: any[];
}

interface Customer {
  full_name: string;
  telegram_chat_id: string;
  phone: string;
  email: string;
}

export default function CustomerOrdersPage() {
  const params = useParams();
  const router = useRouter();
  const chatId = params.chatId as string;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      // Fetch customer
      const { data: customerData } = await supabase
        .from("b2c_customers")
        .select("*")
        .eq("telegram_chat_id", chatId)
        .single();
      
      setCustomer(customerData);

      // Fetch leads with related data
      const { data: leadsData, error } = await supabase
        .from("b2c_leads")
        .select(`
          *,
          quotes:b2c_quotes (*),
          assets:b2c_lead_assets (*)
        `)
        .eq("telegram_chat_id", chatId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching leads:", error);
      } else {
        setLeads(leadsData || []);
      }
      
      setLoading(false);
    };

    if (chatId) {
      fetchData();
    }
  }, [chatId]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "CLOSED_WON": return "bg-green-500/10 text-green-400 border-green-500/20";
      case "CLOSED_LOST": return "bg-red-500/10 text-red-400 border-red-500/20";
      default: return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case "PAID": return "bg-green-500/10 text-green-400 border-green-500/20";
      case "PARTIAL": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
      default: return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            Volver a Clientes
          </button>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/50 bg-clip-text text-transparent">
            Historial de Pedidos
          </h1>
          <p className="text-muted-foreground">
            {customer?.full_name || "Cliente"} • {chatId}
          </p>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="bg-card/50 border border-border/50 rounded-2xl p-12 text-center">
          <p className="text-muted-foreground">No se encontraron pedidos para este cliente.</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {leads.map((lead) => (
            <div
              key={lead.id}
              className="group bg-card/30 border border-border/50 rounded-2xl p-6 hover:bg-card/50 transition-all duration-300 backdrop-blur-sm"
            >
              <div className="flex flex-col lg:flex-row justify-between gap-6">
                {/* Order Info */}
                <div className="space-y-4 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-xl font-bold text-primary">#{lead.order_number}</span>
                    <div className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(lead.current_stage)}`}>
                      {lead.current_stage}
                    </div>
                    <div className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${getPaymentStatusColor(lead.payment_status)}`}>
                      {lead.payment_status}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-1">
                      <p className="text-muted-foreground">Fecha de inicio</p>
                      <p className="font-medium">
                        {format(new Date(lead.created_at), "PPP", { locale: es })}
                      </p>
                    </div>
                    {lead.address && (
                      <div className="space-y-1">
                        <p className="text-muted-foreground">Dirección de Instalación</p>
                        <p className="font-medium">{lead.address}</p>
                      </div>
                    )}
                  </div>

                  {/* Quote Details */}
                  {lead.quotes && lead.quotes.length > 0 && (
                    <div className="mt-4 p-4 bg-primary/5 rounded-xl border border-primary/10">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-primary/70 mb-3">Detalle del Presupuesto</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Superficie</p>
                          <p className="text-sm font-semibold">{lead.quotes[0].surface_type}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Medidas</p>
                          <p className="text-sm font-semibold">{lead.quotes[0].width_meters}m x {lead.quotes[0].height_meters}m</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">M² Totales</p>
                          <p className="text-sm font-semibold">{lead.quotes[0].square_meters} m²</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Total Estimado</p>
                          <p className="text-sm font-bold text-primary">${lead.quotes[0].estimated_total}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Assets */}
                <div className="lg:w-1/3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Archivos y Fotos</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {lead.assets && lead.assets.length > 0 ? (
                      lead.assets.map((asset) => (
                        <a
                          key={asset.id}
                          href={asset.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative aspect-square rounded-lg overflow-hidden border border-border/50 group/asset"
                        >
                          <img
                            src={asset.file_url}
                            alt={asset.asset_type}
                            className="object-cover w-full h-full transition-transform duration-500 group-hover/asset:scale-110"
                          />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/asset:opacity-100 transition-opacity flex items-center justify-center p-2 text-center">
                            <span className="text-[10px] text-white font-medium uppercase">{asset.asset_type.replace('_', ' ')}</span>
                          </div>
                        </a>
                      ))
                    ) : (
                      <div className="col-span-2 py-8 border border-dashed border-border/50 rounded-lg flex flex-col items-center justify-center text-muted-foreground italic text-xs">
                        No hay archivos
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
