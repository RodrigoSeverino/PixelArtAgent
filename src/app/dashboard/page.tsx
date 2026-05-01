"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalLeads: 0,
    totalQuotes: 0,
    closedDeals: 0,
  });

  useEffect(() => {
    async function fetchStats() {
      const [{ count: leads }, { count: quotes }, { count: closed }] = await Promise.all([
        supabase.from("b2c_leads").select("*", { count: "exact", head: true }),
        supabase.from("b2c_quotes").select("*", { count: "exact", head: true }),
        supabase.from("b2c_leads").select("*", { count: "exact", head: true }).eq("current_stage", "CLOSED_WON"),
      ]);

      setStats({
        totalLeads: leads || 0,
        totalQuotes: quotes || 0,
        closedDeals: closed || 0,
      });
    }

    fetchStats();

    // Set up Realtime for KPIs
    const leadsChannel = supabase
      .channel('leads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'b2c_leads' }, () => {
        fetchStats();
      })
      .subscribe();

    const quotesChannel = supabase
      .channel('quotes-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'b2c_quotes' }, () => {
        fetchStats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(leadsChannel);
      supabase.removeChannel(quotesChannel);
    };
  }, []);

  return (
    <div>
      <h2 className="text-3xl font-bold mb-8">Dashboard Overview</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-muted-foreground text-sm font-medium mb-2">Total Clientes (Leads)</h3>
          <p className="text-4xl font-bold text-foreground">{stats.totalLeads}</p>
        </div>
        
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-muted-foreground text-sm font-medium mb-2">Cotizaciones Emitidas</h3>
          <p className="text-4xl font-bold text-primary">{stats.totalQuotes}</p>
        </div>
        
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-muted-foreground text-sm font-medium mb-2">Ventas Cerradas</h3>
          <p className="text-4xl font-bold text-green-500">{stats.closedDeals}</p>
        </div>
      </div>
    </div>
  );
}
