import { supabase } from "./supabase";

/**
 * Uploads a file buffer to the b2c-assets Supabase Storage bucket.
 * Returns the public URL of the uploaded file.
 */
export async function uploadAsset(
  leadId: string,
  fileName: string,
  fileBuffer: Buffer,
  contentType: string
): Promise<{ url: string | null; error: string | null }> {
  const path = `${leadId}/${Date.now()}_${fileName}`;

  const { error } = await supabase.storage
    .from("b2c-assets")
    .upload(path, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (error) {
    return { url: null, error: error.message };
  }

  const { data: publicUrlData } = supabase.storage
    .from("b2c-assets")
    .getPublicUrl(path);

  return { url: publicUrlData.publicUrl, error: null };
}

/**
 * Downloads a file from a URL and returns it as a Buffer.
 * Useful for downloading photos sent via Telegram and re-uploading to storage.
 */
export async function downloadFile(
  url: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
    };
  } catch {
    return null;
  }
}
