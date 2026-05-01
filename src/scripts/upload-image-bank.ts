import { config } from "dotenv";
config({ path: ".env.local" });
import { supabase } from "../lib/supabase";
import * as fs from "fs";
import * as path from "path";

const imagesDir = path.join(__dirname, "../agent/images/images_bank");

async function main() {
  const files = fs.readdirSync(imagesDir).filter(f => f.endsWith(".png") || f.endsWith(".jpg"));
  
  const sqlValues = [];

  for (const file of files) {
    const filePath = path.join(imagesDir, file);
    const buffer = fs.readFileSync(filePath);
    
    // Subir a Storage
    const storagePath = `bank/${Date.now()}_${file}`;
    
    const { error: uploadError } = await supabase.storage
      .from("b2c-assets")
      .upload(storagePath, buffer, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadError) {
      console.error(`❌ Error subiendo ${file}:`, uploadError);
      continue;
    }

    const { data: publicUrlData } = supabase.storage
      .from("b2c-assets")
      .getPublicUrl(storagePath);
      
    const publicUrl = publicUrlData.publicUrl;
    const title = file.replace(".png", "").replace(".jpg", "").replace(/_/g, " ");
    
    sqlValues.push(`('${title}', 'Test', '${publicUrl}', true)`);
  }

  console.log("\n--- SQL TO EXECUTE ---\n");
  console.log(`INSERT INTO b2c_image_bank (title, category, image_url, is_active) VALUES\n${sqlValues.join(",\n")};`);
}

main();
