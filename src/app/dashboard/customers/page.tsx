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
        setCustomers(data || []);
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
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Telegram ID</th>
                  <th className="px-4 py-3 font-medium">Pedidos</th>
                  <th className="px-4 py-3 font-medium">Total Gastado</th>
                  <th className="px-4 py-3 font-medium">Última Compra</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-4">
                      <div className="font-semibold">{customer.full_name || "Sin nombre"}</div>
                      <div className="text-sm text-muted-foreground">{customer.phone || "Sin teléfono"}</div>
                    </td>
                    <td className="px-4 py-4 text-sm font-mono">{customer.telegram_chat_id || "-"}</td>
                    <td className="px-4 py-4">{customer.orders_count}</td>
                    <td className="px-4 py-4 font-semibold">${customer.total_spent.toLocaleString("es-UY")}</td>
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
