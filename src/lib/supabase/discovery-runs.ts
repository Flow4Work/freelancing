import type { SearchCategory } from "@/lib/discovery/types";
import { getSupabaseAdmin } from "./admin";

export async function beginDiscoveryRun(category: SearchCategory) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 1;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error: readError } = await supabase
      .from("creator_discovery_runs")
      .select("run_no")
      .eq("category", category)
      .order("run_no", { ascending: false })
      .limit(1);

    if (readError) {
      console.warn("supabase_discovery_run_read_failed", readError.message);
      return 1;
    }

    const nextRun = Number(data?.[0]?.run_no ?? 0) + 1;
    const { error: insertError } = await supabase
      .from("creator_discovery_runs")
      .insert({ category, run_no: nextRun });

    if (!insertError) return nextRun;
    if (insertError.code !== "23505") {
      console.warn("supabase_discovery_run_insert_failed", insertError.message);
      return nextRun;
    }
  }

  return 1;
}
