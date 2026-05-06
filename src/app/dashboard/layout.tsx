import Link from "next/link";
import { LayoutDashboard, ShoppingCart, Users } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-primary">PixelArt CRM</h1>
        </div>
        <nav className="space-y-1 px-4">
          <Link href="/dashboard" className="flex items-center space-x-3 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </Link>
          <Link href="/dashboard/orders" className="flex items-center space-x-3 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ShoppingCart size={20} />
            <span>Pedidos</span>
          </Link>
          <Link href="/dashboard/customers" className="flex items-center space-x-3 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Users size={20} />
            <span>Clientes</span>
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
