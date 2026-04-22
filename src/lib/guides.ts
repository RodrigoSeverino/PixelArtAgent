/**
 * Static URLs for Pixel Art guide images.
 * Images are stored in Supabase Storage (b2c-assets/guides/).
 * To update them, re-run: node src/agent/upload-guides.cjs
 */
const GUIDE_URLS = {
  surface:
    "https://jkehckvkxigxwmkuunvc.supabase.co/storage/v1/object/public/b2c-assets/guides/surface_guide.png",
  measure:
    "https://jkehckvkxigxwmkuunvc.supabase.co/storage/v1/object/public/b2c-assets/guides/measure_guide.png",
} as const;

type GuideKey = keyof typeof GUIDE_URLS;

/**
 * Returns the public URL of a guide image.
 * Images are pre-uploaded to Supabase Storage; no runtime I/O needed.
 */
export async function getGuideImageUrl(guide: GuideKey): Promise<string | null> {
  return GUIDE_URLS[guide] ?? null;
}
