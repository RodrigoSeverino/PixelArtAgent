"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Customer {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  telegram_chat_id: string;
  total_spent: number;
  orders_count: number;
  last_purchase_at: string;
  created_at: string;
  address?: string;
  payment_status?: string;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchCustomers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("b2c_customers")
      .select("*")
      .order("last_purchase_at", { ascending: false });

    if (error) {
      console.error("Error fetching customers:", error);
    } else {
      const { data: leadsData } = await supabase
        .from("b2c_leads")
        .select("telegram_chat_id, payment_status")
        .order("created_at", { ascending: false });

      const enriched = data?.map((c) => {
        const lead = leadsData?.find((l) => l.telegram_chat_id === c.telegram_chat_id);
        return { ...c, payment_status: lead?.payment_status || "PENDING" };
      });
      setCustomers(enriched || []);
    }
    setLoading(false);
  };
  useEffect(() => {
    fetchCustomers();
  }, []);

  const deleteCustomer = async (id: string) => {
    const { error } = await supabase.from("b2c_customers").delete().eq("id", id);
    
    if (error) {
      console.error("Error deleting customer:", error);
      alert("Error al eliminar el cliente de la base de datos.");
    } else {
      setConfirmDeleteId(null);
      fetchCustomers();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Base de Clientes</h2>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground text-lg">Cargando clientes...</p>
        </div>
      ) : customers.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-lg border-2 border-dashed">
          <p className="text-muted-foreground">No hay clientes registrados aún.</p>
        </div>
      ) : (
        <div className="rounded-md border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 font-medium">Nombre y Contacto</th>
                  <th className="px-4 py-3 font-medium">Dirección</th>
                  <th className="px-4 py-3 font-medium">Estado de Pago</th>
                  <th className="px-4 py-3 font-medium">Fecha de Compra</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-4">
                      <div className="font-semibold">{customer.full_name || "Sin nombre"}</div>
                      <div className="text-sm text-muted-foreground">{customer.phone || "Sin teléfono"}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-1">ID: {customer.telegram_chat_id || "-"}</div>
                    </td>
                    <td className="px-4 py-4">
                      {customer.address ? (
                        <span className="text-sm">{customer.address}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground italic">Sin dirección</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        customer.payment_status === 'PAID' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {customer.payment_status === 'PAID' ? 'Abonó' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">
                      {customer.last_purchase_at
                        ? format(new Date(customer.last_purchase_at), "PPP", { locale: es })
                        : "-"}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <a
                          href={`/dashboard/customers/${customer.telegram_chat_id}/orders`}
                          className="p-1.5 hover:bg-primary/10 rounded text-muted-foreground hover:text-primary transition-colors"
                          title="Ver historial de pedidos"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                        </a>
                        {confirmDeleteId === customer.id ? (

                          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 p-1 rounded-lg animate-in fade-in slide-in-from-right-2 duration-200">
                            <span className="text-[10px] font-bold text-red-400 px-2">¿Borrar?</span>
                            <button
                              onClick={() => deleteCustomer(customer.id)}
                              className="px-2 py-1 bg-red-500 text-white rounded text-[10px] font-bold hover:bg-red-600 transition-colors"
                            >
                              SÍ
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 bg-zinc-800 text-gray-400 rounded text-[10px] font-bold hover:bg-zinc-700 transition-colors"
                            >
                              NO
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(customer.id)}
                            className="p-1.5 hover:bg-red-500/10 rounded text-muted-foreground hover:text-red-500 transition-colors"
                            title="Eliminar cliente permanentemente"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
