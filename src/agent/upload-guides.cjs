const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function upload(file) {
  console.log(`Uploading ${file}...`);
  const buf = fs.readFileSync(path.join(__dirname, 'images', file));

  const { error } = await supabase.storage
    .from('b2c-assets')
    .upload('guides/' + file, buf, { contentType: 'image/png', upsert: true });

  if (error) {
    console.error(`❌ ${file}:`, error.message);
    return;
  }

  const { data } = supabase.storage.from('b2c-assets').getPublicUrl('guides/' + file);
  console.log(`✅ ${file}: ${data.publicUrl}`);
}

(async () => {
  await upload('surface_guide.png');
  await upload('measure_guide.png');
})();
