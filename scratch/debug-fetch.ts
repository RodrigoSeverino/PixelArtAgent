import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function testFetch() {
  const mockLeadId = "1de36737-72e7-4415-aff7-b5f9141fe089";
  const { data: currentLead, error } = await supabase
    .from("b2c_leads")
    .select("*, b2c_surface_assessments(*), b2c_measurements(*), b2c_quotes(*)")
    .eq("id", mockLeadId)
    .single();

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Lead Data:", JSON.stringify(currentLead, null, 2));
  }
}

testFetch();
