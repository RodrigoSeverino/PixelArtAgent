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

  useEffect(() => {
    async function fetchCustomers() {
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
    }

    fetchCustomers();
  }, []);

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
