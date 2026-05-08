import { createClient } from "@supabase/supabase-js";

export const revalidate = 60; // Revalidate every minute

export default async function CatalogPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: images, error } = await supabase
    .from("b2c_image_bank")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-red-500 text-center">
          <h2 className="text-2xl font-bold mb-2">Error</h2>
          <p>No se pudieron cargar las imágenes del catálogo.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 sm:p-12">
      <div className="max-w-6xl mx-auto">
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 mb-4">Catálogo de Imágenes</h1>
          <p className="text-lg text-gray-600">Explora nuestro banco de imágenes para tus diseños en Pixel Art.</p>
        </header>

        {images?.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            No hay imágenes disponibles en este momento.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {images?.map((image) => (
              <div
                key={image.id}
                className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-xl transition-shadow duration-300"
              >
                <div className="aspect-w-4 aspect-h-3 relative bg-gray-200">
                  {/* Using standard img for simplicity without configuring next/image domains */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.image_url}
                    alt={image.title}
                    className="object-cover w-full h-48"
                  />
                </div>
                <div className="p-5">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">{image.title}</h3>
                  <p className="text-sm text-gray-500 mb-3">{image.category}</p>
                  {image.description && (
                    <p className="text-sm text-gray-700 line-clamp-2">{image.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
